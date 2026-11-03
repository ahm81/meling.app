import { afterEach, describe, expect, it, vi } from "vitest";
import { type GenerateClient, geminiConfig, isRetryable, vertexAi } from "./gemini";

const ok = { text: '{"a":1}', candidates: [{ finishReason: "STOP" }] };
const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

/** A client that answers each call with the next entry; an Error entry is thrown. */
function scripted(...answers: (object | Error)[]) {
  const calls: { model: string }[] = [];
  const client: GenerateClient = {
    models: {
      generateContent: async (req: never) => {
        calls.push(req as { model: string });
        const next = answers.shift();
        if (next === undefined) throw new Error("no more answers");
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
  return { client, calls };
}

function run(answers: (object | Error)[]) {
  const { client, calls } = scripted(...answers);
  const delays: number[] = [];
  const ai = vertexAi(client, { sleep: async (ms) => void delays.push(ms), random: () => 0.5 });
  return { result: ai.analyzePage(Buffer.alloc(0), 3), calls, delays };
}

describe("Gemini retry", () => {
  it("retries 429 and 5xx, then succeeds", async () => {
    const r = run([apiError(429), apiError(503), ok]);
    expect(await r.result).toEqual({ a: 1 });
    expect(r.calls).toHaveLength(3);
    expect(r.delays).toEqual([2000, 6000]);
  });

  it("retries network errors and malformed responses", async () => {
    const r = run([new TypeError("fetch failed"), { text: "{oops" }, ok]);
    expect(await r.result).toEqual({ a: 1 });
    expect(r.calls).toHaveLength(3);
  });

  it("retries empty answers and non-STOP finishes", async () => {
    const r = run([{}, { text: "{}", candidates: [{ finishReason: "MAX_TOKENS" }] }, ok]);
    expect(await r.result).toEqual({ a: 1 });
  });

  it("gives up after three attempts with the last error", async () => {
    const r = run([apiError(500), apiError(500), { text: "{oops" }, ok]);
    await expect(r.result).rejects.toThrow(/side 3: ugyldig JSON/);
    expect(r.calls).toHaveLength(3);
  });

  it("does not retry other client errors", async () => {
    const r = run([apiError(400), ok]);
    await expect(r.result).rejects.toThrow(/side 3: kallet feilet/);
    expect(r.calls).toHaveLength(1);
    expect(r.delays).toEqual([]);
  });

  it("jitters the delays", async () => {
    const { client } = scripted(apiError(500), apiError(500), ok);
    const delays: number[] = [];
    await vertexAi(client, { sleep: async (ms) => void delays.push(ms), random: () => 0 }).analyzePage(Buffer.alloc(0), 1);
    expect(delays).toEqual([1500, 4500]);
  });

  it("classifies errors", () => {
    expect(isRetryable(apiError(429))).toBe(true);
    expect(isRetryable(apiError(502))).toBe(true);
    expect(isRetryable(apiError(403))).toBe(false);
    expect(isRetryable(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
  });
});

describe("Gemini config", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to the built-in model on global", () => {
    vi.stubEnv("GEMINI_MODEL", "");
    vi.stubEnv("GEMINI_LOCATION", "");
    expect(geminiConfig()).toEqual({ model: "gemini-2.5-pro", location: "global" });
  });

  it("reads model and location from the environment at call time", async () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-x");
    vi.stubEnv("GEMINI_LOCATION", "europe-west4");
    expect(geminiConfig()).toEqual({ model: "gemini-x", location: "europe-west4" });
    const { client, calls } = scripted(ok);
    await vertexAi(client).analyzePage(Buffer.alloc(0), 1);
    expect(calls[0]!.model).toBe("gemini-x");
  });
});
