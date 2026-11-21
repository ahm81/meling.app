import { randomUUID } from "node:crypto";
import { DOOR_COUNT, type ThemeDraft, paths, storagePaths } from "@meling/shared";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import sharp from "sharp";
import { forEachLimited } from "../pipeline";
import { ImageRefusedError, type ThemeAi } from "./themeAi";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;
export type ThemeDeps = { db: Firestore; bucket: Bucket; themeAi: ThemeAi };

export const MAX_CONCURRENT_IMAGES = 4;
const DOOR_SIDE = 640;

const REFUSED_MESSAGE = "Bildet ble avvist av AI-en. Prøv «Ny variant».";
const FAILED_MESSAGE = "Kunne ikke lage bildet.";
const PLAN_FAILED_MESSAGE = "Kunne ikke lage temaet. Prøv igjen.";
const STYLE_FAILED_MESSAGE = "Kunne ikke lage stilbildet. Prøv igjen.";

const newId = () => randomUUID().replaceAll("-", "");
const doorError = (e: unknown) => (e instanceof ImageRefusedError ? REFUSED_MESSAGE : FAILED_MESSAGE);

/** The middle square of the picture, at most 640 px, as JPEG. */
export async function toDoorJpeg(image: Buffer): Promise<Buffer> {
  const { width, height } = await sharp(image).metadata();
  if (!width || !height) throw new Error("Bildet har ingen størrelse");
  const side = Math.min(width, height);
  return sharp(image)
    .extract({ left: Math.floor((width - side) / 2), top: Math.floor((height - side) / 2), width: side, height: side })
    .resize(DOOR_SIDE, DOOR_SIDE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

// Dotted field paths so parallel door writes never overwrite each other.
const writeDraft = (db: Firestore, calId: string, fields: Record<string, unknown>) =>
  db.doc(paths.calendar(calId)).update({ ...fields, "themeDraft.updatedAt": FieldValue.serverTimestamp() });

async function makeDoor(deps: ThemeDeps, calId: string, day: number, style: string, motif: string, reference: Buffer) {
  const { db, bucket, themeAi } = deps;
  try {
    const jpeg = await toDoorJpeg(await themeAi.doorImage(style, motif, reference));
    const path = storagePaths.themeDraftDoor(calId, day, newId());
    await bucket.file(path).save(jpeg, { contentType: "image/jpeg" });
    await writeDraft(db, calId, { [`themeDraft.doors.${day}`]: { status: "done", path, error: null } });
  } catch (e) {
    logger.error("Tema: døra feilet", { calId, day, error: e instanceof Error ? e.message : String(e) });
    await writeDraft(db, calId, { [`themeDraft.doors.${day}`]: { status: "error", path: null, error: doorError(e) } });
  }
}

/** Deletes files under the draft folder that the draft does not point to. Errors are only logged. */
async function deleteUnusedDraftFiles(deps: ThemeDeps, calId: string): Promise<void> {
  try {
    const snap = await deps.db.doc(paths.calendar(calId)).get();
    const draft = snap.data()?.themeDraft as ThemeDraft | undefined;
    const used = new Set<string>();
    if (draft?.styleImage) used.add(draft.styleImage);
    for (const door of Object.values(draft?.doors ?? {})) if (door.path) used.add(door.path);
    const [files] = await deps.bucket.getFiles({ prefix: storagePaths.themeDraftDir(calId) });
    await Promise.all(files.filter((f) => !used.has(f.name)).map((f) => f.delete({ ignoreNotFound: true })));
  } catch (e) {
    logger.error("Tema: kunne ikke rydde gamle utkastfiler", { calId, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Makes a theme draft: plan, style picture and 24 door pictures. The caller has written `themeDraft` as running.
 * Failures end up in the draft; it never throws for AI errors.
 */
export async function runThemeGeneration(deps: ThemeDeps, calId: string, prompt: string, childName: string): Promise<void> {
  const { db, bucket, themeAi } = deps;
  try {
    let plan;
    try {
      plan = await themeAi.planTheme(prompt, childName);
    } catch (e) {
      logger.error("Tema: planlegging feilet", { calId, error: e instanceof Error ? e.message : String(e) });
      await writeDraft(db, calId, { "themeDraft.status": "error", "themeDraft.error": PLAN_FAILED_MESSAGE });
      return;
    }
    const doors = Object.fromEntries(
      Array.from({ length: DOOR_COUNT }, (_, i) => [String(i + 1), { status: "pending", path: null, error: null }]),
    );
    await writeDraft(db, calId, { "themeDraft.colors": plan.colors, "themeDraft.style": plan.style, "themeDraft.motifs": plan.motifs, "themeDraft.doors": doors });

    let reference: Buffer;
    try {
      reference = await sharp(await themeAi.styleImage(plan.style)).png().toBuffer();
      const path = storagePaths.themeDraftStyle(calId, newId());
      await bucket.file(path).save(reference, { contentType: "image/png" });
      await writeDraft(db, calId, { "themeDraft.styleImage": path });
    } catch (e) {
      logger.error("Tema: stilbildet feilet", { calId, error: e instanceof Error ? e.message : String(e) });
      await writeDraft(db, calId, { "themeDraft.status": "error", "themeDraft.error": STYLE_FAILED_MESSAGE });
      return;
    }

    const days = Array.from({ length: DOOR_COUNT }, (_, i) => i + 1);
    await forEachLimited(days, MAX_CONCURRENT_IMAGES, (day) => makeDoor(deps, calId, day, plan.style, plan.motifs[day - 1]!, reference));
    await writeDraft(db, calId, { "themeDraft.status": "done", "themeDraft.error": null });
    await deleteUnusedDraftFiles(deps, calId);
  } catch (e) {
    // Unexpected (a Firestore or Storage failure): record it so the draft does not stay running.
    logger.error("Tema: uventet feil", { calId, error: e instanceof Error ? e.message : String(e) });
    await writeDraft(db, calId, { "themeDraft.status": "error", "themeDraft.error": PLAN_FAILED_MESSAGE }).catch(() => undefined);
  }
}

/** Makes a new picture for one door of the existing draft. The caller has set the door to pending. */
export async function regenerateDraftDoor(deps: ThemeDeps, calId: string, day: number): Promise<void> {
  const { db, bucket, themeAi } = deps;
  const key = `themeDraft.doors.${day}`;
  let oldPath: string | null = null;
  try {
    const draft = (await db.doc(paths.calendar(calId)).get()).data()?.themeDraft as ThemeDraft | undefined;
    const motif = draft?.motifs[day - 1];
    if (!draft?.styleImage || !draft.style || !motif) throw new Error("Utkastet mangler stil, stilbilde eller motiv");
    oldPath = draft.doors[String(day)]?.path ?? null;
    const [reference] = await bucket.file(draft.styleImage).download();
    const jpeg = await toDoorJpeg(await themeAi.doorImage(draft.style, motif, reference));
    const path = storagePaths.themeDraftDoor(calId, day, newId());
    await bucket.file(path).save(jpeg, { contentType: "image/jpeg" });
    await writeDraft(db, calId, { [key]: { status: "done", path, error: null } });
    if (oldPath) await bucket.file(oldPath).delete({ ignoreNotFound: true }).catch((e) => logger.error("Tema: kunne ikke slette gammelt bilde", { calId, day, error: String(e) }));
  } catch (e) {
    logger.error("Tema: ny variant feilet", { calId, day, error: e instanceof Error ? e.message : String(e) });
    await writeDraft(db, calId, { [key]: { status: "error", path: null, error: doorError(e) } });
  }
}
