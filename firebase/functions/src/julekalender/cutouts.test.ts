import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { Hidden, Step } from "@meling/shared";
import { MASK_COLOR, maskFor, maskKey, renderCutout } from "./cutouts";

const step: Step = {
  id: "m1:1:0",
  manualId: "m1",
  manualOrder: 1,
  page: 1,
  index: 0,
  printedNumber: 1,
  bbox: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
  parts: [],
  brickCount: 1,
};
const hid = (over: Partial<Hidden>): Hidden => ({
  id: "h",
  manualId: "m1",
  page: 1,
  bbox: null,
  label: "x",
  source: "ai",
  ...over,
});

describe("maskFor", () => {
  it("converts a page box into step-relative coordinates", () => {
    const h = hid({ bbox: { x: 0.5, y: 0, w: 0.25, h: 0.25 } });
    expect(maskFor(step, [h])).toEqual([{ x: 0, y: 0, w: 0.5, h: 0.5 }]);
  });

  it("clips to the step box", () => {
    const h = hid({ bbox: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } });
    expect(maskFor(step, [h])).toEqual([{ x: 0, y: 0.5, w: 0.5, h: 0.5 }]);
  });

  it("covers the whole step when the whole page is hidden", () => {
    expect(maskFor(step, [hid({})])).toEqual([{ x: 0, y: 0, w: 1, h: 1 }]);
  });

  it("ignores other pages, other manuals and non-overlapping or touching boxes", () => {
    const far = { x: 0, y: 0.6, w: 0.2, h: 0.2 };
    const touching = { x: 0.25, y: 0, w: 0.25, h: 0.25 };
    expect(
      maskFor(step, [hid({ page: 2 }), hid({ manualId: "m2" }), hid({ bbox: far }), hid({ bbox: touching })]),
    ).toEqual([]);
  });
});

describe("maskKey", () => {
  it("is none for no masks", () => {
    expect(maskKey([])).toBe("none");
  });

  it("is stable, 12 hex chars, and rounds to 3 decimals", () => {
    const a = maskKey([{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }]);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(maskKey([{ x: 0.1004, y: 0.2, w: 0.3, h: 0.4 }])).toBe(a);
    expect(maskKey([{ x: 0.2, y: 0.2, w: 0.3, h: 0.4 }])).not.toBe(a);
  });

  it("is independent of mask order", () => {
    const a = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    const b = { x: 0.5, y: 0.1, w: 0.2, h: 0.2 };
    expect(maskKey([a, b])).toBe(maskKey([b, a]));
  });
});

const whitePng = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).png().toBuffer();

/** RGB of the pixel at (x, y). */
async function pixel(img: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}

const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) <= 6);

describe("renderCutout", () => {
  it("crops to the step box and paints the masks grey, as WebP", async () => {
    const page = await whitePng(200, 100);
    const out = await renderCutout(page, { x: 0.5, y: 0, w: 0.5, h: 1 }, [{ x: 0, y: 0, w: 0.5, h: 0.5 }]);
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 100, height: 100 });
    expect(MASK_COLOR).toBe("#C2C8CC");
    expect(near(await pixel(out, 10, 10), [0xc2, 0xc8, 0xcc])).toBe(true);
    expect(near(await pixel(out, 90, 90), [255, 255, 255])).toBe(true);
    expect(near(await pixel(out, 60, 10), [255, 255, 255])).toBe(true);
  });

  it("clamps to the image and is at least one pixel", async () => {
    const page = await whitePng(50, 40);
    const out = await renderCutout(page, { x: 1, y: 1, w: 0, h: 0 }, [{ x: 0, y: 0, w: 1, h: 1 }]);
    expect(await sharp(out).metadata()).toMatchObject({ width: 1, height: 1 });
  });
});
