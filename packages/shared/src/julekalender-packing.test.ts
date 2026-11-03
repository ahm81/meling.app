import { describe, expect, it } from "vitest";
import { packingList, reconcile, type Part, type Step } from "./index";

const step = (id: string, parts: Part[]): Step => ({
  id,
  manualId: "m1",
  manualOrder: 1,
  page: 1,
  index: 0,
  printedNumber: 1,
  bbox: { x: 0, y: 0, w: 1, h: 1 },
  parts,
  brickCount: parts.reduce((n, p) => n + p.qty, 0),
});
const plate = { qty: 2, name: "Plate 2x4", color: "mørkeblå" };

describe("packingList", () => {
  it("merges equal parts", () => {
    const steps = [step("a", [plate]), step("b", [plate])];
    expect(packingList(steps, ["a", "b"])).toEqual([{ name: "Plate 2x4", color: "mørkeblå", qty: 4 }]);
  });

  it("only counts the given steps and sorts by colour, then name", () => {
    const steps = [
      step("a", [{ qty: 1, name: "Tile 1x2", color: "rød" }, plate]),
      step("b", [{ qty: 1, name: "Brick 1x1", color: "rød" }]),
      step("c", [{ qty: 9, name: "Brick 1x1", color: "blå" }]),
    ];
    expect(packingList(steps, ["b", "a"])).toEqual([
      { name: "Plate 2x4", color: "mørkeblå", qty: 2 },
      { name: "Brick 1x1", color: "rød", qty: 1 },
      { name: "Tile 1x2", color: "rød", qty: 1 },
    ]);
  });
});

describe("reconcile", () => {
  it("reconcile reports only differences", () => {
    const steps = [step("a", [plate, { qty: 1, name: "Brick 1x1", color: "rød" }]), step("b", [{ ...plate, qty: 3 }])];
    const inventory = [
      { qty: 6, name: "Plate 2x4", color: "mørkeblå" },
      { qty: 1, name: "Brick 1x1", color: "rød" },
    ];
    expect(reconcile(steps, inventory)).toEqual([
      { name: "Plate 2x4", color: "mørkeblå", expected: 6, distributed: 5 },
    ]);
  });

  it("reports parts missing on either side", () => {
    const steps = [step("a", [{ qty: 1, name: "Brick 1x1", color: "rød" }])];
    const inventory = [{ qty: 2, name: "Tile 1x2", color: "gul" }];
    expect(reconcile(steps, inventory)).toEqual([
      { name: "Tile 1x2", color: "gul", expected: 2, distributed: 0 },
      { name: "Brick 1x1", color: "rød", expected: 0, distributed: 1 },
    ]);
  });
});
