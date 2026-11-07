import { describe, expect, it } from "vitest";
import type { Step } from "@meling/shared";
import { TooFewBrickStepsError, TooFewStepsError, distribute, type Constraint } from "./distribute";

// Step n (1-based) gets its own page unless `page` says otherwise.
const makeSteps = (bricks: number[], page: (n: number) => number = (n) => n): Step[] =>
  bricks.map((b, i) => ({
    id: `s${i + 1}`,
    manualId: "m1",
    manualOrder: 1,
    page: page(i + 1),
    index: 0,
    printedNumber: i + 1,
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    parts: b > 0 ? [{ qty: b, name: "Brick", color: "rød" }] : [],
    brickCount: b,
  }));
const run = (steps: Step[], constraints: Constraint[] = [], balance: "bricks" | "steps" = "bricks") =>
  distribute(steps, { balance, constraints });
const dayOf = (days: { stepIds: string[] }[], id: string) => days.findIndex((d) => d.stepIds.includes(id)) + 1;

describe("distribute", () => {
  it("balances bricks over 24 contiguous days", () => {
    const steps = makeSteps(Array(48).fill(3));
    const days = run(steps);
    expect(days).toHaveLength(24);
    expect(days.every((d) => d.stepIds.length === 2)).toBe(true);
    expect(days.flatMap((d) => d.stepIds)).toEqual(steps.map((s) => s.id));
  });

  it("handles exactly 24 steps, one per day", () => {
    const steps = makeSteps(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(run(steps).map((d) => d.stepIds)).toEqual(steps.map((s) => [s.id]));
  });

  it("keeps zero-brick steps with a neighbour", () => {
    const steps = makeSteps(Array.from({ length: 30 }, (_, i) => (i + 1 === 10 ? 0 : 3)));
    const days = run(steps);
    const bricks = new Map(steps.map((s) => [s.id, s.brickCount]));
    expect(days.every((d) => d.stepIds.reduce((n, id) => n + bricks.get(id)!, 0) > 0)).toBe(true);
    expect(days.flatMap((d) => d.stepIds)).toEqual(steps.map((s) => s.id));
  });

  it("never makes a zero-weight day", () => {
    // 25 steps, 24 with bricks: the empty step must share a day; it can never stand alone.
    const steps = makeSteps(Array.from({ length: 25 }, (_, i) => (i + 1 === 7 ? 0 : 1)));
    const days = run(steps);
    expect(days.find((d) => d.stepIds.includes("s7"))!.stepIds.length).toBe(2);
  });

  it("throws TooFewBrickStepsError when fewer than 24 steps have bricks", () => {
    // Exactly 24 steps with one empty step: a bricks split would leave a day with no bricks.
    const steps = makeSteps(Array.from({ length: 24 }, (_, i) => (i + 1 === 7 ? 0 : 1)));
    expect(() => run(steps)).toThrow(TooFewBrickStepsError);
    expect(() => run(steps)).toThrow("Bare 23 byggetrinn har brikker. Det trengs minst 24.");
    expect(run(steps, [], "steps")).toHaveLength(24);
  });

  it("avoids splitting a page when the cost is equal", () => {
    // 26 steps: 25+26 pair up, and step 5 pairs with 4 or 6 at exactly the same cost
    // (one 2-brick day and one 1-brick day either way). Only the page penalty breaks the tie.
    const bricks = Array.from({ length: 26 }, (_, i) => ([4, 5, 6, 25, 26].includes(i + 1) ? 1 : 2));
    const sharedWith5 = (other: number) => run(makeSteps(bricks, (n) => (n === other ? 5 : n)));
    const days = sharedWith5(6);
    expect(dayOf(days, "s5")).toBe(dayOf(days, "s6"));
    expect(dayOf(days, "s4")).not.toBe(dayOf(days, "s5"));
    // Mirror case, so the test cannot pass on tie-breaking order alone.
    const mirrored = sharedWith5(4);
    expect(dayOf(mirrored, "s4")).toBe(dayOf(mirrored, "s5"));
  });

  it("honours stepOnDay", () => {
    const steps = makeSteps(Array(48).fill(3));
    expect(dayOf(run(steps, [{ kind: "stepOnDay", stepId: "s1", day: 1 }]), "s1")).toBe(1);
    const days = run(steps, [{ kind: "stepOnDay", stepId: "s40", day: 24 }]);
    expect(days[23]!.stepIds).toEqual(steps.slice(39).map((s) => s.id));
  });

  it("honours stepLast by ending a day after the step", () => {
    const steps = makeSteps(Array(48).fill(3));
    const days = run(steps, [{ kind: "stepLast", stepId: "s5" }]);
    expect(days[dayOf(days, "s5") - 1]!.stepIds.at(-1)).toBe("s5");
  });

  it("balances step counts when asked", () => {
    const steps = makeSteps([...Array(24).fill(1), ...Array(24).fill(10)]);
    expect(run(steps, [], "steps").every((d) => d.stepIds.length === 2)).toBe(true);
  });

  it("throws when constraints conflict", () => {
    const steps = makeSteps(Array(48).fill(3));
    const constraints: Constraint[] = [
      { kind: "stepOnDay", stepId: "s10", day: 20 },
      { kind: "stepOnDay", stepId: "s20", day: 10 },
    ];
    expect(() => run(steps, constraints)).toThrow("Ønskene kan ikke oppfylles samtidig.");
  });

  it("throws on an unknown step id in a constraint", () => {
    const steps = makeSteps(Array(48).fill(3));
    expect(() => run(steps, [{ kind: "stepLast", stepId: "nope" }])).toThrow("Ukjent trinn i ønskene: nope");
  });

  it("rejects stepOnDay outside 1–24", () => {
    const steps = makeSteps(Array(48).fill(3));
    for (const day of [0, 25, 1.5]) {
      expect(() => run(steps, [{ kind: "stepOnDay", stepId: "s1", day }])).toThrow("Ønskene kan ikke oppfylles samtidig.");
    }
  });

  it("throws TooFewStepsError below 24 steps", () => {
    const err = (() => {
      try {
        run(makeSteps(Array(23).fill(1)));
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(TooFewStepsError);
    expect((err as Error).message).toBe("Manualene har bare 23 byggetrinn. Det trengs minst 24.");
  });
});
