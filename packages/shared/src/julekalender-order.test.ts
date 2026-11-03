import { describe, expect, it } from "vitest";
import { orderSteps, type PageAnalysis } from "./index";

const box = (x: number, y = 0.1) => ({ x, y, w: 0.4, h: 0.3 });
const page = (steps: PageAnalysis["steps"]): PageAnalysis => ({
  kind: "instructions",
  steps,
  spoilers: [],
  inventory: [],
});
const plate = { qty: 2, name: "Plate 2x4", color: "mørkeblå" };

describe("orderSteps", () => {
  it("orders by manual, page, then left-to-right columns", () => {
    const steps = orderSteps([
      { manualId: "m2", manualOrder: 2, page: 1, analysis: page([{ printedNumber: 1, bbox: box(0.05), parts: [] }]) },
      {
        manualId: "m1",
        manualOrder: 1,
        page: 5,
        // Right column listed first and lower on the page, to prove the column wins over y.
        analysis: page([
          { printedNumber: 2, bbox: box(0.55, 0.05), parts: [] },
          { printedNumber: 44, bbox: box(0.05, 0.5), parts: [] },
        ]),
      },
    ]);
    expect(steps.map((s) => s.id)).toEqual(["m1:5:0", "m1:5:1", "m2:1:0"]);
    expect(steps.map((s) => s.printedNumber)).toEqual([44, 2, 1]);
    expect(steps[1]).toMatchObject({ manualId: "m1", manualOrder: 1, page: 5, index: 1 });
  });

  it("orders top before bottom when boxes overlap horizontally", () => {
    const steps = orderSteps([
      {
        manualId: "m1",
        manualOrder: 1,
        page: 3,
        analysis: page([
          { printedNumber: 8, bbox: box(0.1, 0.6), parts: [] },
          { printedNumber: 7, bbox: box(0.2, 0.1), parts: [] },
        ]),
      },
    ]);
    expect(steps.map((s) => s.printedNumber)).toEqual([7, 8]);
  });

  it("counts bricks and allows steps without parts", () => {
    const steps = orderSteps([
      {
        manualId: "m1",
        manualOrder: 1,
        page: 2,
        analysis: page([
          { printedNumber: 1, bbox: box(0.05), parts: [plate, { qty: 3, name: "Brick 1x1", color: "rød" }] },
          { printedNumber: 2, bbox: box(0.55), parts: [] },
        ]),
      },
    ]);
    expect(steps.map((s) => s.brickCount)).toEqual([5, 0]);
  });
});
