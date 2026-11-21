import { ThemeColors } from "@meling/shared";
import sharp from "sharp";
import { z } from "zod";
import {
  clientFor,
  type GenerateClient,
  type GenerateResponse,
  geminiConfig,
  isRetryable,
  parseGeminiResponse,
  type RetryOptions,
  withRetry,
} from "../gemini";

export const IMAGE_MODEL = "gemini-3.1-flash-image";

/** Image model, read from the environment on every call. */
export function imageModel(): string {
  return process.env.GEMINI_IMAGE_MODEL || IMAGE_MODEL;
}

export const ThemePlan = z.object({
  style: z.string().min(1),
  colors: ThemeColors,
  motifs: z.array(z.string().min(1)).length(24),
});
export type ThemePlan = z.infer<typeof ThemePlan>;

/** The model gave no picture: a safety stop, another finish reason, or no image part. Not retried. */
export class ImageRefusedError extends Error {}

/** Marks a failed generateContent call (as opposed to a bad answer) so only retryable HTTP errors are retried. */
class PlanCallError extends Error {
  constructor(override readonly cause: unknown) {
    super("Gemini tema: kallet feilet", { cause });
  }
}

export interface ThemeAi {
  planTheme(prompt: string, childName: string): Promise<ThemePlan>;
  styleImage(style: string): Promise<Buffer>;
  doorImage(style: string, motif: string, reference: Buffer): Promise<Buffer>;
}

export const PLAN_PROMPT = `Du lager et tema for en julekalender med 24 luker til et barn. Svar med JSON etter skjemaet.
- style: én kort stilbeskrivelse som skal gjelde for alle bildene (for eksempel materiale, former og farger). Ikke bruk varemerkenavn; skriv «byggeklosser og minifigurer», ikke «LEGO».
- colors: fem farger som #rrggbb: bg (bakgrunn), door (lukene), done (åpnede luker), accent og text. Lukenummeret tegnes oppå luka med text-fargen, så både door og done må ha god kontrast mot text.
- motifs: nøyaktig 24 ulike motiver som hører sammen, enkle nok for en femåring. Ikke bruk varemerkenavn.`;

export const IMAGE_RULES = `Bildet skal være kvadratisk, uten tekst, bokstaver eller tall, barnevennlig og ikke skummelt, med motivet midt i bildet og rolig bakgrunn.`;

const stylePrompt = (style: string) => `Lag et bilde som viser stilen: ${style}.\n${IMAGE_RULES}`;
const doorPrompt = (style: string, motif: string) =>
  `Lag et bilde av: ${motif}. Samme stil som referansebildet. Stil: ${style}.\n${IMAGE_RULES}`;

export function vertexThemeAi(client?: GenerateClient, retry: RetryOptions = {}): ThemeAi {
  const c = () => client ?? clientFor(geminiConfig().location);

  const plan = async (text: string): Promise<ThemePlan> =>
    withRetry(
      async () => {
        let res: GenerateResponse;
        try {
          res = await c().models.generateContent({
            model: geminiConfig().model,
            contents: [{ role: "user", parts: [{ text }] }],
            config: { responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(ThemePlan) },
          } as never);
        } catch (e) {
          throw new PlanCallError(e);
        }
        // Empty, truncated, malformed or invalid answers are usually transient: try again.
        return ThemePlan.parse(parseGeminiResponse(res, "tema"));
      },
      (e) => !(e instanceof PlanCallError) || isRetryable(e.cause),
      retry,
    ).catch((e: unknown) => {
      throw e instanceof PlanCallError ? e.cause : e;
    });

  const image = async (parts: unknown[], context: string): Promise<Buffer> =>
    withRetry(
      async () => {
        const res: GenerateResponse = await c().models.generateContent({
          model: imageModel(),
          contents: [{ role: "user", parts }],
          config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
        } as never);
        const cand = res.candidates?.[0];
        if (cand?.finishReason !== undefined && cand.finishReason !== "STOP") {
          throw new ImageRefusedError(`Gemini ${context}: avsluttet med ${cand.finishReason}`);
        }
        const data = cand?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
        if (!data) throw new ImageRefusedError(`Gemini ${context}: ingen bilde i svaret`);
        return Buffer.from(data, "base64");
      },
      (e) => !(e instanceof ImageRefusedError) && isRetryable(e),
      retry,
    );

  return {
    planTheme: (prompt, childName) => plan(`${PLAN_PROMPT}\n\nBarnets navn: ${childName}\nØnsket tema: ${prompt}`),
    styleImage: (style) => image([{ text: stylePrompt(style) }], "stilbilde"),
    doorImage: (style, motif, reference) =>
      image(
        [{ inlineData: { mimeType: "image/png", data: reference.toString("base64") } }, { text: doorPrompt(style, motif) }],
        `luke «${motif}»`,
      ),
  };
}

const FAKE_PLAN: ThemePlan = {
  style: "enkle, runde former i julefarger",
  colors: { bg: "#0b3d2e", door: "#c8102e", done: "#f4d35e", accent: "#ffffff", text: "#111111" },
  motifs: Array.from({ length: 24 }, (_, i) => `m${i + 1}`),
};

const png = (seed: string) => {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: h & 255, g: (h >> 8) & 255, b: (h >> 16) & 255 } },
  })
    .png()
    .toBuffer();
};

/** Deterministic AI for tests and emulator runs; no network. `refuse` lists motifs that get ImageRefusedError. */
export function fakeThemeAi(opts: { refuse?: Set<string> } = {}): ThemeAi {
  return {
    planTheme: async () => FAKE_PLAN,
    styleImage: (style) => png(`style:${style}`),
    doorImage: async (_style, motif) => {
      if (opts.refuse?.has(motif)) throw new ImageRefusedError(`Fake: ${motif} avvist`);
      return png(motif);
    },
  };
}

export const themeAiFromEnv = (): ThemeAi => (process.env.MELING_FAKE_AI === "1" ? fakeThemeAi() : vertexThemeAi());
