import {
  CalendarDoc,
  DOOR_COUNT,
  type Hidden,
  type PageAnalysis,
  PageDoc,
  type Plan,
  type Step,
  orderSteps,
  paths,
  storagePaths,
} from "@meling/shared";
import { FieldValue, type Firestore, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { ZodError } from "zod";
import { toConstraints, toPageAnalysis } from "./analysis";
import { type Constraint, TooFewBrickStepsError, TooFewStepsError, distribute } from "./distribute";
import { type Ai, aiFromEnv } from "./gemini";
import { PdfReadError, renderPdf } from "./pdf";
import { writeVersion } from "./versions";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;
export type PipelineDeps = { db: Firestore; bucket: Bucket; ai: Ai };

const MAX_CONCURRENT_ANALYSES = 6;

const manualsOf = (db: Firestore, calId: string) => db.collection(`${paths.calendar(calId)}/manuals`);
const pagesOf = (db: Firestore, calId: string) => db.collection(`${paths.calendar(calId)}/pages`);

/** Runs `fn` over `items` with at most `limit` calls in flight; stops starting new calls after the first failure. */
async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next++]!;
      try {
        await fn(item);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker));
  const rejected = results.find((r) => r.status === "rejected");
  if (rejected) throw rejected.reason;
}

/**
 * Renders a newly uploaded manual, analyses every page and, when it is the last manual to finish,
 * makes the calendar's first draft. Failures end in status "error" with a Norwegian message; it never throws
 * for them, so the trigger is not retried.
 */
export async function processManual({ db, bucket, ai }: PipelineDeps, calId: string, manualId: string): Promise<void> {
  const manualRef = db.doc(paths.manual(calId, manualId));

  // Firestore triggers are delivered at least once; only the first delivery moves "uploaded" on.
  const started = await db.runTransaction(async (tx) => {
    const snap = await tx.get(manualRef);
    if (!snap.exists || snap.get("status") !== "uploaded") return false;
    tx.update(manualRef, { status: "rendering", error: null });
    return true;
  });
  if (!started) return;

  let stage: "rendering" | "analyzing" = "rendering";
  try {
    // The path is derived, not read from the client-written storagePath (the rules make them equal).
    let pdf: Buffer;
    try {
      [pdf] = await bucket.file(storagePaths.manualPdf(calId, manualId)).download();
    } catch (e) {
      throw new UserFacingError("Fant ikke PDF-filen. Last opp manualen på nytt.", e);
    }

    const rendered: { page: number; png: Buffer }[] = [];
    for await (const { page, png, width, height } of renderPdf(pdf)) {
      const imagePath = storagePaths.pageImage(calId, manualId, page);
      await bucket.file(imagePath).save(png, { contentType: "image/png", resumable: false });
      const doc: PageDoc = { manualId, page, imagePath, width, height, analysis: null };
      await db.doc(paths.page(calId, manualId, page)).set(doc);
      rendered.push({ page, png });
    }
    await manualRef.update({ pageCount: rendered.length, status: "analyzing" });

    stage = "analyzing";
    const setNumbers = new Map<number, string>();
    await forEachLimited(rendered, MAX_CONCURRENT_ANALYSES, async ({ page, png }) => {
      const raw = await ai.analyzePage(png, page);
      let parsed: { analysis: PageAnalysis; setNumber: string | null };
      try {
        parsed = toPageAnalysis(raw);
      } catch (e) {
        throw new Error(`Gemini side ${page}: svaret har feil format`, { cause: e });
      }
      if (parsed.setNumber) setNumbers.set(page, parsed.setNumber);
      await db.doc(paths.page(calId, manualId, page)).update({ analysis: parsed.analysis });
      await manualRef.update({ pagesAnalyzed: FieldValue.increment(1) });
    });

    const firstWithSetNumber = [...setNumbers.keys()].sort((a, b) => a - b)[0];
    await manualRef.update({
      status: "done",
      setNumber: firstWithSetNumber === undefined ? null : setNumbers.get(firstWithSetNumber)!,
    });
  } catch (e) {
    logger.error("Manual pipeline failed", { calId, manualId, stage, error: e });
    await manualRef.update({ status: "error", error: manualErrorMessage(e, stage) });
    return;
  }

  await draftIfAllManualsDone(db, ai, calId);
}

class UserFacingError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "UserFacingError";
  }
}

function manualErrorMessage(e: unknown, stage: "rendering" | "analyzing"): string {
  if (e instanceof PdfReadError || e instanceof UserFacingError) return e.message;
  // Errors from the Gemini client are already Norwegian and name the page.
  if (e instanceof Error && e.message.startsWith("Gemini ")) return e.message;
  return stage === "rendering"
    ? "Sidene i manualen kunne ikke lagres. Last opp manualen på nytt."
    : "Sidene i manualen kunne ikke analyseres. Last opp manualen på nytt.";
}

async function draftIfAllManualsDone(db: Firestore, ai: Ai, calId: string): Promise<void> {
  const [manuals, cal] = await Promise.all([manualsOf(db, calId).get(), db.doc(paths.calendar(calId)).get()]);
  if (!manuals.docs.every((m) => m.get("status") === "done")) return;
  if (cal.get("draft") !== "waiting") return;
  await makeFirstDraft(db, ai, calId);
}

const WHOLE_PAGE_LABELS: Partial<Record<PageAnalysis["kind"], string>> = {
  cover: "Forside",
  inventory: "Brikkeoversikt",
  other: "Side uten byggetrinn",
};

/** What the child should not see: every spoiler, plus whole pages that are not building instructions. */
export function aiHidden(pages: { manualId: string; page: number; analysis: PageAnalysis }[]): Hidden[] {
  return pages.flatMap(({ manualId, page, analysis }) => {
    const out: Hidden[] = [];
    const pageLabel = WHOLE_PAGE_LABELS[analysis.kind];
    if (pageLabel) out.push({ id: `ai:${manualId}:${page}:page`, manualId, page, bbox: null, label: pageLabel, source: "ai" });
    analysis.spoilers.forEach((s, i) =>
      out.push({ id: `ai:${manualId}:${page}:spoiler:${i}`, manualId, page, bbox: s.bbox, label: s.label, source: "ai" }),
    );
    return out;
  });
}

function distributeWithFallback(steps: Step[], balance: "bricks" | "steps", constraints: Constraint[]): Plan["days"] {
  try {
    return distribute(steps, { balance, constraints });
  } catch (e) {
    // Too few steps with bricks to balance on: balance on steps instead.
    if (balance === "bricks" && e instanceof TooFewBrickStepsError) return distribute(steps, { balance: "steps", constraints });
    throw e;
  }
}

/**
 * Makes version 1 from the analysed pages and the adults' wishes. Runs at most once per calendar:
 * the move from draft "waiting" to "running" is transactional. Failures end in draft "error" with draftError.
 */
export async function makeFirstDraft(db: Firestore, ai: Ai, calId: string): Promise<void> {
  const calRef = db.doc(paths.calendar(calId));
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(calRef);
    if (!snap.exists || snap.get("draft") !== "waiting") return null;
    tx.update(calRef, { draft: "running", draftError: null });
    return snap.data();
  });
  if (!claimed) return;

  try {
    const cal = CalendarDoc.parse(claimed);
    const [manuals, pageSnaps] = await Promise.all([manualsOf(db, calId).get(), pagesOf(db, calId).get()]);
    const manualOrder = new Map(manuals.docs.map((m) => [m.id, m.get("order") as number]));
    const pages = pageSnaps.docs.flatMap((d) => {
      const p = PageDoc.parse(d.data());
      const order = manualOrder.get(p.manualId);
      return p.analysis && order !== undefined ? [{ manualId: p.manualId, manualOrder: order, page: p.page, analysis: p.analysis }] : [];
    });

    const steps = orderSteps(pages);
    // Checked here too so a hopeless draft does not spend an AI call on the wishes.
    if (steps.length < DOOR_COUNT) throw new TooFewStepsError(steps.length);
    let constraints: Constraint[] = [];
    if (cal.wishes.text.trim()) {
      const raw = await ai.interpretWishes(
        cal.wishes.text,
        steps.map(({ id, printedNumber, manualOrder, page, parts }) => ({ id, printedNumber, manualOrder, page, parts })),
      );
      try {
        constraints = toConstraints(raw, new Set(steps.map((s) => s.id)));
      } catch (e) {
        throw new Error("Gemini ønsker: svaret har feil format", { cause: e });
      }
    }

    const days = distributeWithFallback(steps, cal.wishes.balance, constraints);
    await writeVersion(db, calId, {
      baseVersion: cal.currentVersion,
      author: { kind: "ai", requestedBy: null },
      summary: "Førsteutkast fra AI",
      plan: { days, hidden: aiHidden(pages) },
    });
    await calRef.update({ draft: "done", draftError: null });
  } catch (e) {
    logger.error("First draft failed", { calId, error: e });
    const message =
      e instanceof Error && !(e instanceof ZodError) ? e.message : "Førsteutkastet kunne ikke lages på grunn av en intern feil.";
    await calRef.update({ draft: "error", draftError: message });
  }
}

export const onManualCreated = onDocumentCreated(
  { document: "julekalender/{calId}/manuals/{manualId}", timeoutSeconds: 540, memory: "2GiB" },
  async (event) => {
    await processManual(
      { db: getFirestore(), bucket: getStorage().bucket(), ai: aiFromEnv() },
      event.params.calId,
      event.params.manualId,
    );
  },
);
