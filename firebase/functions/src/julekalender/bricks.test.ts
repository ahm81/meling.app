import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { type Feature, applyMultipliers, matchBricks, pageLayout, readBricks } from "./bricks";
import type { PdfText, PtBox } from "./pdf";
import { minimalPdf, sampleBrickPdf } from "./testing/minimal-pdf";

const box = (x0: number, y0: number, w: number, h: number): PtBox => ({ x0, y0, x1: x0 + w, y1: y0 + h });
const text = (t: string, x0: number, y0: number, fontSize = 7): PdfText => ({ text: t, box: box(x0, y0, 10, fontSize), fontSize });

/** A parts list entry at (x, y): picture, count below it, element id below the count. */
const listed = (id: string, qty: number, x: number, y: number) => ({
  image: box(x, y, 20, 15),
  texts: [text(`${qty}x`, x, y + 15), text(id, x, y + 22)],
});

describe("pageLayout", () => {
  it("reads a parts list column by column", () => {
    const entries = [listed("300001", 1, 100, 10), listed("300002", 2, 10, 60), listed("300003", 3, 10, 10), listed("300004", 4, 100, 60), listed("300005", 5, 200, 10)];
    const layout = pageLayout(entries.flatMap((e) => e.texts), entries.map((e) => e.image));
    expect(layout.inventory.map((b) => [b.elementId, b.qty])).toEqual([["300003", 3], ["300002", 2], ["300001", 1], ["300004", 4], ["300005", 5]]);
    expect(layout.callouts).toEqual([]);
  });

  it("reads parts boxes on a page without a parts list, in reading order", () => {
    const images = [box(300, 20, 20, 15), box(50, 20, 20, 15), box(90, 22, 30, 13), box(200, 150, 120, 90)];
    const texts = [text("1x", 300, 35), text("2x", 50, 35), text("3x", 90, 35), text("12", 20, 60, 40)];
    const layout = pageLayout(texts, images);
    expect(layout.callouts.map((c) => [c.qty, c.box.x0])).toEqual([[2, 50], [3, 90], [1, 300]]);
    expect(layout.inventory).toEqual([]);
  });

  it("takes the picture right above the count, not a bigger one behind it or a tiny decoration", () => {
    const layout = pageLayout([text("1x", 50, 35)], [box(0, 0, 400, 36), box(50, 20, 20, 15), box(50, 32, 3, 3)]);
    expect(layout.callouts).toEqual([{ qty: 1, box: box(50, 20, 20, 15) }]);
  });

  it("treats a big count as a multiplier, not a brick", () => {
    const layout = pageLayout([text("2x", 50, 35, 49), text("1x", 150, 35)], [box(50, 0, 60, 35), box(150, 20, 20, 15)]);
    expect(layout.callouts).toEqual([{ qty: 1, box: box(150, 20, 20, 15) }]);
    expect(layout.multipliers).toEqual([2]);
  });

  it("ignores a count without a picture and ids without a count", () => {
    const layout = pageLayout([text("2x", 50, 35), text("6135297", 50, 80)], []);
    expect(layout).toEqual({ inventory: [], callouts: [], multipliers: [] });
  });
});

const feature = (grey: number, w: number, h: number): Feature => ({ w, h, pixels: Buffer.alloc(24 * 24 * 3, grey) });

describe("matchBricks", () => {
  const inventory = [
    { elementId: "dark", feature: feature(40, 20, 15) },
    { elementId: "light", feature: feature(200, 20, 15) },
    { elementId: "tall", feature: feature(200, 10, 30) },
  ];

  it("matches on colour and shape, at the parts boxes' own scale", () => {
    // Parts boxes are drawn 1.3 times larger than the parts list.
    const matches = matchBricks([feature(45, 26, 19.5), feature(195, 26, 19.5), feature(200, 13, 39)], inventory);
    expect(matches).toEqual([
      { elementId: "dark", sure: true },
      { elementId: "light", sure: true },
      { elementId: "tall", sure: true },
    ]);
  });

  it("marks a weak or ambiguous match as unsure", () => {
    const twins = [...inventory, { elementId: "light2", feature: feature(202, 20, 15) }];
    expect(matchBricks([feature(201, 20, 15)], twins)[0]!.sure).toBe(false);
    expect(matchBricks([feature(120, 20, 15)], inventory)[0]!.sure).toBe(false);
  });

  it("matches nothing without a parts list", () => {
    expect(matchBricks([feature(1, 2, 3)], [])).toEqual([null]);
  });
});

describe("applyMultipliers", () => {
  const expected = new Map([["a", 3], ["b", 4], ["c", 2]]);

  it("multiplies the run before the mark that fits the parts list", () => {
    const callouts = [{ elementId: "a", qty: 3 }, { elementId: "b", qty: 2 }, { elementId: "c", qty: 1 }];
    applyMultipliers(callouts, [{ end: 2, factor: 2 }], expected);
    // "a" already has all three, so the section starts after it.
    expect(callouts.map((c) => c.qty)).toEqual([3, 4, 2]);
  });

  it("changes nothing when the counts already match (the parts box included the multiplier)", () => {
    const callouts = [{ elementId: "a", qty: 3 }, { elementId: "b", qty: 4 }];
    applyMultipliers(callouts, [{ end: 1, factor: 2 }], expected);
    expect(callouts.map((c) => c.qty)).toEqual([3, 4]);
  });

  it("does not let a later mark multiply what an earlier one already did", () => {
    const callouts = [{ elementId: "b", qty: 2 }, { elementId: "c", qty: 1 }, { elementId: "c", qty: 1 }];
    applyMultipliers(callouts, [{ end: 0, factor: 2 }, { end: 2, factor: 2 }], expected);
    expect(callouts.map((c) => c.qty)).toEqual([4, 1, 1]);
  });
});

describe("readBricks", () => {
  it("reads the parts list, matches the parts boxes and multiplies the marked section", async () => {
    const read = await readBricks([{ manualId: "m1", pdf: sampleBrickPdf() }]);
    const list = read.pages.get("m1_2")!;
    expect(list.inventory.map((b) => [b.elementId, b.qty])).toEqual([
      ["300021", 4],
      ["300023", 2],
      ["300028", 1],
      ["300024", 1],
      ["300026", 1],
    ]);
    expect(list.callouts).toEqual([]);
    // The big "2x" doubles the parts box: 2 red and 1 blue become the 4 and 2 the set has.
    expect(read.pages.get("m1_1")!.callouts.map(({ elementId, qty, sure }) => [elementId, qty, sure])).toEqual([
      ["300021", 4, true],
      ["300023", 2, true],
    ]);
    expect(read.pages.get("m1_1")!.callouts[0]!.bbox.x).toBeCloseTo(0.1, 2);
    expect(read.calloutImages).toEqual([]);

    expect([...read.images.keys()].sort()).toEqual(["300021", "300023", "300024", "300026", "300028"]);
    const { data, info } = await sharp(read.images.get("300021")!).raw().toBuffer({ resolveWithObject: true });
    expect(info.format).toBe("raw");
    const mid = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    expect(data[mid]!).toBeGreaterThan(170);
    expect(data[mid + 2]!).toBeLessThan(70);
  });

  it("finds nothing in a manual without a parts list", async () => {
    const read = await readBricks([{ manualId: "m1", pdf: minimalPdf(2) }]);
    expect([...read.pages.values()]).toEqual([
      { manualId: "m1", page: 1, inventory: [], callouts: [] },
      { manualId: "m1", page: 2, inventory: [], callouts: [] },
    ]);
    expect(read.images.size).toBe(0);
  });
});
