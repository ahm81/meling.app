import { createHash } from "node:crypto";
import type { Bbox, Hidden, Step } from "@meling/shared";
import sharp from "sharp";

/** The whole page as a box. */
export const FULL_PAGE: Bbox = { x: 0, y: 0, w: 1, h: 1 };

/**
 * The hidden regions (or whole pages) that overlap the step's box, clipped to it and expressed
 * relative to the step's box (0–1 within the step). Boxes that only touch are not overlaps.
 */
export function maskFor(step: Step, hidden: Hidden[]): Bbox[] {
  const s = step.bbox;
  const masks: Bbox[] = [];
  for (const h of hidden) {
    if (h.manualId !== step.manualId || h.page !== step.page) continue;
    if (h.bbox === null) {
      masks.push({ ...FULL_PAGE });
      continue;
    }
    const x0 = Math.max(s.x, h.bbox.x);
    const y0 = Math.max(s.y, h.bbox.y);
    const x1 = Math.min(s.x + s.w, h.bbox.x + h.bbox.w);
    const y1 = Math.min(s.y + s.h, h.bbox.y + h.bbox.h);
    if (x1 <= x0 || y1 <= y0) continue;
    masks.push({ x: (x0 - s.x) / s.w, y: (y0 - s.y) / s.h, w: (x1 - x0) / s.w, h: (y1 - y0) / s.h });
  }
  return masks;
}

/** "none" for no masks, else 12 hex chars of sha256 over the masks rounded to 3 decimals. */
export function maskKey(masks: Bbox[]): string {
  if (masks.length === 0) return "none";
  const r = (n: number) => Math.round(n * 1000) / 1000;
  // Sorted so the same set of masks gives the same key in any order.
  const tuples = masks.map((m) => [r(m.x), r(m.y), r(m.w), r(m.h)]).sort((a, b) => a.join(",").localeCompare(b.join(",")));
  const canon = JSON.stringify(tuples);
  return createHash("sha256").update(canon).digest("hex").slice(0, 12);
}

/** The grey painted over hidden regions in cutouts. */
export const MASK_COLOR = "#C2C8CC";

/** Normalised [start, start+size) on an axis of `total` pixels, clamped to the image and at least 1 px. */
function toPixels(start: number, size: number, total: number): { offset: number; length: number } {
  const offset = Math.min(Math.max(Math.round(start * total), 0), total - 1);
  const end = Math.min(Math.max(Math.round((start + size) * total), offset + 1), total);
  return { offset, length: end - offset };
}

/**
 * Crops a page image to the step's box (normalised page coordinates) and paints the masks
 * (normalised relative to the step's box, as from maskFor) in MASK_COLOR. Returns WebP.
 */
export async function renderCutout(pageImage: Buffer, bbox: Bbox, masks: Bbox[]): Promise<Buffer> {
  const { width, height } = await sharp(pageImage).metadata();
  if (!width || !height) throw new Error("Sidebildet mangler størrelse.");
  const x = toPixels(bbox.x, bbox.w, width);
  const y = toPixels(bbox.y, bbox.h, height);
  const crop = await sharp(pageImage)
    .extract({ left: x.offset, top: y.offset, width: x.length, height: y.length })
    .removeAlpha()
    .png()
    .toBuffer();
  const overlays = masks.map((m) => {
    const mx = toPixels(m.x, m.w, x.length);
    const my = toPixels(m.y, m.h, y.length);
    return {
      input: { create: { width: mx.length, height: my.length, channels: 3 as const, background: MASK_COLOR } },
      left: mx.offset,
      top: my.offset,
    };
  });
  return sharp(crop).composite(overlays).webp({ quality: 85 }).toBuffer();
}
