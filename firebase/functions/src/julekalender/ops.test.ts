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
  return { plan: { days, hidden: [], wholePages: [] }, steps: ids.map(step) };
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

  it("rejects moves outside days 1–24", () => {
    const { plan, steps } = makePlan();
    plan.days[0] = { stepIds: ["x1", "f1"] };
    plan.days[23] = { stepIds: ["f24", "x24"] };
    const all = [...steps, step("x1"), step("x24")];
    expect(() => applyOps(plan, all, [{ type: "moveStep", stepId: "x1", toDay: 0 }])).toThrow(InvalidOpError);
    expect(() => applyOps(plan, all, [{ type: "moveStep", stepId: "x24", toDay: 25 }])).toThrow(InvalidOpError);
  });

  it("throws on a batch with an invalid op after a valid one, leaving the input unchanged", () => {
    const { plan, steps } = makePlan();
    const copy = structuredClone(plan);
    expect(() =>
      applyOps(plan, steps, [
        { type: "moveStep", stepId: "c", toDay: 6 },
        { type: "moveStep", stepId: "a", toDay: 6 },
      ]),
    ).toThrow(InvalidOpError);
    expect(plan).toEqual(copy);
  });

  it("rejects a step in the plan that is missing from steps", () => {
    const { plan, steps } = makePlan();
    expect(() =>
      applyOps(plan, steps.filter((s) => s.id !== "c"), [{ type: "moveStep", stepId: "c", toDay: 6 }]),
    ).toThrow(InvalidOpError);
  });

  it("stores a copy of the hidden region", () => {
    const { plan, steps } = makePlan();
    const h = structuredClone(hidden);
    const out = applyOps(plan, steps, [{ type: "hide", hidden: h }]);
    h.label = "endret";
    expect(out.hidden[0]!.label).toBe("Forside");
  });

  describe("wholePage", () => {
    // a, b, c (day 5) are on page 3; c and d (days 5 and 6) on page 4 would split it, so d is put there too.
    const onPages = (steps: Step[]) =>
      steps.map((s) => (["a", "b"].includes(s.id) ? { ...s, page: 3 } : ["c", "d"].includes(s.id) ? { ...s, page: 4 } : s));

    it("turns a page into one image when all its steps are on one day, and back", () => {
      const { plan, steps } = makePlan();
      const on = applyOps(plan, onPages(steps), [{ type: "wholePage", manualId: "m1", page: 3, whole: true }]);
      expect(on.wholePages).toEqual([{ manualId: "m1", page: 3 }]);
      expect(on.days).toEqual(plan.days);
      const off = applyOps(on, onPages(steps), [{ type: "wholePage", manualId: "m1", page: 3, whole: false }]);
      expect(off.wholePages).toEqual([]);
    });

    it("rejects a page whose steps are on several days", () => {
      const { plan, steps } = makePlan();
      expect(() => applyOps(plan, onPages(steps), [{ type: "wholePage", manualId: "m1", page: 4, whole: true }])).toThrow(
        "fordelt på flere dager",
      );
    });

    it("rejects a page without steps, turning it on twice, and turning off a page that is not on", () => {
      const { plan, steps } = makePlan();
      const s = onPages(steps);
      const op = (page: number, whole: boolean) => ({ type: "wholePage" as const, manualId: "m1", page, whole });
      expect(() => applyOps(plan, s, [op(9, true)])).toThrow("har ingen trinn");
      expect(() => applyOps(plan, s, [op(3, true), op(3, true)])).toThrow("allerede");
      expect(() => applyOps(plan, s, [op(3, false)])).toThrow(InvalidOpError);
    });

    it("keeps the pages of the input plan and does not mutate it", () => {
      const { plan, steps } = makePlan();
      const withPage: Plan = { ...plan, wholePages: [{ manualId: "m1", page: 3 }] };
      const copy = structuredClone(withPage);
      const out = applyOps(withPage, onPages(steps), [{ type: "moveStep", stepId: "c", toDay: 6 }]);
      expect(out.wholePages).toEqual([{ manualId: "m1", page: 3 }]);
      expect(withPage).toEqual(copy);
    });
  });
});
