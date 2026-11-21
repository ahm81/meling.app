import { randomUUID } from "node:crypto";
import { type CalendarDoc, DOOR_COUNT, type ThemeColors, type ThemeDraft, isAiDoorImage, paths, storagePaths } from "@meling/shared";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeThemeAi } from "./themeAi";
import { applyThemeDraftHandler, generateThemeHandler, regenerateDoorHandler } from "./themeCallables";
import type { ThemeDeps } from "./themeJob";

// Never the real project: these tests only run against the emulators started by `pnpm test:functions`.
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  throw new Error("Run via `pnpm test:functions` (needs the Firestore and Storage emulators).");
}
const app = initializeApp({ projectId: "demo-meling", storageBucket: "demo-meling.appspot.com" }, "theme-callable-tests");
const db = getFirestore(app);
const bucket = getStorage(app).bucket();
afterAll(() => deleteApp(app));

const deps = (): ThemeDeps => ({ db, bucket, themeAi: fakeThemeAi() });
const as = (uid: string, data: unknown) => ({ auth: { uid }, data });
const colors: ThemeColors = { bg: "#101010", door: "#202020", done: "#303030", accent: "#404040", text: "#f0f0f0" };

beforeAll(async () => {
  await db.doc(paths.member("amund")).set({ displayName: "Amund", email: "a@example.com", role: "adult" });
  await db.doc(paths.member("ida")).set({ displayName: "Ida", email: "i@example.com", role: "child" });
});

async function seedCalendar(extra: Record<string, unknown> = {}): Promise<string> {
  const calId = `2026-${randomUUID()}`;
  await db.doc(paths.calendar(calId)).set({
    year: 2026,
    childUid: "ida",
    childName: "Ida",
    wishes: { balance: "bricks", text: "" },
    currentVersion: null,
    draft: "waiting",
    draftError: null,
    createdBy: "amund",
    ...extra,
  });
  return calId;
}

const save = (path: string) => bucket.file(path).save(Buffer.from("x"), { contentType: "image/jpeg" });
const exists = async (path: string) => (await bucket.file(path).exists())[0];
const rawCalendar = async (calId: string) => (await db.doc(paths.calendar(calId)).get()).data() as Record<string, any>;
const draftOf = async (calId: string) => (await rawCalendar(calId)).themeDraft as ThemeDraft;

/** A finished draft whose doors are saved files, except the ones in `failed`. Returns the draft path of each door. */
async function seedDraft(calId: string, failed: number[] = []): Promise<Record<string, string>> {
  const doors: Record<string, { status: string; path: string | null; error: string | null }> = {};
  const draftPaths: Record<string, string> = {};
  for (let day = 1; day <= DOOR_COUNT; day++) {
    if (failed.includes(day)) {
      doors[day] = { status: "error", path: null, error: "feil" };
      continue;
    }
    const path = storagePaths.themeDraftDoor(calId, day, `d${day}`);
    await save(path);
    draftPaths[day] = path;
    doors[day] = { status: "done", path, error: null };
  }
  const styleImage = storagePaths.themeDraftStyle(calId, "s");
  await save(styleImage);
  await db.doc(paths.calendar(calId)).update({
    themeDraft: {
      status: "done",
      error: null,
      updatedAt: Timestamp.now(),
      prompt: "Dinosaurer",
      generationId: randomUUID(),
      style: "stil",
      colors,
      motifs: Array.from({ length: DOOR_COUNT }, (_, i) => `m${i + 1}`),
      styleImage,
      doors,
    },
  });
  return draftPaths;
}

const runningDraft = (updatedAt: Date) => ({
  status: "running",
  error: null,
  updatedAt: Timestamp.fromDate(updatedAt),
  prompt: "Gammelt",
  generationId: randomUUID(),
  style: null,
  colors: null,
  motifs: [],
  styleImage: null,
  doors: {},
});

describe("generateTheme", () => {
  it("only adults may generate a theme", async () => {
    const calId = await seedCalendar();
    await expect(generateThemeHandler(deps(), as("ida", { calendarId: calId, prompt: "Dinosaurer" }))).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("generateTheme validates the prompt", async () => {
    const calId = await seedCalendar();
    for (const prompt of ["", "   ", "x".repeat(501)]) {
      await expect(generateThemeHandler(deps(), as("amund", { calendarId: calId, prompt }))).rejects.toMatchObject({ code: "invalid-argument" });
    }
  });

  it("makes a done draft from the trimmed prompt", async () => {
    const calId = await seedCalendar();
    expect(await generateThemeHandler(deps(), as("amund", { calendarId: calId, prompt: "  Dinosaurer  " }))).toEqual({ ok: true });
    const draft = await draftOf(calId);
    expect(draft).toMatchObject({ status: "done", prompt: "Dinosaurer" });
    expect(Object.values(draft.doors).every((d) => d.status === "done")).toBe(true);
  });

  it("generateTheme rejects while a draft is running", async () => {
    const calId = await seedCalendar({ themeDraft: runningDraft(new Date()) });
    await expect(generateThemeHandler(deps(), as("amund", { calendarId: calId, prompt: "Dinosaurer" }))).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("generateTheme may restart a stale running draft", async () => {
    const calId = await seedCalendar({ themeDraft: runningDraft(new Date(Date.now() - 16 * 60_000)) });
    await generateThemeHandler(deps(), as("amund", { calendarId: calId, prompt: "Dinosaurer" }));
    expect((await draftOf(calId)).status).toBe("done");
  });
});

describe("regenerateDoor", () => {
  it("regenerateDoor rejects without a finished plan", async () => {
    const calId = await seedCalendar();
    await expect(regenerateDoorHandler(deps(), as("amund", { calendarId: calId, day: 3 }))).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("rejects a fresh pending door", async () => {
    const calId = await seedCalendar();
    await seedDraft(calId);
    await db.doc(paths.calendar(calId)).update({ "themeDraft.doors.3.status": "pending" });
    await expect(regenerateDoorHandler(deps(), as("amund", { calendarId: calId, day: 3 }))).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("rejects a draft with status error", async () => {
    const calId = await seedCalendar();
    await seedDraft(calId);
    await db.doc(paths.calendar(calId)).update({ "themeDraft.status": "error" });
    await expect(regenerateDoorHandler(deps(), as("amund", { calendarId: calId, day: 3 }))).rejects.toMatchObject({ code: "failed-precondition", message: "Temaet feilet. Lag det på nytt." });
  });

  it("makes a new picture for one door", async () => {
    const calId = await seedCalendar();
    const old = await seedDraft(calId);
    await regenerateDoorHandler(deps(), as("amund", { calendarId: calId, day: 3 }));
    const draft = await draftOf(calId);
    expect(draft.doors["3"]!.status).toBe("done");
    expect(draft.doors["3"]!.path).not.toBe(old["3"]);
    expect(await exists(old["3"]!)).toBe(false);
  });
});

describe("applyThemeDraft", () => {
  it("applyThemeDraft rejects a draft with failed doors", async () => {
    const calId = await seedCalendar();
    await seedDraft(calId, [3]);
    await expect(applyThemeDraftHandler(deps(), as("amund", { calendarId: calId, keepUploaded: false }))).rejects.toMatchObject({ code: "failed-precondition" });
    const cal = await rawCalendar(calId);
    expect(cal.theme).toBeUndefined();
    expect(cal.customTheme).toBeUndefined();
    expect(cal.doorImages).toBeUndefined();
  });

  it("applyThemeDraft replaces all doors", async () => {
    const calId = await seedCalendar();
    const uploaded = storagePaths.doorImage(calId, 1, "up1");
    await save(uploaded);
    await db.doc(paths.calendar(calId)).update({ doorImages: { "1": uploaded } });
    const draftPaths = await seedDraft(calId);

    const result = await applyThemeDraftHandler(deps(), as("amund", { calendarId: calId, keepUploaded: false }));
    expect(result).toEqual({ replaced: 24, kept: 0 });
    const cal = await rawCalendar(calId);
    expect(cal.theme).toBe("egen");
    expect(cal.customTheme).toEqual({ prompt: "Dinosaurer", colors });
    expect(Object.keys(cal.doorImages)).toHaveLength(24);
    for (const [day, path] of Object.entries(cal.doorImages as Record<string, string>)) {
      expect(isAiDoorImage(path)).toBe(true);
      expect(path).not.toBe(draftPaths[day]);
      expect(await exists(path)).toBe(true);
    }
    expect(await exists(uploaded)).toBe(false);
  });

  it("applyThemeDraft keepUploaded keeps only uploaded pictures", async () => {
    const calId = await seedCalendar();
    const uploaded = storagePaths.doorImage(calId, 1, "up1");
    const earlierAi = storagePaths.aiDoorImage(calId, 2, "old");
    await save(uploaded);
    await save(earlierAi);
    await db.doc(paths.calendar(calId)).update({ doorImages: { "1": uploaded, "2": earlierAi } });
    await seedDraft(calId);

    const result = await applyThemeDraftHandler(deps(), as("amund", { calendarId: calId, keepUploaded: true }));
    expect(result).toEqual({ replaced: 23, kept: 1 });
    const images = (await rawCalendar(calId)).doorImages as Record<string, string>;
    expect(images["1"]).toBe(uploaded);
    expect(await exists(uploaded)).toBe(true);
    expect(isAiDoorImage(images["2"]!)).toBe(true);
    expect(isAiDoorImage(images["3"]!)).toBe(true);
    expect(images["2"]).not.toBe(earlierAi);
    expect(await exists(earlierAi)).toBe(false);
  });

  it("applying twice keeps the draft", async () => {
    const calId = await seedCalendar();
    await seedDraft(calId);
    await applyThemeDraftHandler(deps(), as("amund", { calendarId: calId, keepUploaded: false }));
    expect((await draftOf(calId)).status).toBe("done");
    expect(await applyThemeDraftHandler(deps(), as("amund", { calendarId: calId, keepUploaded: false }))).toEqual({ replaced: 24, kept: 0 });
  });
});
