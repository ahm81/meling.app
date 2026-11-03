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
