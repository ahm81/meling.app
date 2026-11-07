import type { PageAnalysis } from "@meling/shared";
import { describe, expect, it } from "vitest";
import { aiHidden } from "./pipeline";

const spoiler = { bbox: { x: 0, y: 0, w: 0.5, h: 0.5 }, label: "Ferdig modell" };
const page = (kind: PageAnalysis["kind"], n: number) => ({
  manualId: "m1",
  page: n,
  analysis: { kind, steps: [], spoilers: [spoiler, spoiler], inventory: [] } satisfies PageAnalysis,
});

describe("aiHidden", () => {
  it("hides spoilers on instruction pages and whole non-instruction pages without their spoilers", () => {
    const hidden = aiHidden([page("cover", 1), page("instructions", 2), page("inventory", 3), page("other", 4)]);
    expect(hidden.map((h) => [h.page, h.bbox === null])).toEqual([
      [1, true],
      [2, false],
      [2, false],
      [3, true],
      [4, true],
    ]);
    expect(new Set(hidden.map((h) => h.id)).size).toBe(hidden.length);
    expect(hidden.every((h) => h.source === "ai")).toBe(true);
  });
});
