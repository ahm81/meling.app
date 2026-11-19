import { describe, expect, it } from "vitest";
import { Bbox, DOOR_COUNT, Plan, type Step, calendarId, paths, stepId, wholePageSteps } from "./index";

describe("julekalender", () => {
  it("Plan requires exactly 24 days", () => {
    const days = (n: number) => Array.from({ length: n }, () => ({ stepIds: [] }));
    expect(() => Plan.parse({ days: days(23), hidden: [] })).toThrow();
    expect(Plan.parse({ days: days(24), hidden: [] }).days).toHaveLength(24);
  });

  it("Bbox rejects boxes outside the page", () => {
    expect(() => Bbox.parse({ x: 0.9, y: 0, w: 0.2, h: 0.1 })).toThrow();
    expect(Bbox.parse({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })).toBeTruthy();
  });

  it("paths.version pads the number so versions sort", () => {
    expect(paths.version("c", 7)).toBe("julekalender/c/versions/000007");
  });

  it("stepId and calendarId formats", () => {
    expect(stepId("m1", 3, 0)).toBe("m1:3:0");
    expect(calendarId(2026, "u1")).toBe("2026-u1");
  });
});

describe("wholePageSteps", () => {
  const step = (id: string, page: number): Step => ({
    id,
    manualId: "m1",
    manualOrder: 1,
    page,
    index: 0,
    printedNumber: 1,
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    parts: [],
    brickCount: 1,
  });
  // Page 4: a, b on day 1. Page 5: c on day 1, d on day 2 (split).
  const steps = [step("a", 4), step("b", 4), step("c", 5), step("d", 5)];
  const days = Array.from({ length: DOOR_COUNT }, () => ({ stepIds: [] as string[] }));
  days[0] = { stepIds: ["a", "b", "c"] };
  days[1] = { stepIds: ["d"] };

  it("keeps pages whose steps are on one day and drops split or empty pages", () => {
    const plan: Plan = {
      days,
      hidden: [],
      wholePages: [
        { manualId: "m1", page: 4 },
        { manualId: "m1", page: 5 },
        { manualId: "m1", page: 9 },
      ],
    };
    expect(wholePageSteps(plan, steps)).toEqual([{ manualId: "m1", page: 4, day: 1, stepIds: ["a", "b"] }]);
  });

  it("defaults wholePages to [] for versions written before it existed", () => {
    expect(Plan.parse({ days, hidden: [] }).wholePages).toEqual([]);
  });
});
