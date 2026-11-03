import { GoogleGenAI } from "@google/genai";
import type { Part } from "@meling/shared";
import { z } from "zod";
import { RawConstraints, RawPageAnalysis } from "./analysis";

export const GEMINI_MODEL = "gemini-2.5-pro";

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

export function vertexAi(): Ai {
  // Vertex AI via Application Default Credentials; no key.
  const client = new GoogleGenAI({ vertexai: true, project: "meling-app", location: "global" });
  const generate = async (contents: unknown, schema: z.ZodType) => {
    const res = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: contents as never,
      config: { responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(schema) },
    });
    return JSON.parse(res.text ?? "null") as unknown;
  };
  return {
    analyzePage: (png) =>
      generate(
        [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }, { text: PAGE_PROMPT }] }],
        RawPageAnalysis,
      ),
    interpretWishes: (text, steps) =>
      generate(
        [{ role: "user", parts: [{ text: `${WISHES_PROMPT}\n\nØnsker:\n${text}\n\nTrinn:\n${JSON.stringify(steps)}` }] }],
        RawConstraints,
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
