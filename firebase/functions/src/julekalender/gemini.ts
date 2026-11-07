import { GoogleGenAI } from "@google/genai";
import type { Part } from "@meling/shared";
import { z } from "zod";
import { RawConstraints, RawPageAnalysis } from "./analysis";

// gemini-2.5-pro is no longer available to this project on Vertex (404); 3.8 Flash was checked with try-analysis.
export const GEMINI_MODEL = "gemini-3.8-flash";
export const GEMINI_LOCATION = "global";

/** Model and Vertex location, read from the environment on every call (functions .env or the shell). */
export function geminiConfig(): { model: string; location: string } {
  return {
    model: process.env.GEMINI_MODEL || GEMINI_MODEL,
    location: process.env.GEMINI_LOCATION || GEMINI_LOCATION,
  };
}

export const PAGE_PROMPT = `Du ser én side fra en LEGO-bruksanvisning. Svar med JSON etter skjemaet.
- kind: "cover" for forsiden, "instructions" for sider med byggetrinn, "inventory" for brikkeoversikt, ellers "other".
- steps: hvert nummererte byggetrinn på siden, i lesrekkefølge. printed_number er trinnnummeret som er trykt. box_2d er [ymin, xmin, ymax, xmax] i 0–1000 og skal omslutte både tegningen og brikkeboksen for trinnet.
- parts: brikkene i brikkeboksen for trinnet (antall, navn, farge). Tom liste hvis trinnet ikke har brikkeboks.
- spoilers: områder som viser ferdig modell eller en forhåndsvisning av et delbygg, med box_2d og kort label.
- inventory: brikker fra en brikkeoversikt-side, ellers tom liste.
- set_number: settnummeret hvis det står på forsiden, ellers null.`;

export const WISHES_PROMPT = `Du får de voksnes ønsker for en LEGO-julekalender og en liste over byggetrinn (id, trykt nummer, rekkefølge, side, brikker).
Kalenderen har 24 luker. Trinnene fordeles i rekkefølge på lukene. Oversett ønskene til begrensninger og svar med JSON etter skjemaet:
- stepOnDay: trinnet skal ligge på en bestemt luke (1–24).
- stepLast: trinnet skal være det siste trinnet på sin dag; en lukegrense faller rett etter det.
Bruk bare id-er fra listen. Ta bare med begrensninger ønskene faktisk ber om.`;

export interface Ai {
  analyzePage(png: Buffer, page: number): Promise<unknown>;
  interpretWishes(
    text: string,
    steps: { id: string; printedNumber: number; manualOrder: number; page: number; parts: Part[] }[],
  ): Promise<unknown>;
}

type GenerateResponse = { text?: string; candidates?: { finishReason?: string }[] };
export type GenerateClient = { models: { generateContent(req: never): Promise<GenerateResponse> } };

/** Turns a Gemini response into parsed JSON, or throws an error with context and the original cause. */
export function parseGeminiResponse(res: GenerateResponse, context: string): unknown {
  const fail = (reason: string, cause?: unknown) => new Error(`Gemini ${context}: ${reason}`, { cause });
  const finish = res.candidates?.[0]?.finishReason;
  if (finish !== undefined && finish !== "STOP") throw fail(`avsluttet med ${finish}`);
  if (!res.text) throw fail("tomt svar");
  try {
    return JSON.parse(res.text) as unknown;
  } catch (e) {
    throw fail("ugyldig JSON", e);
  }
}

export interface RetryOptions {
  /** Total attempts per call (default 3). */
  attempts?: number;
  /** Base delay before attempt 2, 3, … (default 2 s, 6 s); each is jittered ±25 %. */
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** 408, 429 and 5xx are worth another try; so are errors without an HTTP status (network failures). */
export function isRetryable(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return true;
  return status === 408 || status === 429 || status >= 500;
}

class GeminiCallError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    cause: unknown,
  ) {
    super(message, { cause });
  }
}

const clients = new Map<string, GenerateClient>();
function clientFor(location: string): GenerateClient {
  let c = clients.get(location);
  if (!c) {
    // Vertex AI via Application Default Credentials; no key.
    c = new GoogleGenAI({ vertexai: true, project: "meling-app", location }) as unknown as GenerateClient;
    clients.set(location, c);
  }
  return c;
}

export function vertexAi(client?: GenerateClient, retry: RetryOptions = {}): Ai {
  const {
    attempts = 3,
    delaysMs = [2000, 6000],
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    random = Math.random,
  } = retry;

  const once = async (contents: unknown, schema: z.ZodType, context: string) => {
    const { model, location } = geminiConfig();
    let res: GenerateResponse;
    try {
      res = await (client ?? clientFor(location)).models.generateContent({
        model,
        contents,
        config: { responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(schema) },
      } as never);
    } catch (e) {
      throw new GeminiCallError(`Gemini ${context}: kallet feilet`, isRetryable(e), e);
    }
    // Empty, truncated or malformed answers are usually transient: try again.
    return parseGeminiResponse(res, context);
  };

  const generate = async (contents: unknown, schema: z.ZodType, context: string) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await once(contents, schema, context);
      } catch (e) {
        const retryable = !(e instanceof GeminiCallError) || e.retryable;
        if (!retryable || attempt >= attempts) {
          throw e instanceof GeminiCallError ? new Error(e.message, { cause: e.cause }) : e;
        }
        const base = delaysMs[Math.min(attempt - 1, delaysMs.length - 1)] ?? 0;
        await sleep(Math.round(base * (0.75 + random() * 0.5)));
      }
    }
  };
  return {
    analyzePage: (png, page) =>
      generate(
        [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }, { text: PAGE_PROMPT }] }],
        RawPageAnalysis,
        `side ${page}`,
      ),
    interpretWishes: (text, steps) =>
      generate(
        [{ role: "user", parts: [{ text: `${WISHES_PROMPT}\n\nØnsker:\n${text}\n\nTrinn:\n${JSON.stringify(steps)}` }] }],
        RawConstraints,
        "ønsker",
      ),
  };
}

const part = (n: number) => ({ qty: n, name: `Brikke ${n}`, color: "Rød" });

function syntheticPage(page: number): unknown {
  if (page === 1) return { kind: "cover", steps: [], spoilers: [], inventory: [], set_number: "00000" };
  return {
    kind: "instructions",
    steps: [
      { printed_number: 1, box_2d: [0, 0, 1000, 500], parts: [part(1), part(2), part(3)] },
      { printed_number: 2, box_2d: [0, 500, 1000, 1000], parts: [part(1), part(2), part(3)] },
    ],
    spoilers: [],
    inventory: [],
    set_number: null,
  };
}

/** Deterministic AI for tests and emulator runs. Pages without an entry get a synthetic analysis. */
export function fakeAi(pages: Record<number, unknown>): Ai {
  return {
    analyzePage: async (_png, page) => pages[page] ?? syntheticPage(page),
    interpretWishes: async () => ({ constraints: [] }),
  };
}

export const aiFromEnv = (): Ai => (process.env.MELING_FAKE_AI === "1" ? fakeAi({}) : vertexAi());
