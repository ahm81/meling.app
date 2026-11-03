import { randomUUID } from "node:crypto";
import { type CalendarDoc, DOOR_COUNT, type ManualDoc, type PageDoc, type Plan, paths, storagePaths } from "@meling/shared";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { afterAll, describe, expect, it } from "vitest";
import { toPageAnalysis } from "./analysis";
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
async function seedAnalyzedManual(calId: string, stepPages: number): Promise<void> {
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
  const ai = fakeAi({});
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
  });
});
