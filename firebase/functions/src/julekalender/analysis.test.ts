import { PageAnalysis } from "@meling/shared";
import { describe, expect, it } from "vitest";
import { toConstraints, toPageAnalysis } from "./analysis";
import { fakeAi } from "./gemini";

const step = (box: number[], extra: object = {}) => ({
  printed_number: 1,
  box_2d: box,
  parts: [],
  ...extra,
});
const raw = (steps: unknown[], extra: object = {}) => ({
  kind: "instructions",
  steps,
  spoilers: [],
  inventory: [],
  set_number: null,
  ...extra,
});

describe("toPageAnalysis", () => {
  it("converts box_2d to normalized bbox", () => {
    const { analysis } = toPageAnalysis(raw([step([100, 200, 600, 700])]));
    const b = analysis.steps[0]!.bbox;
    expect(b.x).toBeCloseTo(0.2);
    expect(b.y).toBeCloseTo(0.1);
    expect(b.w).toBeCloseTo(0.5);
    expect(b.h).toBeCloseTo(0.5);
    expect(PageAnalysis.parse(analysis)).toBeTruthy();
  });

  it("accepts steps without parts", () => {
    const { analysis } = toPageAnalysis(raw([step([0, 0, 500, 500])]));
    expect(analysis.steps[0]!.parts).toEqual([]);
  });

  it("drops zero-area boxes and clamps out-of-range values", () => {
    const { analysis } = toPageAnalysis(
      raw(
        [step([0, 0, 0, 500]), step([-50, -10, 1200, 1100], { printed_number: 2 })],
        { spoilers: [{ box_2d: [10, 10, 10, 10], label: "x" }] },
      ),
    );
    expect(analysis.steps).toHaveLength(1);
    expect(analysis.steps[0]!.bbox).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(analysis.spoilers).toEqual([]);
  });

  it("keeps full-width boxes and survives float error", () => {
    const { analysis } = toPageAnalysis(raw([step([0, 0, 500, 1000]), step([300, 700, 1000, 1000])]));
    expect(analysis.steps[0]!.bbox.w).toBe(1);
    const b = analysis.steps[1]!.bbox;
    expect(b.x + b.w).toBeLessThanOrEqual(1);
    expect(b.y + b.h).toBeLessThanOrEqual(1);
    // 0.7 + 0.3 === 0.9999999999999999 style sums must not be rejected
    for (const v of [1, 3, 7, 9, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97]) {
      expect(() => toPageAnalysis(raw([step([0, v * 10, 1000, 1000])]))).not.toThrow();
    }
  });

  it("returns set number", () => {
    expect(toPageAnalysis(raw([], { kind: "cover", set_number: "75192" })).setNumber).toBe("75192");
  });

  it("rejects malformed AI output", () => {
    expect(() => toPageAnalysis(raw([], { kind: "banana" }))).toThrow();
  });
});

describe("toConstraints", () => {
  it("toConstraints ignores unknown step ids", () => {
    const out = toConstraints(
      {
        constraints: [
          { kind: "stepOnDay", step_id: "a", day: 3 },
          { kind: "stepOnDay", step_id: "zzz", day: 4 },
          { kind: "stepLast", step_id: "b" },
          { kind: "stepLast", step_id: "nope" },
        ],
      },
      new Set(["a", "b"]),
    );
    expect(out).toEqual([
      { kind: "stepOnDay", stepId: "a", day: 3 },
      { kind: "stepLast", stepId: "b" },
    ]);
  });
});

describe("fakeAi", () => {
  it("returns given pages and a synthetic default", async () => {
    const ai = fakeAi({ 2: raw([]) });
    expect(await ai.analyzePage(Buffer.alloc(0), 2)).toEqual(raw([]));
    const cover = toPageAnalysis(await ai.analyzePage(Buffer.alloc(0), 1));
    expect(cover.analysis.kind).toBe("cover");
    expect(cover.setNumber).toBe("00000");
    const p = toPageAnalysis(await ai.analyzePage(Buffer.alloc(0), 5));
    expect(p.analysis.steps).toHaveLength(2);
    expect(p.analysis.steps[0]!.parts).toHaveLength(3);
  });
});
