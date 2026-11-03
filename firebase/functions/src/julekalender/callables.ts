import { CalendarDoc, type Hidden, Plan, PlanOp, type Step, paths, storagePaths } from "@meling/shared";
import { FieldValue, type Firestore, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { maskFor, maskKey, renderCutout } from "./cutouts";
import { aiFromEnv } from "./gemini";
import { InvalidOpError, applyOps } from "./ops";
import {
  type PipelineDeps,
  computeDraft,
  draftErrorMessage,
  forEachLimited,
  isDraftDomainError,
  loadSteps,
  manualsOf,
  pagesOf,
  processClaimedManual,
  safeUpdate,
  withDates,
} from "./pipeline";
import { StaleVersionError, writeVersion } from "./versions";

export type CallableDeps = PipelineDeps;
/** The part of a CallableRequest the handlers use, so tests can call them directly. */
export type CallRequest = { auth?: { uid: string } | null; data: unknown };

/** A draft or manual that has not moved for this long is considered stuck and may be redone. */
const STALE_MS = 15 * 60_000;
const MAX_CONCURRENT_PAGES = 6;

/** The caller's uid, if they are an adult member (members/{uid}.role == "adult"). */
export async function requireAdult(db: Firestore, request: CallRequest): Promise<string> {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("permission-denied", "Du må være logget inn.");
  const member = await db.doc(paths.member(uid)).get();
  if (!member.exists || member.get("role") !== "adult") {
    throw new HttpsError("permission-denied", "Bare voksne kan endre julekalenderen.");
  }
  return uid;
}

// Ids become document paths; a slash would reach another document.
const Id = z.string().min(1).max(200).regex(/^[^/]+$/);

function parseInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpsError("invalid-argument", "Ugyldig forespørsel.");
  return result.data;
}

/** Plan errors become errors the client can show; everything else stays internal. */
function toHttpsError(e: unknown): unknown {
  if (e instanceof InvalidOpError) return new HttpsError("invalid-argument", e.message);
  if (e instanceof StaleVersionError) return new HttpsError("failed-precondition", e.message);
  return e;
}

async function requireCalendar(db: Firestore, calId: string): Promise<CalendarDoc> {
  const snap = await db.doc(paths.calendar(calId)).get();
  if (!snap.exists) throw new HttpsError("not-found", "Fant ikke kalenderen.");
  return CalendarDoc.parse(withDates(snap.data()!));
}

async function readPlan(db: Firestore, calId: string, n: number): Promise<Plan> {
  const snap = await db.doc(paths.version(calId, n)).get();
  if (!snap.exists) throw new HttpsError("not-found", `Fant ikke versjon ${n}.`);
  return Plan.parse(snap.get("plan"));
}

const isStale = (at: Date | undefined) => at === undefined || Date.now() - at.getTime() > STALE_MS;

// ---- editPlan

const EditPlanInput = z.object({
  calendarId: Id,
  baseVersion: z.int().min(1),
  ops: z.array(PlanOp).max(500),
  summary: z.string().max(200),
});

export async function editPlanHandler({ db }: CallableDeps, request: CallRequest): Promise<{ version: number }> {
  const uid = await requireAdult(db, request);
  const { calendarId, baseVersion, ops, summary } = parseInput(EditPlanInput, request.data);
  await requireCalendar(db, calendarId);
  const [base, { steps }] = await Promise.all([readPlan(db, calendarId, baseVersion), loadSteps(db, calendarId)]);
  // Regions hidden by an adult are always the adults' own, so a redraft keeps them.
  const owned = ops.map((op): PlanOp => (op.type === "hide" ? { ...op, hidden: { ...op.hidden, source: "adult" } } : op));
  try {
    const plan = applyOps(base, steps, owned);
    const version = await writeVersion(db, calendarId, { baseVersion, author: { kind: "adult", uid }, summary, plan });
    return { version };
  } catch (e) {
    throw toHttpsError(e);
  }
}

// ---- restoreVersion

const RestoreVersionInput = z.object({ calendarId: Id, baseVersion: z.int().min(1), fromVersion: z.int().min(1) });

export async function restoreVersionHandler({ db }: CallableDeps, request: CallRequest): Promise<{ version: number }> {
  const uid = await requireAdult(db, request);
  const { calendarId, baseVersion, fromVersion } = parseInput(RestoreVersionInput, request.data);
  await requireCalendar(db, calendarId);
  const plan = await readPlan(db, calendarId, fromVersion);
  try {
    const version = await writeVersion(db, calendarId, {
      baseVersion,
      author: { kind: "adult", uid },
      summary: `Gjenopprettet versjon ${fromVersion}`,
      plan,
      restoredFrom: fromVersion,
    });
    return { version };
  } catch (e) {
    throw toHttpsError(e);
  }
}

// ---- redraft

const RedraftInput = z.object({ calendarId: Id, baseVersion: z.int().min(1).nullable() });

/**
 * Runs the AI draft again with the current wishes and writes it as a new version. Regions the adults hid
 * in the base version are kept; the AI's own hidden regions are replaced by the new draft's.
 * Allowed when the draft is done or failed, or has been "running" for more than 15 minutes.
 */
export async function redraftHandler({ db, ai }: CallableDeps, request: CallRequest): Promise<{ version: number }> {
  const uid = await requireAdult(db, request);
  const { calendarId, baseVersion } = parseInput(RedraftInput, request.data);
  const calRef = db.doc(paths.calendar(calendarId));

  const manuals = await manualsOf(db, calendarId).get();
  if (manuals.empty || !manuals.docs.every((m) => m.get("status") === "done")) {
    throw new HttpsError("failed-precondition", "Alle manualene må være ferdig analysert før et nytt utkast.");
  }

  const cal = await db.runTransaction(async (tx) => {
    const snap = await tx.get(calRef);
    if (!snap.exists) throw new HttpsError("not-found", "Fant ikke kalenderen.");
    const cal = CalendarDoc.parse(withDates(snap.data()!));
    if (cal.currentVersion !== baseVersion) throw new HttpsError("failed-precondition", new StaleVersionError().message);
    if (cal.draft === "waiting") throw new HttpsError("failed-precondition", "Førsteutkastet er ikke laget ennå.");
    if (cal.draft === "running" && !isStale(cal.draftUpdatedAt)) {
      throw new HttpsError("failed-precondition", "Et utkast lages allerede. Prøv igjen om litt.");
    }
    tx.update(calRef, { draft: "running", draftError: null, draftUpdatedAt: FieldValue.serverTimestamp() });
    return cal;
  });

  try {
    const [base, draft] = await Promise.all([
      baseVersion === null ? null : readPlan(db, calendarId, baseVersion),
      computeDraft(db, ai, calendarId, cal.wishes),
    ]);
    const kept: Hidden[] = (base?.hidden ?? []).filter((h) => h.source === "adult" && !draft.hidden.some((a) => a.id === h.id));
    const version = await writeVersion(db, calendarId, {
      baseVersion,
      author: { kind: "ai", requestedBy: uid },
      summary: "Nytt utkast fra AI",
      plan: { days: draft.days, hidden: [...draft.hidden, ...kept] },
    });
    await calRef.update({ draft: "done", draftError: null, draftUpdatedAt: FieldValue.serverTimestamp() });
    return { version };
  } catch (e) {
    logger.error("Redraft failed", { calId: calendarId, error: e });
    const message = draftErrorMessage(e, "Utkastet");
    // A calendar that had a finished draft keeps it; otherwise the failure is recorded as for the first draft.
    const restore =
      cal.draft === "done"
        ? { draft: "done", draftError: null, draftUpdatedAt: FieldValue.serverTimestamp() }
        : { draft: "error", draftError: message, draftUpdatedAt: FieldValue.serverTimestamp() };
    await safeUpdate(calRef, restore, { calId: calendarId });
    throw new HttpsError(isDraftDomainError(e) ? "failed-precondition" : "internal", message);
  }
}

// ---- retryManual

const RetryManualInput = z.object({ calendarId: Id, manualId: Id });

/** Storage folder (with trailing slash) of a path. */
const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

/**
 * Processes a manual again from its PDF: allowed when it failed, or has been stuck in "rendering" or
 * "analyzing" for more than 15 minutes. Claims the manual (status "rendering", progress reset) in a
 * transaction, deletes its pages, page images and cutouts, then runs the pipeline in this call.
 * Pipeline failures end in status "error" as usual, so the call itself still returns ok.
 */
export async function retryManualHandler(deps: CallableDeps, request: CallRequest): Promise<{ ok: true }> {
  const { db, bucket } = deps;
  await requireAdult(db, request);
  const { calendarId, manualId } = parseInput(RetryManualInput, request.data);
  const manualRef = db.doc(paths.manual(calendarId, manualId));

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(manualRef);
    if (!snap.exists) throw new HttpsError("not-found", "Fant ikke manualen.");
    const status = snap.get("status") as string;
    const updatedAt = snap.get("updatedAt");
    const stuck =
      (status === "rendering" || status === "analyzing") &&
      isStale(updatedAt instanceof Timestamp ? updatedAt.toDate() : snap.updateTime?.toDate());
    if (status !== "error" && !stuck) {
      throw new HttpsError(
        "failed-precondition",
        "Manualen kan bare prøves på nytt når den har feilet eller har stått fast i mer enn 15 minutter.",
      );
    }
    tx.update(manualRef, {
      status: "rendering",
      pageCount: null,
      pagesAnalyzed: 0,
      setNumber: null,
      error: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  const pages = await pagesOf(db, calendarId).where("manualId", "==", manualId).get();
  const writer = db.bulkWriter();
  for (const p of pages.docs) void writer.delete(p.ref);
  await writer.close();
  const cutoutsDir = dirOf(dirOf(storagePaths.cutout(calendarId, "_", "none")).slice(0, -1));
  await Promise.all([
    bucket.deleteFiles({ prefix: dirOf(storagePaths.pageImage(calendarId, manualId, 1)) }),
    // Step ids start with the manual id: `${manualId}:${page}:${index}`.
    bucket.deleteFiles({ prefix: `${cutoutsDir}${manualId}:` }),
  ]);

  await processClaimedManual(deps, calendarId, manualId);
  return { ok: true };
}

// ---- renderCutouts

const RenderCutoutsInput = z.object({ calendarId: Id, version: z.int().min(1) });

/**
 * Makes the missing cutouts for every step in a version: the page image cropped to the step, with the
 * version's hidden regions painted grey. Returns the Storage path of every step's cutout.
 */
export async function renderCutoutsHandler(
  { db, bucket }: CallableDeps,
  request: CallRequest,
): Promise<{ cutouts: Record<string, string> }> {
  await requireAdult(db, request);
  const { calendarId, version } = parseInput(RenderCutoutsInput, request.data);
  const [plan, { steps }] = await Promise.all([readPlan(db, calendarId, version), loadSteps(db, calendarId)]);
  const byId = new Map(steps.map((s) => [s.id, s]));

  const byPage = new Map<string, { step: Step; path: string; masks: ReturnType<typeof maskFor> }[]>();
  const cutouts: Record<string, string> = {};
  for (const id of plan.days.flatMap((d) => d.stepIds)) {
    const step = byId.get(id);
    if (!step) throw new HttpsError("failed-precondition", `Fant ikke trinnet ${id}.`);
    const masks = maskFor(step, plan.hidden);
    const path = storagePaths.cutout(calendarId, id, maskKey(masks));
    cutouts[id] = path;
    const key = `${step.manualId}/${step.page}`;
    byPage.set(key, [...(byPage.get(key) ?? []), { step, path, masks }]);
  }

  await forEachLimited([...byPage.values()], MAX_CONCURRENT_PAGES, async (items) => {
    const exists = await Promise.all(items.map(({ path }) => bucket.file(path).exists().then(([e]) => e)));
    const todo = items.filter((_, i) => !exists[i]);
    if (todo.length === 0) return;
    const { manualId, page } = todo[0]!.step;
    // The path is derived, like the pipeline writes it, not read from the page document.
    const [image] = await bucket.file(storagePaths.pageImage(calendarId, manualId, page)).download();
    for (const { step, path, masks } of todo) {
      const webp = await renderCutout(image, step.bbox, masks);
      // Paths include the mask key, so a cutout never changes once written.
      await bucket.file(path).save(webp, {
        contentType: "image/webp",
        resumable: false,
        metadata: { cacheControl: "private, max-age=31536000, immutable" },
      });
    }
  });
  return { cutouts };
}

// ---- onCall wrappers (region europe-west1 from setGlobalOptions)

const deps = (): CallableDeps => ({ db: getFirestore(), bucket: getStorage().bucket(), ai: aiFromEnv() });

export const editPlan = onCall((request) => editPlanHandler(deps(), request));
export const restoreVersion = onCall((request) => restoreVersionHandler(deps(), request));
export const redraft = onCall({ timeoutSeconds: 300 }, (request) => redraftHandler(deps(), request));
// Same budget as the onManualCreated trigger, since it runs the same pipeline.
export const retryManual = onCall({ timeoutSeconds: 540, memory: "2GiB" }, (request) => retryManualHandler(deps(), request));
export const renderCutouts = onCall({ timeoutSeconds: 300, memory: "1GiB" }, (request) => renderCutoutsHandler(deps(), request));
