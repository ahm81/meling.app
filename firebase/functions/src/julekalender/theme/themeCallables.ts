import { randomUUID } from "node:crypto";
import { DOOR_COUNT, type DoorImages, type ThemeColors, isAiDoorImage, paths, storagePaths } from "@meling/shared";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { type CallRequest, Id, STALE_MS, requireAdult } from "../callables";
import { themeAiFromEnv } from "./themeAi";
import { type ThemeDeps, regenerateDraftDoor, runThemeGeneration } from "./themeJob";

function parseInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpsError("invalid-argument", "Ugyldig forespørsel.");
  return result.data;
}

type RawDoor = { status?: string; path?: string | null };
type RawDraft = {
  status?: string;
  updatedAt?: unknown;
  generationId?: string;
  style?: string | null;
  colors?: ThemeColors | null;
  prompt?: string;
  motifs?: string[];
  styleImage?: string | null;
  doors?: Record<string, RawDoor>;
};

/** A draft that has not been written for this long is considered stuck: `updatedAt` is a Timestamp in Firestore. */
function isFresh(draft: RawDraft): boolean {
  const at = draft.updatedAt instanceof Timestamp ? draft.updatedAt.toDate() : undefined;
  return at !== undefined && Date.now() - at.getTime() <= STALE_MS;
}

const hasPending = (draft: RawDraft) => Object.values(draft.doors ?? {}).some((d) => d.status === "pending");

const ALREADY_RUNNING = "Et tema lages allerede. Prøv igjen om litt.";

// ---- generateTheme

const GenerateThemeInput = z.object({ calendarId: Id, prompt: z.string().trim().min(1).max(500) });

/**
 * Starts a new theme draft and makes it in this call (plan, style picture and 24 door pictures). Refused while a
 * draft is running or has a door being made, unless it has not been written for 15 minutes. Failures in the AI end up
 * in the draft, so the call itself still returns ok.
 */
export async function generateThemeHandler(deps: ThemeDeps, request: CallRequest): Promise<{ ok: true }> {
  const { db } = deps;
  await requireAdult(db, request);
  const { calendarId, prompt } = parseInput(GenerateThemeInput, request.data);
  const calRef = db.doc(paths.calendar(calendarId));
  const generationId = randomUUID();

  const childName = await db.runTransaction(async (tx) => {
    const snap = await tx.get(calRef);
    if (!snap.exists) throw new HttpsError("not-found", "Fant ikke kalenderen.");
    const draft = snap.get("themeDraft") as RawDraft | undefined;
    if (draft && (draft.status === "running" || hasPending(draft)) && isFresh(draft)) {
      throw new HttpsError("failed-precondition", ALREADY_RUNNING);
    }
    tx.update(calRef, {
      themeDraft: {
        status: "running",
        error: null,
        updatedAt: FieldValue.serverTimestamp(),
        prompt,
        generationId,
        style: null,
        colors: null,
        motifs: [],
        styleImage: null,
        doors: {},
      },
    });
    return (snap.get("childName") as string | undefined) ?? "";
  });

  await runThemeGeneration(deps, calendarId, generationId, prompt, childName);
  return { ok: true };
}

// ---- regenerateDoor

const RegenerateDoorInput = z.object({ calendarId: Id, day: z.int().min(1).max(DOOR_COUNT) });

/** Makes a new picture for one door of a finished plan, in this call. The old picture stays until the new one is written. */
export async function regenerateDoorHandler(deps: ThemeDeps, request: CallRequest): Promise<{ ok: true }> {
  const { db } = deps;
  await requireAdult(db, request);
  const { calendarId, day } = parseInput(RegenerateDoorInput, request.data);
  const calRef = db.doc(paths.calendar(calendarId));

  const generationId = await db.runTransaction(async (tx) => {
    const snap = await tx.get(calRef);
    if (!snap.exists) throw new HttpsError("not-found", "Fant ikke kalenderen.");
    const draft = snap.get("themeDraft") as RawDraft | undefined;
    if (!draft) throw new HttpsError("failed-precondition", "Det er ikke laget noe tema ennå.");
    if (!draft.generationId || !draft.style || !draft.styleImage || !draft.motifs?.length) {
      throw new HttpsError("failed-precondition", "Planen for temaet er ikke ferdig ennå.");
    }
    if (draft.status === "error") throw new HttpsError("failed-precondition", "Temaet feilet. Lag det på nytt.");
    if (draft.status === "running") throw new HttpsError("failed-precondition", ALREADY_RUNNING);
    if (draft.doors?.[String(day)]?.status === "pending" && isFresh(draft)) {
      throw new HttpsError("failed-precondition", "Dette bildet lages allerede. Prøv igjen om litt.");
    }
    // Dotted fields: the other doors are untouched, and `path` stays so the job can delete the old file.
    tx.update(calRef, { [`themeDraft.doors.${day}.status`]: "pending", "themeDraft.updatedAt": FieldValue.serverTimestamp() });
    return draft.generationId;
  });

  await regenerateDraftDoor(deps, calendarId, generationId, day);
  return { ok: true };
}

// ---- applyThemeDraft

const ApplyThemeDraftInput = z.object({ calendarId: Id, keepUploaded: z.boolean() });

/**
 * Makes the finished draft the calendar's theme: copies its door pictures to new AI pictures on the calendar (all of
 * them, or all but the ones adults uploaded), sets `theme` to "egen" and `customTheme`. The draft is kept, so it can be
 * applied again. Old pictures that were replaced are deleted afterwards.
 */
export async function applyThemeDraftHandler({ db, bucket }: ThemeDeps, request: CallRequest): Promise<{ replaced: number; kept: number }> {
  await requireAdult(db, request);
  const { calendarId, keepUploaded } = parseInput(ApplyThemeDraftInput, request.data);
  const calRef = db.doc(paths.calendar(calendarId));

  const snap = await calRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Fant ikke kalenderen.");
  const draft = snap.get("themeDraft") as RawDraft | undefined;
  const days = Array.from({ length: DOOR_COUNT }, (_, i) => String(i + 1));
  const draftPath = (day: string) => draft?.doors?.[day]?.status === "done" ? draft.doors[day]!.path : null;
  if (!draft || draft.status !== "done" || !draft.colors || !draft.prompt || !draft.generationId || !days.every(draftPath)) {
    throw new HttpsError("failed-precondition", "Alle 24 bildene må være ferdige før temaet kan brukes.");
  }
  const generationId = draft.generationId;
  const current = (snap.get("doorImages") ?? {}) as DoorImages;

  const toReplace = days.filter((day) => !(keepUploaded && current[day] && !isAiDoorImage(current[day])));
  const copies: Record<string, string> = {};
  try {
    for (const day of toReplace) {
      const target = storagePaths.aiDoorImage(calendarId, Number(day), randomUUID().replaceAll("-", ""));
      await bucket.file(draftPath(day)!).copy(bucket.file(target));
      copies[day] = target;
    }
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(calRef);
      // The draft was replaced while we copied: the pictures belong to a theme that is gone.
      if ((fresh.get("themeDraft") as RawDraft | undefined)?.generationId !== generationId) {
        throw new HttpsError("failed-precondition", "Temaet ble endret mens det ble brukt. Prøv igjen.");
      }
      tx.update(calRef, {
        theme: "egen",
        customTheme: { prompt: draft.prompt, colors: draft.colors },
        ...Object.fromEntries(Object.entries(copies).map(([day, path]) => [`doorImages.${day}`, path])),
      });
    });
  } catch (e) {
    await Promise.all(Object.values(copies).map((path) => bucket.file(path).delete({ ignoreNotFound: true }).catch(() => undefined)));
    throw e;
  }

  await Promise.all(
    toReplace
      .map((day) => current[day])
      .filter((old): old is string => !!old)
      .map((old) =>
        bucket.file(old).delete({ ignoreNotFound: true }).catch((e) => logger.error("Tema: kunne ikke slette gammelt bilde", { calId: calendarId, path: old, error: String(e) })),
      ),
  );
  return { replaced: toReplace.length, kept: days.length - toReplace.length };
}

// ---- onCall wrappers (region europe-west1 from setGlobalOptions)

const deps = (): ThemeDeps => ({ db: getFirestore(), bucket: getStorage().bucket(), themeAi: themeAiFromEnv() });

// The pictures are made in the call. With 429 backoff (up to ~110 s per image) 24 doors can take far longer than 540 s,
// so generateTheme gets 1800 s; regenerateDoor makes a single picture and fits in 540 s.
export const generateTheme = onCall({ timeoutSeconds: 1800, memory: "1GiB" }, (request) => generateThemeHandler(deps(), request));
export const regenerateDoor = onCall({ timeoutSeconds: 540, memory: "1GiB" }, (request) => regenerateDoorHandler(deps(), request));
export const applyThemeDraft = onCall({ timeoutSeconds: 120 }, (request) => applyThemeDraftHandler(deps(), request));
