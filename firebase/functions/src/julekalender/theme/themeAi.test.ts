import { afterEach, describe, expect, it } from "vitest";
import type { GenerateClient } from "../gemini";
import { fakeThemeAi, ImageRefusedError, vertexThemeAi } from "./themeAi";

const colors = { bg: "#0b3d2e", door: "#c8102e", done: "#f4d35e", accent: "#ffffff", text: "#111111" };
const motifs = Array.from({ length: 24 }, (_, i) => `motiv ${i + 1}`);
const plan24 = { style: "byggeklosser og minifigurer", colors, motifs };

type Req = {
  model: string;
  contents: { parts: ({ text?: string; inlineData?: { mimeType: string; data: string } })[] }[];
  config: { responseModalities?: string[]; imageConfig?: { aspectRatio?: string } };
};

function scripted(...answers: (object | Error)[]) {
  const calls: Req[] = [];
  const client: GenerateClient = {
    models: {
      generateContent: async (req: never) => {
        calls.push(req as Req);
        const next = answers.shift();
        if (next === undefined) throw new Error("no more answers");
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
  return { client, calls };
}

const imageAnswer = {
  candidates: [
    { finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from("png").toString("base64") } }] } },
  ],
};
const noSleep = { sleep: async () => {} };

describe("vertexThemeAi", () => {
  afterEach(() => {
    delete process.env.GEMINI_IMAGE_MODEL;
  });

  it("planTheme parses the plan and sends the prompt and child name", async () => {
    const { client, calls } = scripted({ text: JSON.stringify(plan24), candidates: [{ finishReason: "STOP" }] });
    const plan = await vertexThemeAi(client, noSleep).planTheme("LEGO-jul", "Ida");
    expect(plan).toEqual(plan24);
    const text = calls[0]?.contents[0]?.parts.map((p) => p.text ?? "").join("\n");
    expect(text).toContain("LEGO-jul");
    expect(text).toContain("Ida");
  });

  it("planTheme rejects a plan without 24 motifs, after three attempts", async () => {
    const bad = { text: JSON.stringify({ ...plan24, motifs: motifs.slice(0, 23) }), candidates: [{ finishReason: "STOP" }] };
    const { client, calls } = scripted(bad, bad, bad);
    await expect(vertexThemeAi(client, noSleep).planTheme("jul", "Ida")).rejects.toThrow(/motifs/);
    expect(calls).toHaveLength(3);
  });

  it("planTheme retries an invalid plan and accepts the next one", async () => {
    const bad = { text: JSON.stringify({ ...plan24, motifs: [] }), candidates: [{ finishReason: "STOP" }] };
    const good = { text: JSON.stringify(plan24), candidates: [{ finishReason: "STOP" }] };
    const { client, calls } = scripted(bad, good);
    expect(await vertexThemeAi(client, noSleep).planTheme("jul", "Ida")).toEqual(plan24);
    expect(calls).toHaveLength(2);
  });

  it("planTheme does not retry a 400 call error", async () => {
    const { client, calls } = scripted(Object.assign(new Error("HTTP 400"), { status: 400 }), { text: JSON.stringify(plan24) });
    await expect(vertexThemeAi(client, noSleep).planTheme("jul", "Ida")).rejects.toThrow(/HTTP 400/);
    expect(calls).toHaveLength(1);
  });

  it("doorImage sends the reference image and returns the image bytes", async () => {
    const { client, calls } = scripted(imageAnswer);
    const reference = Buffer.from("ref");
    const img = await vertexThemeAi(client, noSleep).doorImage("stil", "snømann", reference);
    expect(img).toEqual(Buffer.from("png"));
    const req = calls[0] as Req;
    expect(req.model).toBe("gemini-3.1-flash-image");
    expect(req.config.responseModalities).toContain("IMAGE");
    expect(req.config.imageConfig?.aspectRatio).toBe("1:1");
    expect(req.contents[0]?.parts[0]?.inlineData?.data).toBe(reference.toString("base64"));
  });

  it("styleImage returns the image bytes", async () => {
    const { client } = scripted(imageAnswer);
    expect(await vertexThemeAi(client, noSleep).styleImage("stil")).toEqual(Buffer.from("png"));
  });

  it("doorImage uses GEMINI_IMAGE_MODEL", async () => {
    process.env.GEMINI_IMAGE_MODEL = "x-image";
    const { client, calls } = scripted(imageAnswer);
    await vertexThemeAi(client, noSleep).doorImage("stil", "m", Buffer.from("ref"));
    expect(calls[0]?.model).toBe("x-image");
  });

  it("doorImage throws ImageRefusedError without retrying on a safety stop", async () => {
    const { client, calls } = scripted({ candidates: [{ finishReason: "IMAGE_SAFETY" }] }, imageAnswer);
    await expect(vertexThemeAi(client, noSleep).doorImage("stil", "m", Buffer.from("ref"))).rejects.toBeInstanceOf(ImageRefusedError);
    expect(calls).toHaveLength(1);
  });

  it("doorImage retries a 429", async () => {
    const { client, calls } = scripted(Object.assign(new Error("HTTP 429"), { status: 429 }), imageAnswer);
    const img = await vertexThemeAi(client, noSleep).doorImage("stil", "m", Buffer.from("ref"));
    expect(img).toEqual(Buffer.from("png"));
    expect(calls).toHaveLength(2);
  });
});

describe("fakeThemeAi", () => {
  it("returns a fixed plan with 24 motifs and PNG images", async () => {
    const ai = fakeThemeAi();
    const plan = await ai.planTheme("x", "Ida");
    expect(plan.motifs).toHaveLength(24);
    const img = await ai.styleImage("s");
    expect(img.subarray(1, 4).toString()).toBe("PNG");
  });

  it("refuses chosen motifs", async () => {
    const ai = fakeThemeAi({ refuse: new Set(["m3"]) });
    await expect(ai.doorImage("s", "m3", Buffer.from("ref"))).rejects.toBeInstanceOf(ImageRefusedError);
    await expect(ai.doorImage("s", "m4", Buffer.from("ref"))).resolves.toBeInstanceOf(Buffer);
  });
});
