import { httpsCallable } from "firebase/functions";
import type { PlanOp } from "@meling/shared";
import { functions } from "../../firebase";

const standard = { timeout: 120_000 };
// Long-running: callers must follow progress through Firestore snapshots (useCalendar), not the reply.
const long = { timeout: 540_000 };

export const editPlan = httpsCallable<
  { calendarId: string; baseVersion: number; ops: PlanOp[]; summary: string },
  { version: number }
>(functions, "editPlan", standard);

export const restoreVersion = httpsCallable<
  { calendarId: string; baseVersion: number; fromVersion: number },
  { version: number }
>(functions, "restoreVersion", standard);

export const redraft = httpsCallable<{ calendarId: string; baseVersion: number | null }, { version: number }>(
  functions,
  "redraft",
  long,
);

export const renderCutouts = httpsCallable<
  { calendarId: string; version: number },
  { cutouts: Record<string, string> }
>(functions, "renderCutouts", long);

export const retryManual = httpsCallable<{ calendarId: string; manualId: string }, { ok: true }>(
  functions,
  "retryManual",
  long,
);

// May make the first draft when the deleted manual was the last one holding it back.
export const deleteManual = httpsCallable<{ calendarId: string; manualId: string }, { ok: true }>(
  functions,
  "deleteManual",
  long,
);

// Reads pictures and element ids from the manuals' PDFs (no AI). The result arrives through the page snapshots too.
export const readBricks = httpsCallable<{ calendarId: string }, { elements: number; unsure: number }>(
  functions,
  "readBricks",
  long,
);

// Fire-and-forget: the call only starts a job on a Cloud Tasks queue and returns at once; the job runs on even if the
// tab is closed. Progress arrives through the calendar snapshot (`themeDraft`), so a client timeout
// (`functions/deadline-exceeded`) is harmless.
export const generateTheme = httpsCallable<{ calendarId: string; prompt: string }, { ok: true }>(
  functions,
  "generateTheme",
  standard,
);

export const regenerateDoor = httpsCallable<{ calendarId: string; day: number }, { ok: true }>(
  functions,
  "regenerateDoor",
  standard,
);

export const applyThemeDraft = httpsCallable<
  { calendarId: string; keepUploaded: boolean },
  { replaced: number; kept: number }
>(functions, "applyThemeDraft", standard);
