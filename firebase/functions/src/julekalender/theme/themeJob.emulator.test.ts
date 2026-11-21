import { randomUUID } from "node:crypto";
import { type CalendarDoc, DOOR_COUNT, type ThemeDraft, paths } from "@meling/shared";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { fakeThemeAi, type ThemeAi } from "./themeAi";
import { regenerateDraftDoor, runThemeGeneration, type ThemeDeps } from "./themeJob";

// Never the real project: these tests only run against the emulators started by `pnpm test:functions`.
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  throw new Error("Run via `pnpm test:functions` (needs the Firestore and Storage emulators).");
}
const app = initializeApp({ projectId: "demo-meling", storageBucket: "demo-meling.appspot.com" }, "theme-job-tests");
const db = getFirestore(app);
const bucket = getStorage(app).bucket();
afterAll(() => deleteApp(app));

const depsWith = (themeAi: ThemeAi): ThemeDeps => ({ db, bucket, themeAi });

/** A calendar with a running, empty draft, as the callable leaves it. */
async function seedCalendar(): Promise<string> {
  const calId = `2026-${randomUUID()}`;
  await db.doc(paths.calendar(calId)).set({
    year: 2026,
    childUid: "child",
    childName: "Ida",
    wishes: { balance: "bricks", text: "" },
    currentVersion: null,
    draft: "waiting",
    draftError: null,
    createdBy: "adult",
    theme: "default",
    doorImages: { "1": "julekalender/x/door1.jpg" },
    customTheme: { prompt: "gammelt", colors: { bg: "#000000", door: "#111111", done: "#222222", accent: "#333333", text: "#ffffff" } },
    themeDraft: { status: "running", error: null, updatedAt: new Date(), prompt: "Dinosaurer", generationId: randomUUID(), style: null, colors: null, motifs: [], styleImage: null, doors: {} },
  });
  return calId;
}

const readDraft = async (calId: string) => (await db.doc(paths.calendar(calId)).get()).data()!.themeDraft as ThemeDraft;
const gid = async (calId: string) => (await readDraft(calId)).generationId;
const exists = async (path: string) => (await bucket.file(path).exists())[0];

describe("theme job", () => {
  it("makes a full draft", async () => {
    const calId = await seedCalendar();
    await runThemeGeneration(depsWith(fakeThemeAi()), calId, await gid(calId), "Dinosaurer", "Ida");
    const draft = await readDraft(calId);
    expect(draft.status).toBe("done");
    expect(draft.error).toBeNull();
    expect(draft.colors).not.toBeNull();
    expect(draft.motifs).toHaveLength(DOOR_COUNT);
    expect(Object.values(draft.doors)).toHaveLength(DOOR_COUNT);
    for (const door of Object.values(draft.doors)) {
      expect(door.status).toBe("done");
      expect(await exists(door.path!)).toBe(true);
      const [bytes] = await bucket.file(door.path!).download();
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe("jpeg");
      expect(meta.width).toBeLessThanOrEqual(640);
      expect(meta.height).toBeLessThanOrEqual(640);
    }
    expect(await exists(draft.styleImage!)).toBe(true);
  });

  it("marks refused doors as error and finishes the rest", async () => {
    const calId = await seedCalendar();
    await runThemeGeneration(depsWith(fakeThemeAi({ refuse: new Set(["m3", "m7"]) })), calId, await gid(calId), "Dinosaurer", "Ida");
    const draft = await readDraft(calId);
    expect(draft.status).toBe("done");
    for (const d of ["3", "7"]) {
      expect(draft.doors[d]).toMatchObject({ status: "error", path: null });
      expect(draft.doors[d]!.error).toBeTruthy();
    }
    expect(Object.values(draft.doors).filter((d) => d.status === "done")).toHaveLength(22);
  });

  it("marks doors not started before the deadline as error and still finishes", async () => {
    const calId = await seedCalendar();
    const calls: string[] = [];
    const fake = fakeThemeAi();
    const themeAi: ThemeAi = { ...fake, doorImage: (...a) => (calls.push("door"), fake.doorImage(...a)) };
    await runThemeGeneration(depsWith(themeAi), calId, await gid(calId), "Dinosaurer", "Ida", -1);
    const draft = await readDraft(calId);
    expect(draft.status).toBe("done");
    expect(calls).toEqual([]);
    for (const door of Object.values(draft.doors)) {
      expect(door).toEqual({ status: "error", path: null, error: "Tidsfristen gikk ut. Prøv «Ny variant»." });
    }
  });

  it("records an error when planning fails", async () => {
    const calId = await seedCalendar();
    const failing: ThemeAi = { ...fakeThemeAi(), planTheme: async () => { throw new Error("nede"); } };
    await runThemeGeneration(depsWith(failing), calId, await gid(calId), "Dinosaurer", "Ida");
    const draft = await readDraft(calId);
    expect(draft.status).toBe("error");
    expect(draft.error).toBeTruthy();
    const [files] = await bucket.getFiles({ prefix: `julekalender/${calId}/themeDraft/` });
    expect(files).toHaveLength(0);
  });

  it("regenerateDraftDoor replaces one door", async () => {
    const calId = await seedCalendar();
    const fake = fakeThemeAi();
    const styles: string[] = [];
    const deps = depsWith({ ...fake, doorImage: (style, motif, ref) => (styles.push(style), fake.doorImage(style, motif, ref)) });
    await runThemeGeneration(deps, calId, await gid(calId), "Dinosaurer", "Ida");
    styles.length = 0;
    const before = await readDraft(calId);
    // The caller only flips the status, so the old path stays until the new picture is written.
    await db.doc(paths.calendar(calId)).update({ "themeDraft.doors.5.status": "pending" });
    await regenerateDraftDoor(deps, calId, await gid(calId), 5);
    const after = await readDraft(calId);
    expect(after.style).toBe("enkle, runde former i julefarger");
    expect(styles).toEqual([after.style]);
    expect(after.doors["5"]!.status).toBe("done");
    expect(after.doors["5"]!.path).not.toBe(before.doors["5"]!.path);
    expect(await exists(after.doors["5"]!.path!)).toBe(true);
    expect(await exists(before.doors["5"]!.path!)).toBe(false);
    expect(after.doors["6"]).toEqual(before.doors["6"]);
  });

  it("never touches theme, customTheme or doorImages", async () => {
    const calId = await seedCalendar();
    const read = async () => {
      const d = (await db.doc(paths.calendar(calId)).get()).data() as CalendarDoc;
      return { theme: d.theme, customTheme: d.customTheme, doorImages: d.doorImages };
    };
    const before = await read();
    await runThemeGeneration(depsWith(fakeThemeAi()), calId, await gid(calId), "Dinosaurer", "Ida");
    expect(await read()).toEqual(before);
  });

  /** A ThemeAi whose door picture for motif "m3" waits until `release` is called; `reached` resolves when it is waiting. */
  function gated() {
    const fake = fakeThemeAi();
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const reachedP = new Promise<void>((r) => (reached = r));
    const themeAi: ThemeAi = {
      ...fake,
      doorImage: async (style, motif, ref) => {
        if (motif === "m3") {
          reached();
          await gate;
        }
        return fake.doorImage(style, motif, ref);
      },
    };
    return { themeAi, release, reachedP };
  }

  it("drops writes from an old job once the draft has been replaced", async () => {
    const calId = await seedCalendar();
    const { themeAi, release, reachedP } = gated();
    const running = runThemeGeneration(depsWith(themeAi), calId, await gid(calId), "Dinosaurer", "Ida");
    await reachedP;
    const fresh = { status: "running", error: null, updatedAt: new Date(), prompt: "Nytt", generationId: "ny", style: null, colors: null, motifs: [], styleImage: null, doors: {} };
    await db.doc(paths.calendar(calId)).update({ themeDraft: fresh });
    const [beforeFiles] = await bucket.getFiles({ prefix: `julekalender/${calId}/themeDraft/` });
    release();
    await running;
    const draft = (await db.doc(paths.calendar(calId)).get()).data()!.themeDraft;
    expect(draft).toEqual({ ...fresh, updatedAt: expect.anything() });
    const [files] = await bucket.getFiles({ prefix: `julekalender/${calId}/themeDraft/` });
    // Files written before the swap may remain (the next run's cleanup removes them); nothing is added after it.
    const known = new Set(beforeFiles.map((f) => f.name));
    expect(files.filter((f) => !known.has(f.name))).toHaveLength(0);
  });

  it("does not bring back a deleted draft", async () => {
    const calId = await seedCalendar();
    const { themeAi, release, reachedP } = gated();
    const running = runThemeGeneration(depsWith(themeAi), calId, await gid(calId), "Dinosaurer", "Ida");
    await reachedP;
    await db.doc(paths.calendar(calId)).update({ themeDraft: FieldValue.delete() });
    release();
    await running;
    expect((await db.doc(paths.calendar(calId)).get()).data()).not.toHaveProperty("themeDraft");
  });

  it("does nothing when the draft has another generationId", async () => {
    const calId = await seedCalendar();
    const before = await readDraft(calId);
    const calls: string[] = [];
    const fake = fakeThemeAi();
    const themeAi: ThemeAi = {
      planTheme: (...a) => (calls.push("plan"), fake.planTheme(...a)),
      styleImage: (...a) => (calls.push("style"), fake.styleImage(...a)),
      doorImage: (...a) => (calls.push("door"), fake.doorImage(...a)),
    };
    await runThemeGeneration(depsWith(themeAi), calId, "en-annen", "Dinosaurer", "Ida");
    await regenerateDraftDoor(depsWith(themeAi), calId, "en-annen", 5);
    expect(calls).toEqual([]);
    expect(await readDraft(calId)).toEqual(before);
  });
});
