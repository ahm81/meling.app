import { createHash } from "node:crypto";
import type { Bbox, Hidden, Step } from "@meling/shared";

const FULL: Bbox = { x: 0, y: 0, w: 1, h: 1 };

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
      masks.push({ ...FULL });
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
  const canon = JSON.stringify(masks.map((m) => [r(m.x), r(m.y), r(m.w), r(m.h)]));
  return createHash("sha256").update(canon).digest("hex").slice(0, 12);
}
