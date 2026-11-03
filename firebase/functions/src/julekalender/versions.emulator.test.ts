import { randomUUID } from "node:crypto";
import { type CalendarDoc, DOOR_COUNT, type ManualDoc, type PageDoc, type Plan, paths, storagePaths } from "@meling/shared";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toPageAnalysis } from "./analysis";
import {
  type CallableDeps,
  editPlanHandler,
  redraftHandler,
  renderCutoutsHandler,
  restoreVersionHandler,
  retryManualHandler,
} from "./callables";
import { fakeAi } from "./gemini";
import { makeFirstDraft, processManual } from "./pipeline";
import { minimalPdf } from "./testing/minimal-pdf";
import { StaleVersionError, writeVersion } from "./versions";

// Never the real project: these tests only run against the emulators started by `pnpm test:functions`.
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  throw new Error("Run via `pnpm test:functions` (needs the Firestore and Storage emulators).");
}
const app = initializeApp({ projectId: "demo-meling", storageBucket: "demo-meling.appspot.com" }, "emulator-tests");
const db = getFirestore(app);
const bucket = getStorage(app).bucket();
afterAll(() => deleteApp(app));

const emptyPlan = (): Plan => ({ days: Array.from({ length: DOOR_COUNT }, () => ({ stepIds: [] })), hidden: [] });

async function seedCalendar(overrides: Partial<CalendarDoc> = {}): Promise<string> {
  const calId = `2026-${randomUUID()}`;
  const doc: CalendarDoc = {
    year: 2026,
    childUid: "child",
    childName: "Ida",
    wishes: { balance: "bricks", text: "" },
    currentVersion: null,
    draft: "waiting",
    draftError: null,
    createdBy: "adult",
    ...overrides,
  };
  await db.doc(paths.calendar(calId)).set(doc);
  return calId;
}

/** A finished manual whose pages are page 1 (cover) and `stepPages` instruction pages with two steps each. */
async function seedAnalyzedManual(calId: string, stepPages: number, ai = fakeAi({})): Promise<void> {
  const manualId = "m1";
  const pageCount = stepPages + 1;
  const manual: ManualDoc = {
    order: 1,
    fileName: "a.pdf",
    storagePath: storagePaths.manualPdf(calId, manualId),
    status: "done",
    pageCount,
    pagesAnalyzed: pageCount,
    setNumber: "00000",
    error: null,
  };
  await db.doc(paths.manual(calId, manualId)).set(manual);
  for (let page = 1; page <= pageCount; page++) {
    const { analysis } = toPageAnalysis(await ai.analyzePage(Buffer.alloc(0), page));
    const doc: PageDoc = { manualId, page, imagePath: storagePaths.pageImage(calId, manualId, page), width: 10, height: 10, analysis };
    await db.doc(paths.page(calId, manualId, page)).set(doc);
  }
}

const versions = async (calId: string) => (await db.collection(`${paths.calendar(calId)}/versions`).get()).docs;
const calendar = async (calId: string) => (await db.doc(paths.calendar(calId)).get()).data() as CalendarDoc;

describe("writeVersion", () => {
  it("writes version 1 when currentVersion is null", async () => {
    const calId = await seedCalendar();
    const n = await writeVersion(db, calId, {
      baseVersion: null,
      author: { kind: "adult", uid: "adult" },
      summary: "Test",
      plan: emptyPlan(),
    });
    expect(n).toBe(1);
    const v = (await db.doc(paths.version(calId, 1)).get()).data();
    expect(v).toMatchObject({ number: 1, author: { kind: "adult", uid: "adult" }, summary: "Test", restoredFrom: null });
    expect(v?.createdAt).toBeInstanceOf(Timestamp);
    expect((await calendar(calId)).currentVersion).toBe(1);
  });

  it("rejects a stale baseVersion", async () => {
    const calId = await seedCalendar({ currentVersion: 2 });
    await expect(
      writeVersion(db, calId, { baseVersion: 1, author: { kind: "adult", uid: "adult" }, summary: "Test", plan: emptyPlan() }),
    ).rejects.toThrow(StaleVersionError);
    expect(await versions(calId)).toHaveLength(0);
    expect((await calendar(calId)).currentVersion).toBe(2);
  });
});

describe("makeFirstDraft", () => {
  it("makeFirstDraft runs once", async () => {
    const calId = await seedCalendar();
    await seedAnalyzedManual(calId, 12); // 24 steps
    await Promise.all([makeFirstDraft(db, fakeAi({}), calId), makeFirstDraft(db, fakeAi({}), calId)]);
    const vs = await versions(calId);
    expect(vs).toHaveLength(1);
    const v = vs[0]!.data();
    expect(v).toMatchObject({ number: 1, author: { kind: "ai", requestedBy: null }, summary: "Førsteutkast fra AI" });
    expect((v.plan as Plan).days.every((d) => d.stepIds.length === 1)).toBe(true);
    // The cover is hidden as a whole page.
    expect((v.plan as Plan).hidden).toContainEqual(expect.objectContaining({ manualId: "m1", page: 1, bbox: null, source: "ai" }));
    expect(await calendar(calId)).toMatchObject({ draft: "done", draftError: null, currentVersion: 1 });
  });

  it("makeFirstDraft records a Norwegian error for too few steps", async () => {
    const calId = await seedCalendar();
    await seedAnalyzedManual(calId, 5); // 10 steps
    await makeFirstDraft(db, fakeAi({}), calId);
    const cal = await calendar(calId);
    expect(cal.draft).toBe("error");
    expect(cal.draftError).toContain("minst 24");
    expect(await versions(calId)).toHaveLength(0);
  });

  it("falls back to balancing on steps when too few steps have bricks", async () => {
    const calId = await seedCalendar({ wishes: { balance: "bricks", text: "" } });
    const halfWithoutBricks = {
      kind: "instructions",
      steps: [
        { printed_number: 1, box_2d: [0, 0, 1000, 500], parts: [] },
        { printed_number: 2, box_2d: [0, 500, 1000, 1000], parts: [{ qty: 1, name: "Brikke", color: "Rød" }] },
      ],
      spoilers: [],
      inventory: [],
      set_number: null,
    };
    const pages = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 2, halfWithoutBricks]));
    await seedAnalyzedManual(calId, 12, fakeAi(pages)); // 24 steps, only 12 with bricks
    await makeFirstDraft(db, fakeAi({}), calId);
    expect(await calendar(calId)).toMatchObject({ draft: "done", draftError: null, currentVersion: 1 });
    const plan = (await versions(calId))[0]!.data().plan as Plan;
    expect(plan.days.every((d) => d.stepIds.length === 1)).toBe(true);
  });
});

describe("processManual", () => {
  async function upload(calId: string, manualId: string, pdf: Buffer): Promise<void> {
    await bucket.file(storagePaths.manualPdf(calId, manualId)).save(pdf, { contentType: "application/pdf" });
    const manual: ManualDoc = {
      order: 1,
      fileName: `${manualId}.pdf`,
      storagePath: storagePaths.manualPdf(calId, manualId),
      status: "uploaded",
      pageCount: null,
      pagesAnalyzed: 0,
      setNumber: null,
      error: null,
    };
    await db.doc(paths.manual(calId, manualId)).set(manual);
  }

  it("renders, analyzes and makes the first draft", async () => {
    const calId = await seedCalendar();
    await upload(calId, "m1", minimalPdf(13)); // cover + 12 pages with two synthetic steps each
    await processManual({ db, bucket, ai: fakeAi({}) }, calId, "m1");

    const manual = (await db.doc(paths.manual(calId, "m1")).get()).data() as ManualDoc;
    expect(manual).toMatchObject({ status: "done", pageCount: 13, pagesAnalyzed: 13, setNumber: "00000", error: null });
    const page2 = (await db.doc(paths.page(calId, "m1", 2)).get()).data() as PageDoc;
    expect(page2).toMatchObject({ manualId: "m1", page: 2, imagePath: storagePaths.pageImage(calId, "m1", 2) });
    expect(page2.analysis?.steps).toHaveLength(2);
    const [exists] = await bucket.file(storagePaths.pageImage(calId, "m1", 2)).exists();
    expect(exists).toBe(true);
    expect(await calendar(calId)).toMatchObject({ draft: "done", currentVersion: 1 });
  });

  it("waits for the other manuals before drafting", async () => {
    const calId = await seedCalendar();
    await upload(calId, "m1", minimalPdf(13));
    await db.doc(paths.manual(calId, "m2")).set({ order: 2, status: "uploaded" }, { merge: true });
    await processManual({ db, bucket, ai: fakeAi({}) }, calId, "m1");
    expect(await calendar(calId)).toMatchObject({ draft: "waiting", currentVersion: null });
  });

  it("marks a file that is not a PDF as an error", async () => {
    const calId = await seedCalendar();
    await upload(calId, "m1", Buffer.from("ikke en pdf"));
    await processManual({ db, bucket, ai: fakeAi({}) }, calId, "m1");
    const manual = (await db.doc(paths.manual(calId, "m1")).get()).data() as ManualDoc;
    expect(manual).toMatchObject({ status: "error", error: "Filen kunne ikke leses som PDF." });
    expect((await calendar(calId)).draft).toBe("waiting");
  });

  it("marks a failed page analysis as an error", async () => {
    const calId = await seedCalendar();
    await upload(calId, "m1", minimalPdf(3));
    const ai = { ...fakeAi({}), analyzePage: async (_png: Buffer, page: number) => { throw new Error(`Gemini side ${page}: tomt svar`); } };
    await processManual({ db, bucket, ai }, calId, "m1");
    const manual = (await db.doc(paths.manual(calId, "m1")).get()).data() as ManualDoc;
    expect(manual.status).toBe("error");
    expect(manual.error).toMatch(/^Gemini side \d: tomt svar$/);
    expect(await calendar(calId)).toMatchObject({ draft: "waiting", currentVersion: null });
  });

  it("processes a manual only once when the trigger is delivered twice", async () => {
    const calId = await seedCalendar();
    await upload(calId, "m1", minimalPdf(13));
    const base = fakeAi({});
    let calls = 0;
    const ai = { ...base, analyzePage: (png: Buffer, page: number) => (calls++, base.analyzePage(png, page)) };
    await Promise.all([processManual({ db, bucket, ai }, calId, "m1"), processManual({ db, bucket, ai }, calId, "m1")]);
    await processManual({ db, bucket, ai }, calId, "m1");
    expect(calls).toBe(13);
    const manual = (await db.doc(paths.manual(calId, "m1")).get()).data() as ManualDoc;
    expect(manual).toMatchObject({ status: "done", pageCount: 13, pagesAnalyzed: 13 });
    expect(await versions(calId)).toHaveLength(1);
  });
});

describe("callables", () => {
  const deps = (): CallableDeps => ({ db, bucket, ai: fakeAi({}) });
  const as = (uid: string, data: unknown) => ({ auth: { uid }, data });
  const minutesAgo = (m: number) => Timestamp.fromMillis(Date.now() - m * 60_000);
  const adultHide = { id: "h1", manualId: "m1", page: 2, bbox: { x: 0, y: 0, w: 0.25, h: 0.5 }, label: "Ferdig modell", source: "adult" as const };

  beforeAll(async () => {
    await db.doc(paths.member("amund")).set({ displayName: "Amund", email: "a@example.com", role: "adult" });
    await db.doc(paths.member("ida")).set({ displayName: "Ida", email: "i@example.com", role: "child" });
  });

  /** A calendar with 24 steps (cover + 12 step pages) and its AI first draft as version 1. */
  async function drafted(): Promise<string> {
    const calId = await seedCalendar();
    await seedAnalyzedManual(calId, 12);
    await makeFirstDraft(db, fakeAi({}), calId);
    return calId;
  }
  const version = async (calId: string, n: number) => (await db.doc(paths.version(calId, n)).get()).data()!;

  it("editPlan rejects children", async () => {
    const calId = await drafted();
    await expect(
      editPlanHandler(deps(), as("ida", { calendarId: calId, baseVersion: 1, ops: [], summary: "x" })),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      editPlanHandler(deps(), { auth: null, data: { calendarId: calId, baseVersion: 1, ops: [], summary: "x" } }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(await versions(calId)).toHaveLength(1);
  });

  it("editPlan applies ops and bumps the version", async () => {
    const calId = await drafted();
    const res = await editPlanHandler(
      deps(),
      as("amund", { calendarId: calId, baseVersion: 1, ops: [{ type: "hide", hidden: { ...adultHide, source: "ai" } }], summary: "Skjulte modellen" }),
    );
    expect(res).toEqual({ version: 2 });
    const v2 = await version(calId, 2);
    expect(v2).toMatchObject({ author: { kind: "adult", uid: "amund" }, summary: "Skjulte modellen", restoredFrom: null });
    // Hides made by adults are always recorded as the adult's, whatever the client sent.
    expect((v2.plan as Plan).hidden).toContainEqual(adultHide);
    expect((await calendar(calId)).currentVersion).toBe(2);
  });

  it("editPlan maps invalid ops and stale versions", async () => {
    const calId = await drafted();
    await expect(
      editPlanHandler(deps(), as("amund", { calendarId: calId, baseVersion: 1, ops: [{ type: "show", hiddenId: "nope" }], summary: "x" })),
    ).rejects.toMatchObject({ code: "invalid-argument", message: "Fant ikke det skjulte området." });
    await editPlanHandler(deps(), as("amund", { calendarId: calId, baseVersion: 1, ops: [{ type: "hide", hidden: adultHide }], summary: "x" }));
    await expect(
      editPlanHandler(deps(), as("amund", { calendarId: calId, baseVersion: 1, ops: [], summary: "x" })),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(editPlanHandler(deps(), as("amund", { calendarId: calId }))).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("restoreVersion copies the old plan as a new version", async () => {
    const calId = await drafted();
    await editPlanHandler(deps(), as("amund", { calendarId: calId, baseVersion: 1, ops: [{ type: "hide", hidden: adultHide }], summary: "Endret" }));
    const res = await restoreVersionHandler(deps(), as("amund", { calendarId: calId, baseVersion: 2, fromVersion: 1 }));
    expect(res).toEqual({ version: 3 });
    const [v1, v3] = [await version(calId, 1), await version(calId, 3)];
    expect(v3).toMatchObject({ author: { kind: "adult", uid: "amund" }, summary: "Gjenopprettet versjon 1", restoredFrom: 1 });
    expect(v3.plan).toEqual(v1.plan);
    await expect(
      restoreVersionHandler(deps(), as("ida", { calendarId: calId, baseVersion: 3, fromVersion: 1 })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("redraft writes a new AI version and keeps the adults' hidden regions", async () => {
    const calId = await drafted();
    await editPlanHandler(deps(), as("amund", { calendarId: calId, baseVersion: 1, ops: [{ type: "hide", hidden: adultHide }], summary: "x" }));
    const res = await redraftHandler(deps(), as("amund", { calendarId: calId, baseVersion: 2 }));
    expect(res).toEqual({ version: 3 });
    const v3 = await version(calId, 3);
    expect(v3).toMatchObject({ author: { kind: "ai", requestedBy: "amund" }, summary: "Nytt utkast fra AI" });
    const hidden = (v3.plan as Plan).hidden;
    expect(hidden).toContainEqual(adultHide);
    expect(hidden).toContainEqual(expect.objectContaining({ manualId: "m1", page: 1, bbox: null, source: "ai" }));
    expect(hidden.filter((h) => h.source === "ai")).toHaveLength(1);
    expect(await calendar(calId)).toMatchObject({ draft: "done", draftError: null, currentVersion: 3 });
  });

  it("restoreVersion of a missing version is not-found", async () => {
    const calId = await drafted();
    await expect(
      restoreVersionHandler(deps(), as("amund", { calendarId: calId, baseVersion: 1, fromVersion: 9 })),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("redraft with a stale baseVersion is failed-precondition", async () => {
    const calId = await drafted();
    await editPlanHandler(deps(), as("amund", { calendarId: calId, baseVersion: 1, ops: [{ type: "hide", hidden: adultHide }], summary: "x" }));
    await expect(redraftHandler(deps(), as("amund", { calendarId: calId, baseVersion: 1 }))).rejects.toMatchObject({
      code: "failed-precondition",
    });
    expect(await calendar(calId)).toMatchObject({ draft: "done", currentVersion: 2 });
  });

  it("a failed redraft of a finished calendar keeps it done but records the error", async () => {
    const calId = await drafted();
    const ai = { ...fakeAi({}), interpretWishes: async () => ({ nonsense: true }) };
    await db.doc(paths.calendar(calId)).update({ wishes: { balance: "bricks", text: "Bilen på dag 24" } });
    await expect(redraftHandler({ db, bucket, ai }, as("amund", { calendarId: calId, baseVersion: 1 }))).rejects.toMatchObject({
      code: "failed-precondition",
      message: "Gemini ønsker: svaret har feil format",
    });
    expect(await calendar(calId)).toMatchObject({ draft: "done", draftError: "Gemini ønsker: svaret har feil format", currentVersion: 1 });
    expect(await redraftHandler(deps(), as("amund", { calendarId: calId, baseVersion: 1 }))).toEqual({ version: 2 });
    expect(await calendar(calId)).toMatchObject({ draft: "done", draftError: null });
  });

  it("redraft recovers a calendar whose first draft failed", async () => {
    const calId = await seedCalendar({ draft: "error", draftError: "Noe gikk galt" });
    await seedAnalyzedManual(calId, 12);
    expect(await redraftHandler(deps(), as("amund", { calendarId: calId, baseVersion: null }))).toEqual({ version: 1 });
    expect(await calendar(calId)).toMatchObject({ draft: "done", draftError: null, currentVersion: 1 });
  });

  it("redraft refuses while a recent draft is running, and allows a stale one", async () => {
    const calId = await seedCalendar({ draft: "running" });
    await seedAnalyzedManual(calId, 12);
    await db.doc(paths.calendar(calId)).update({ draftUpdatedAt: minutesAgo(1) });
    await expect(redraftHandler(deps(), as("amund", { calendarId: calId, baseVersion: null }))).rejects.toMatchObject({
      code: "failed-precondition",
    });
    await db.doc(paths.calendar(calId)).update({ draftUpdatedAt: minutesAgo(16) });
    expect(await redraftHandler(deps(), as("amund", { calendarId: calId, baseVersion: null }))).toEqual({ version: 1 });
  });

  it("redraft maps too few steps to failed-precondition and keeps the calendar usable", async () => {
    const calId = await seedCalendar({ draft: "error", draftError: "x" });
    await seedAnalyzedManual(calId, 5);
    await expect(redraftHandler(deps(), as("amund", { calendarId: calId, baseVersion: null }))).rejects.toMatchObject({
      code: "failed-precondition",
      message: expect.stringContaining("minst 24"),
    });
    expect(await calendar(calId)).toMatchObject({ draft: "error", draftError: expect.stringContaining("minst 24") });
  });

  describe("retryManual", () => {
    async function failedManual(calId: string, status: ManualDoc["status"], updatedAt: Timestamp | null) {
      await bucket.file(storagePaths.manualPdf(calId, "m1")).save(minimalPdf(13), { contentType: "application/pdf" });
      await db.doc(paths.manual(calId, "m1")).set({
        order: 1,
        fileName: "m1.pdf",
        storagePath: storagePaths.manualPdf(calId, "m1"),
        status,
        pageCount: 20,
        pagesAnalyzed: 7,
        setNumber: null,
        error: status === "error" ? "Gemini side 3: tomt svar" : null,
        ...(updatedAt ? { updatedAt } : {}),
      });
      // Leftovers from the failed run: page 20 does not exist in the new rendering.
      await db.doc(paths.page(calId, "m1", 20)).set({ manualId: "m1", page: 20, imagePath: "x", width: 1, height: 1, analysis: null });
      await bucket.file(storagePaths.pageImage(calId, "m1", 20)).save(Buffer.from("x"));
      await bucket.file(storagePaths.cutout(calId, "m1:20:0", "none")).save(Buffer.from("x"));
    }

    it("reruns a failed manual and drops pages that no longer exist", async () => {
      const calId = await seedCalendar();
      await failedManual(calId, "error", minutesAgo(1));
      expect(await retryManualHandler(deps(), as("amund", { calendarId: calId, manualId: "m1" }))).toEqual({ ok: true });
      const manual = (await db.doc(paths.manual(calId, "m1")).get()).data()!;
      expect(manual).toMatchObject({ status: "done", pageCount: 13, pagesAnalyzed: 13, error: null });
      expect(manual.updatedAt).toBeInstanceOf(Timestamp);
      expect((await db.doc(paths.page(calId, "m1", 20)).get()).exists).toBe(false);
      expect((await bucket.file(storagePaths.pageImage(calId, "m1", 20)).exists())[0]).toBe(false);
      expect((await bucket.file(storagePaths.cutout(calId, "m1:20:0", "none")).exists())[0]).toBe(false);
      expect(await calendar(calId)).toMatchObject({ draft: "done", currentVersion: 1 });
    });

    it("resumes: keeps analysed pages and their images, analyses only the missing pages", async () => {
      const calId = await seedCalendar();
      await failedManual(calId, "error", minutesAgo(1));
      await db.doc(paths.manual(calId, "m1")).update({ setNumber: "75192" });
      const base = fakeAi({});
      // Pages 1–5 were analysed and stored in the failed run; page 6 has an image and a doc without analysis.
      const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#ffffff" } }).png().toBuffer();
      const generations = new Map<number, string>();
      for (let page = 1; page <= 6; page++) {
        const imagePath = storagePaths.pageImage(calId, "m1", page);
        await bucket.file(imagePath).save(image, { contentType: "image/png" });
        generations.set(page, String((await bucket.file(imagePath).getMetadata())[0].generation));
        const analysis = page <= 5 ? toPageAnalysis(await base.analyzePage(Buffer.alloc(0), page)).analysis : null;
        const doc: PageDoc = { manualId: "m1", page, imagePath, width: 4, height: 4, analysis };
        await db.doc(paths.page(calId, "m1", page)).set(doc);
      }
      const analysed: number[] = [];
      const ai = { ...base, analyzePage: (png: Buffer, page: number) => (analysed.push(page), base.analyzePage(png, page)) };

      expect(await retryManualHandler({ db, bucket, ai }, as("amund", { calendarId: calId, manualId: "m1" }))).toEqual({ ok: true });

      expect(analysed.sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
      const manual = (await db.doc(paths.manual(calId, "m1")).get()).data()!;
      // The cover (page 1) was kept, so its set number stays.
      expect(manual).toMatchObject({ status: "done", pageCount: 13, pagesAnalyzed: 13, setNumber: "75192", error: null });
      for (let page = 1; page <= 6; page++) {
        const [meta] = await bucket.file(storagePaths.pageImage(calId, "m1", page)).getMetadata();
        expect(String(meta.generation)).toBe(generations.get(page));
      }
      const page3 = (await db.doc(paths.page(calId, "m1", 3)).get()).data() as PageDoc;
      expect(page3.width).toBe(4); // kept as it was
      expect((await db.doc(paths.page(calId, "m1", 13)).get()).get("analysis")).not.toBeNull();
      expect((await bucket.file(storagePaths.pageImage(calId, "m1", 13)).exists())[0]).toBe(true);
      expect((await bucket.file(storagePaths.cutout(calId, "m1:20:0", "none")).exists())[0]).toBe(false);
      expect(await calendar(calId)).toMatchObject({ draft: "done", currentVersion: 1 });
    });

    it("reruns a manual stuck in processing for more than 15 minutes", async () => {
      const calId = await seedCalendar();
      await failedManual(calId, "analyzing", minutesAgo(16));
      expect(await retryManualHandler(deps(), as("amund", { calendarId: calId, manualId: "m1" }))).toEqual({ ok: true });
      expect((await db.doc(paths.manual(calId, "m1")).get()).get("status")).toBe("done");
    });

    it("rejects manual and calendar ids with '/' or ':'", async () => {
      for (const data of [
        { calendarId: "2026-ida", manualId: "m1/x" },
        { calendarId: "2026-ida", manualId: "m1:2" },
        { calendarId: "2026/ida", manualId: "m1" },
      ]) {
        await expect(retryManualHandler(deps(), as("amund", data))).rejects.toMatchObject({ code: "invalid-argument" });
      }
    });

    it("refuses a manual that is still processing or done, and children", async () => {
      const calId = await seedCalendar();
      await failedManual(calId, "rendering", minutesAgo(2));
      await expect(retryManualHandler(deps(), as("amund", { calendarId: calId, manualId: "m1" }))).rejects.toMatchObject({
        code: "failed-precondition",
      });
      await db.doc(paths.manual(calId, "m1")).update({ status: "done" });
      await expect(retryManualHandler(deps(), as("amund", { calendarId: calId, manualId: "m1" }))).rejects.toMatchObject({
        code: "failed-precondition",
      });
      await db.doc(paths.manual(calId, "m1")).update({ status: "error" });
      await expect(retryManualHandler(deps(), as("ida", { calendarId: calId, manualId: "m1" }))).rejects.toMatchObject({
        code: "permission-denied",
      });
      expect((await db.doc(paths.page(calId, "m1", 20)).get()).exists).toBe(true);
    });
  });

  describe("renderCutouts", () => {
    it("is not-found for a missing version", async () => {
      const calId = await drafted();
      await expect(renderCutoutsHandler(deps(), as("amund", { calendarId: calId, version: 5 }))).rejects.toMatchObject({
        code: "not-found",
      });
    });

    it("renders masked WebP cutouts once per step and mask set", async () => {
      const calId = await drafted();
      const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#ffffff" } }).png().toBuffer();
      for (let page = 1; page <= 13; page++) await bucket.file(storagePaths.pageImage(calId, "m1", page)).save(png);
      await editPlanHandler(deps(), as("amund", { calendarId: calId, baseVersion: 1, ops: [{ type: "hide", hidden: adultHide }], summary: "x" }));

      const { cutouts } = await renderCutoutsHandler(deps(), as("amund", { calendarId: calId, version: 2 }));
      expect(Object.keys(cutouts)).toHaveLength(24);
      // Step m1:2:0 is the left half of page 2 (100x100 px); the hidden region covers its top-left quarter.
      const masked = cutouts["m1:2:0"]!;
      expect(masked).toMatch(new RegExp(`^julekalender/${calId}/cutouts/m1:2:0/[0-9a-f]{12}\\.webp$`));
      expect(cutouts["m1:3:0"]).toBe(storagePaths.cutout(calId, "m1:3:0", "none"));

      const [file] = await bucket.file(masked).download();
      const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(info).toMatchObject({ width: 100, height: 100 });
      const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
      const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) <= 6);
      expect(near(at(20, 20), [0xc2, 0xc8, 0xcc])).toBe(true); // inside x 0–50, y 0–50
      expect(near(at(80, 80), [255, 255, 255])).toBe(true);
      const [meta] = await bucket.file(masked).getMetadata();
      expect(meta.contentType).toBe("image/webp");

      // A second call reuses what exists.
      const again = await renderCutoutsHandler(deps(), as("amund", { calendarId: calId, version: 2 }));
      expect(again.cutouts).toEqual(cutouts);
      const [meta2] = await bucket.file(masked).getMetadata();
      expect(meta2.generation).toBe(meta.generation);

      await expect(renderCutoutsHandler(deps(), as("ida", { calendarId: calId, version: 2 }))).rejects.toMatchObject({
        code: "permission-denied",
      });
    });
  });
});
