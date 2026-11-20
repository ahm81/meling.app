import { describe, expect, it } from "vitest";
import { DOOR_COUNT, brickBag, brickBags, brickCatalog, brickReconcile, packingList, reconcile, stepIndexAt, type PageAnalysis, type PageDoc, type Part, type Plan, type Step } from "./index";

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

describe("bricks", () => {
  const box = { x: 0.1, y: 0.1, w: 0.1, h: 0.1 };
  const page = (manualId: string, n: number, bricks: PageDoc["bricks"]): PageDoc => ({
    manualId,
    page: n,
    imagePath: "p.png",
    width: 10,
    height: 10,
    analysis: null,
    bricks,
  });
  const callout = (elementId: string, qty: number, stepIndex: number | null, sure = true) => ({ qty, bbox: box, stepIndex, elementId, sure });
  const manuals = [{ id: "m1", order: 1 }, { id: "m2", order: 2 }];
  const pages = [
    page("m2", 9, { inventory: [{ elementId: "300", qty: 4, bbox: box }, { elementId: "100", qty: 1, bbox: box }, { elementId: "200", qty: 2, bbox: box }], callouts: [] }),
    page("m2", 1, { inventory: [], callouts: [callout("100", 1, 0), callout("300", 1, 0, false)] }),
    page("m1", 1, { inventory: [], callouts: [callout("300", 2, 0), callout("300", 1, 1), callout("200", 2, null)] }),
    page("gone", 1, { inventory: [{ elementId: "999", qty: 1, bbox: box }], callouts: [] }),
    page("m1", 2, undefined),
  ];

  it("has no catalog without a parts list", () => {
    expect(brickCatalog([pages[1]!, pages[4]!], manuals)).toBeNull();
  });

  it("collects the parts list and the parts boxes of the known manuals", () => {
    const catalog = brickCatalog(pages, manuals)!;
    expect(catalog.inventory).toEqual([{ elementId: "300", qty: 4 }, { elementId: "100", qty: 1 }, { elementId: "200", qty: 2 }]);
    expect(catalog.callouts.map((c) => c.stepId)).toEqual(["m1:1:0", "m1:1:1", null, "m2:1:0", "m2:1:0"]);
  });

  const planOf = (stepIds: string[], extraBricks: Plan["extraBricks"] = []): Plan => ({
    days: Array.from({ length: DOOR_COUNT }, (_, i) => ({ stepIds: i === 0 ? stepIds : [] })),
    hidden: [],
    wholePages: [],
    extraBricks,
    brickFixes: [],
  });

  it("sums a bag per element in the parts list's order and keeps unsure bricks apart", () => {
    const bag = brickBag(brickCatalog(pages, manuals)!, ["m2:1:0", "m1:1:0", "m1:1:1"]);
    expect(bag.lines).toEqual([{ elementId: "300", qty: 3, extra: 0 }, { elementId: "100", qty: 1, extra: 0 }]);
    expect(bag.unsure.map((c) => [c.elementId, c.qty, c.page, c.index])).toEqual([["300", 1, 1, 1]]);
    expect(bag.sure.map((c) => [c.elementId, c.manualId, c.page, c.index])).toEqual([
      ["300", "m1", 1, 0],
      ["300", "m1", 1, 1],
      ["100", "m2", 1, 0],
    ]);
  });

  it("lets an adult's answer replace an uncertain match", () => {
    const catalog = brickCatalog(pages, manuals, [{ manualId: "m2", page: 1, index: 1, elementId: "200" }])!;
    const bag = brickBag(catalog, ["m2:1:0"]);
    expect(bag.lines).toEqual([{ elementId: "100", qty: 1, extra: 0 }, { elementId: "200", qty: 1, extra: 0 }]);
    expect(bag.unsure).toEqual([]);
    expect(bag.fixed.map((c) => [c.elementId, c.page, c.index, c.sure])).toEqual([["200", 1, 1, true]]);
  });

  it("adds the bricks placed by hand to their day's bag", () => {
    const catalog = brickCatalog(pages, manuals)!;
    const plan = planOf(["m1:1:0"], [{ elementId: "200", day: 1, qty: 2 }, { elementId: "300", day: 1, qty: 1 }, { elementId: "100", day: 2, qty: 1 }]);
    const bags = brickBags(catalog, plan);
    expect(bags[0]!.lines).toEqual([{ elementId: "300", qty: 3, extra: 1 }, { elementId: "200", qty: 2, extra: 2 }]);
    expect(bags[1]!.lines).toEqual([{ elementId: "100", qty: 1, extra: 1 }]);
    expect(bags[2]!.lines).toEqual([]);
  });

  it("reconciles the bags with the parts list", () => {
    const catalog = brickCatalog(pages, manuals)!;
    expect(brickReconcile(catalog, planOf(["m1:1:0", "m1:1:1", "m2:1:0"]))).toEqual([{ elementId: "200", expected: 2, distributed: 0 }]);
    expect(brickReconcile(catalog, planOf(["m1:1:0", "m1:1:1", "m2:1:0"], [{ elementId: "200", day: 5, qty: 2 }]))).toEqual([]);
    expect(brickReconcile(catalog, planOf(["m1:1:0"]))).toEqual([
      { elementId: "300", expected: 4, distributed: 2 },
      { elementId: "100", expected: 1, distributed: 0 },
      { elementId: "200", expected: 2, distributed: 0 },
    ]);
  });
});

describe("stepIndexAt", () => {
  const analysis = (boxes: [number, number, number, number][]): PageAnalysis => ({
    kind: "instructions",
    steps: boxes.map(([x, y, w, h], i) => ({ printedNumber: i + 1, bbox: { x, y, w, h }, parts: [] })),
    spoilers: [],
    inventory: [],
  });
  const at = (x: number, y: number) => ({ x: x - 0.01, y: y - 0.01, w: 0.02, h: 0.02 });

  it("finds the step in reading order that contains the box", () => {
    // Given right column first; reading order puts the left column at index 0.
    const a = analysis([[0.5, 0, 0.5, 1], [0, 0, 0.5, 1]]);
    expect(stepIndexAt(a, at(0.2, 0.1))).toBe(0);
    expect(stepIndexAt(a, at(0.7, 0.1))).toBe(1);
  });

  it("prefers the smallest containing step and falls back to the nearest", () => {
    const a = analysis([[0, 0, 0.6, 0.6], [0.1, 0.1, 0.2, 0.2]]);
    expect(stepIndexAt(a, at(0.2, 0.2))).toBe(1);
    expect(stepIndexAt(a, at(0.9, 0.9))).toBe(0);
  });

  it("is null on a page without steps", () => {
    expect(stepIndexAt(analysis([]), at(0.5, 0.5))).toBeNull();
  });
});
