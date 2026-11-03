import { describe, expect, it } from "vitest";
import { Bbox, Plan, calendarId, paths, stepId } from "./index";

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
