import { logger } from "firebase-functions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeAi } from "./themeAi";
import type { ThemeDeps } from "./themeJob";
import { runThemeDoorTaskHandler, runThemeGenerationTaskHandler } from "./themeTasks";

/** Deps where every use fails the test: an invalid payload must not reach Firestore, Storage or the AI. */
function untouchableDeps() {
  const fail = vi.fn(() => {
    throw new Error("must not be called");
  });
  const themeAi: ThemeAi = { planTheme: fail, styleImage: fail, doorImage: fail };
  const db = { doc: fail, runTransaction: fail } as unknown as ThemeDeps["db"];
  const bucket = { file: fail, getFiles: fail } as unknown as ThemeDeps["bucket"];
  return { deps: { db, bucket, themeAi } satisfies ThemeDeps, fail };
}

describe("theme task handlers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
  });

  it("runThemeGenerationTaskHandler ignores an invalid payload", async () => {
    const valid = { calendarId: "2026-abc", generationId: "g1", prompt: "Dinosaurer", childName: "Ida" };
    for (const data of [
      undefined,
      {},
      { ...valid, calendarId: "../x" },
      { ...valid, generationId: "" },
      { ...valid, prompt: "" },
      { ...valid, prompt: "x".repeat(501) },
      { ...valid, childName: 3 },
    ]) {
      const { deps, fail } = untouchableDeps();
      await expect(runThemeGenerationTaskHandler(deps, data)).resolves.toBeUndefined();
      expect(fail).not.toHaveBeenCalled();
    }
    expect(logger.error).toHaveBeenCalledTimes(7);
  });

  it("runThemeDoorTaskHandler ignores an invalid payload", async () => {
    const valid = { calendarId: "2026-abc", generationId: "g1", day: 3 };
    for (const data of [null, { ...valid, day: 0 }, { ...valid, day: 25 }, { ...valid, day: 2.5 }, { ...valid, generationId: "" }, { ...valid, calendarId: "" }]) {
      const { deps, fail } = untouchableDeps();
      await expect(runThemeDoorTaskHandler(deps, data)).resolves.toBeUndefined();
      expect(fail).not.toHaveBeenCalled();
    }
  });
});
