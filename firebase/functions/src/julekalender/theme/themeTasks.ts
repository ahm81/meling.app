import { DOOR_COUNT } from "@meling/shared";
import { getFirestore } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { z } from "zod";
import { Id } from "../callables";
import { themeAiFromEnv } from "./themeAi";
import { type ThemeDeps, regenerateDraftDoor, runThemeGeneration } from "./themeJob";

// The theme jobs run as Cloud Tasks task-queue functions, so they finish even if the adult closes the tab: the
// callables only check, write the draft and enqueue. Payloads are validated here, since anyone with
// cloudtasks.enqueuer could add a task.

const REGION = "europe-west1";
const GENERATION_TIMEOUT_S = 1800;
const DOOR_TIMEOUT_S = 540;

export const ThemeGenerationPayload = z.object({
  calendarId: Id,
  generationId: z.string().min(1),
  prompt: z.string().min(1).max(500),
  childName: z.string(),
});
export type ThemeGenerationPayload = z.infer<typeof ThemeGenerationPayload>;

export const ThemeDoorPayload = z.object({ calendarId: Id, generationId: z.string().min(1), day: z.int().min(1).max(DOOR_COUNT) });
export type ThemeDoorPayload = z.infer<typeof ThemeDoorPayload>;

/** Runs a theme generation. An invalid payload is logged and dropped: throwing would only make Cloud Tasks retry it. */
export async function runThemeGenerationTaskHandler(deps: ThemeDeps, data: unknown): Promise<void> {
  const parsed = ThemeGenerationPayload.safeParse(data);
  if (!parsed.success) {
    logger.error("Tema: ugyldig oppgave for temaet, droppet", { issues: parsed.error.issues });
    return;
  }
  const { calendarId, generationId, prompt, childName } = parsed.data;
  await runThemeGeneration(deps, calendarId, generationId, prompt, childName);
}

/** Makes a new variant of one door. An invalid payload is logged and dropped. */
export async function runThemeDoorTaskHandler(deps: ThemeDeps, data: unknown): Promise<void> {
  const parsed = ThemeDoorPayload.safeParse(data);
  if (!parsed.success) {
    logger.error("Tema: ugyldig oppgave for luke, droppet", { issues: parsed.error.issues });
    return;
  }
  const { calendarId, generationId, day } = parsed.data;
  await regenerateDraftDoor(deps, calendarId, generationId, day);
}

/** Enqueues on the real queues (or the Cloud Tasks emulator, through CLOUD_TASKS_EMULATOR_HOST). */
export const cloudTasksEnqueue = () => ({
  generation: (payload: ThemeGenerationPayload) =>
    getFunctions()
      .taskQueue<ThemeGenerationPayload>(`locations/${REGION}/functions/runThemeGenerationTask`)
      .enqueue(payload, { dispatchDeadlineSeconds: GENERATION_TIMEOUT_S }),
  door: (payload: ThemeDoorPayload) =>
    getFunctions()
      .taskQueue<ThemeDoorPayload>(`locations/${REGION}/functions/runThemeDoorTask`)
      .enqueue(payload, { dispatchDeadlineSeconds: DOOR_TIMEOUT_S }),
});

// ---- onTaskDispatched wrappers (region europe-west1 from setGlobalOptions)

const deps = (): ThemeDeps => ({ db: getFirestore(), bucket: getStorage().bucket(), themeAi: themeAiFromEnv() });

// maxAttempts 1: the job writes its own error state into the draft, and a retry would pay for the AI again.
// With 429 backoff (up to ~110 s per image) 24 doors can take far longer than 540 s, so the theme gets 1800 s
// (the job stops starting doors at GENERATION_DEADLINE_MS, 25 min).
export const runThemeGenerationTask = onTaskDispatched(
  { timeoutSeconds: GENERATION_TIMEOUT_S, memory: "1GiB", retryConfig: { maxAttempts: 1 }, rateLimits: { maxConcurrentDispatches: 2 } },
  (request) => runThemeGenerationTaskHandler(deps(), request.data),
);
export const runThemeDoorTask = onTaskDispatched(
  { timeoutSeconds: DOOR_TIMEOUT_S, memory: "1GiB", retryConfig: { maxAttempts: 1 }, rateLimits: { maxConcurrentDispatches: 4 } },
  (request) => runThemeDoorTaskHandler(deps(), request.data),
);
