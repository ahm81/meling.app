import { describe, expect, it } from "vitest";
import { DOOR_COUNT, type Hidden, type Plan, type Step } from "@meling/shared";
import { InvalidOpError, applyOps } from "./ops";

const step = (id: string): Step => ({
  id,
  manualId: "m1",
  manualOrder: 1,
  page: 1,
  index: 0,
  printedNumber: 1,
  bbox: { x: 0, y: 0, w: 1, h: 1 },
  parts: [],
  brickCount: 1,
});

// Day 5 = [a,b,c], day 6 = [d]; every other day holds one filler step.
const makePlan = (): { plan: Plan; steps: Step[] } => {
  const days = Array.from({ length: DOOR_COUNT }, (_, i) => ({ stepIds: [`f${i + 1}`] }));
  days[4] = { stepIds: ["a", "b", "c"] };
  days[5] = { stepIds: ["d"] };
  const ids = days.flatMap((d) => d.stepIds);
  return { plan: { days, hidden: [] }, steps: ids.map(step) };
};

const hidden: Hidden = { id: "h1", manualId: "m1", page: 2, bbox: null, label: "Forside", source: "adult" };

describe("applyOps", () => {
  it("moves the last step of a day to the next day", () => {
    const { plan, steps } = makePlan();
    const out = applyOps(plan, steps, [{ type: "moveStep", stepId: "c", toDay: 6 }]);
    expect(out.days[4]!.stepIds).toEqual(["a", "b"]);
    expect(out.days[5]!.stepIds).toEqual(["c", "d"]);
  });

  it("moves the first step of a day to the previous day", () => {
    const { plan, steps } = makePlan();
    const out = applyOps(plan, steps, [{ type: "moveStep", stepId: "a", toDay: 4 }]);
    expect(out.days[3]!.stepIds).toEqual(["f4", "a"]);
    expect(out.days[4]!.stepIds).toEqual(["b", "c"]);
  });

  it("does not mutate the input", () => {
    const { plan, steps } = makePlan();
    const copy = structuredClone(plan);
    applyOps(plan, steps, [{ type: "moveStep", stepId: "c", toDay: 6 }, { type: "hide", hidden }]);
    expect(plan).toEqual(copy);
  });

  it("rejects moving a middle step", () => {
    const { plan, steps } = makePlan();
    expect(() => applyOps(plan, steps, [{ type: "moveStep", stepId: "b", toDay: 6 }])).toThrow(InvalidOpError);
    expect(() => applyOps(plan, steps, [{ type: "moveStep", stepId: "b", toDay: 6 }])).toThrow(
      "bare første eller siste trinn",
    );
  });

  it("rejects emptying a day", () => {
    const { plan, steps } = makePlan();
    expect(() => applyOps(plan, steps, [{ type: "moveStep", stepId: "d", toDay: 5 }])).toThrow(InvalidOpError);
  });

  it("rejects moving to a non-adjacent day", () => {
    const { plan, steps } = makePlan();
    expect(() => applyOps(plan, steps, [{ type: "moveStep", stepId: "c", toDay: 8 }])).toThrow(InvalidOpError);
    expect(() => applyOps(plan, steps, [{ type: "moveStep", stepId: "c", toDay: 5 }])).toThrow(InvalidOpError);
  });

  it("rejects moving the first step to the next day", () => {
    const { plan, steps } = makePlan();
    expect(() => applyOps(plan, steps, [{ type: "moveStep", stepId: "a", toDay: 6 }])).toThrow(InvalidOpError);
  });

  it("rejects an unknown step", () => {
    const { plan, steps } = makePlan();
    expect(() => applyOps(plan, steps, [{ type: "moveStep", stepId: "zz", toDay: 6 }])).toThrow(InvalidOpError);
  });

  it("hide then show round-trips", () => {
    const { plan, steps } = makePlan();
    const hiddenPlan = applyOps(plan, steps, [{ type: "hide", hidden }]);
    expect(hiddenPlan.hidden).toEqual([hidden]);
    expect(applyOps(hiddenPlan, steps, [{ type: "show", hiddenId: "h1" }])).toEqual(plan);
  });

  it("rejects hiding an existing id and showing an unknown id", () => {
    const { plan, steps } = makePlan();
    const withHidden = applyOps(plan, steps, [{ type: "hide", hidden }]);
    expect(() => applyOps(withHidden, steps, [{ type: "hide", hidden }])).toThrow(InvalidOpError);
    expect(() => applyOps(plan, steps, [{ type: "show", hiddenId: "nope" }])).toThrow(InvalidOpError);
  });
});
