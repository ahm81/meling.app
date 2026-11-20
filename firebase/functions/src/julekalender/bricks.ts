import {
  type Bbox,
  type BrickCallout,
  type InventoryBrick,
  type PageBricks,
  PageDoc,
  paths,
  stepIndexAt,
  storagePaths,
} from "@meling/shared";
import sharp, { type Sharp } from "sharp";
import { type PdfText, type PtBox, pdfLayout } from "./pdf";
import { type PipelineDeps, forEachLimited, manualsOf, pagesOf } from "./pipeline";

// LEGO manuals store every brick in a parts box, and in the parts list at the back, as its own picture
// with the count ("2x") as real text right below it; the parts list also has the element id below the count.
// So the bricks are read from the PDF itself, and a parts box brick is matched to the parts list by how it looks.

const QTY = /^(\d{1,3})x$/i;
const ELEMENT_ID = /^\d{6,7}$/;
/** A page with at least this many element ids is a parts list. */
const MIN_INVENTORY = 5;
/** Counts in parts boxes are small print; bigger "2x" marks a sub-build to make several times. */
const MAX_LABEL_FONT = 14;
/** Pictures smaller than this (points) are decorations, not bricks. */
const MIN_PICTURE = 5;

const area = (b: PtBox) => (b.x1 - b.x0) * (b.y1 - b.y0);

/** The picture a count label belongs to: the one that ends right above the label and starts at its left edge. */
function pictureAbove(label: PtBox, images: PtBox[]): PtBox | null {
  let best: { box: PtBox; off: number } | null = null;
  for (const i of images) {
    if (Math.min(i.x1 - i.x0, i.y1 - i.y0) < MIN_PICTURE) continue;
    if (i.y1 <= label.y0 - 10 || i.y1 >= label.y0 + 5 || i.x0 >= label.x1 + 4 || i.x1 <= label.x0 - 4) continue;
    const off = Math.abs(i.x0 - label.x0) + Math.abs(i.y1 - label.y0);
    if (!best || off < best.off || (off === best.off && area(i) < area(best.box))) best = { box: i, off };
  }
  return best?.box ?? null;
}

export type FoundBrick = { qty: number; box: PtBox };
export type PageLayout = {
  inventory: (FoundBrick & { elementId: string })[];
  callouts: FoundBrick[];
  /** Big "2x" marks: something on or before this page is built that many times. */
  multipliers: number[];
};

/**
 * The bricks on one page: a parts list (count and element id under each picture) if the page has at least
 * MIN_INVENTORY of them, else the bricks of the parts boxes (count under each picture).
 */
export function pageLayout(texts: PdfText[], images: PtBox[]): PageLayout {
  const labels: (FoundBrick & { label: PtBox })[] = [];
  const multipliers: number[] = [];
  for (const t of texts) {
    const m = QTY.exec(t.text.trim());
    if (!m || Number(m[1]) < 1) continue;
    if (t.fontSize > MAX_LABEL_FONT) {
      if (Number(m[1]) > 1) multipliers.push(Number(m[1]));
      continue;
    }
    const box = pictureAbove(t.box, images);
    if (box) labels.push({ qty: Number(m[1]), box, label: t.box });
  }
  const inventory: PageLayout["inventory"] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    const elementId = t.text.trim();
    if (!ELEMENT_ID.test(elementId) || seen.has(elementId)) continue;
    const above = labels.find((l) => Math.abs(l.label.y1 - t.box.y0) < 5 && Math.abs(l.label.x0 - t.box.x0) < 5);
    if (!above) continue;
    seen.add(elementId);
    inventory.push({ elementId, qty: above.qty, box: above.box });
  }
  if (inventory.length >= MIN_INVENTORY) {
    // Column by column, top to bottom: the order the parts list is read in (similar colours end up together).
    inventory.sort((a, b) => (Math.abs(a.box.x0 - b.box.x0) > 10 ? a.box.x0 - b.box.x0 : a.box.y0 - b.box.y0));
    return { inventory, callouts: [], multipliers: [] };
  }
  // Reading order: a parts box entirely left of another comes first, otherwise the higher one.
  const callouts = labels
    .map(({ qty, box }) => ({ qty, box }))
    .sort((a, b) => (a.box.x1 <= b.box.x0 ? -1 : b.box.x1 <= a.box.x0 ? 1 : a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0));
  return { inventory: [], callouts, multipliers };
}

const FEATURE_SIDE = 24;
/** How a brick's picture looks: its size on the page (points) and a small copy with the background whitened. */
export type Feature = { w: number; h: number; pixels: Buffer };

/** Crops a box (points) out of a page rendered at `scale` pixels per point. */
export function cropBox(pagePng: Buffer, box: PtBox, scale: number, size: { width: number; height: number }) {
  const left = Math.min(Math.max(Math.round(box.x0 * scale), 0), size.width - 1);
  const top = Math.min(Math.max(Math.round(box.y0 * scale), 0), size.height - 1);
  const width = Math.min(Math.max(Math.round((box.x1 - box.x0) * scale), 1), size.width - left);
  const height = Math.min(Math.max(Math.round((box.y1 - box.y0) * scale), 1), size.height - top);
  return sharp(pagePng).extract({ left, top, width, height }).removeAlpha();
}

/**
 * The feature of a cropped brick picture. Parts boxes and the parts list have different background colours,
 * so pixels close to a corner's colour are painted white first.
 */
export async function featureOf(crop: Sharp, box: PtBox): Promise<Feature> {
  const { data, info } = await crop.clone().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => (y * info.width + x) * info.channels;
  const corners = [at(0, 0), at(info.width - 1, 0), at(0, info.height - 1), at(info.width - 1, info.height - 1)];
  for (let i = 0; i < data.length; i += info.channels) {
    for (const c of corners) {
      if (Math.abs(data[i]! - data[c]!) + Math.abs(data[i + 1]! - data[c + 1]!) + Math.abs(data[i + 2]! - data[c + 2]!) < 24) {
        data[i] = data[i + 1] = data[i + 2] = 255;
        break;
      }
    }
  }
  const pixels = await sharp(data, { raw: info }).resize(FEATURE_SIDE, FEATURE_SIDE, { fit: "fill" }).raw().toBuffer();
  return { w: box.x1 - box.x0, h: box.y1 - box.y0, pixels };
}

/** A match is sure when it is this close and the runner-up is at least SURE_MARGIN further away. */
const SURE_DISTANCE = 45;
const SURE_MARGIN = 12;

/** Colour difference (RMS over the small copies) plus penalties for another shape and another size. */
function distance(a: Feature, b: Feature, sizeRatio: number | null): number {
  let sum = 0;
  for (let i = 0; i < a.pixels.length; i++) sum += (a.pixels[i]! - b.pixels[i]!) ** 2;
  const shape = Math.abs(Math.log(a.w / a.h / (b.w / b.h)));
  const size = sizeRatio === null ? 0 : Math.abs(Math.log((a.w * a.h) / (b.w * b.h * sizeRatio)));
  return Math.sqrt(sum / a.pixels.length) + 60 * shape + 40 * size;
}

/**
 * For each parts box brick, the parts list brick that looks most like it. Parts boxes are drawn at another
 * scale than the parts list (the same throughout a set), so a first pass without size finds that scale and
 * the second pass uses it. Returns null for every brick when the parts list is empty.
 */
export function matchBricks(callouts: Feature[], inventory: { elementId: string; feature: Feature }[]): ({ elementId: string; sure: boolean } | null)[] {
  if (inventory.length === 0) return callouts.map(() => null);
  const nearest = (c: Feature, sizeRatio: number | null) =>
    inventory.map((b) => ({ b, d: distance(c, b.feature, sizeRatio) })).sort((x, y) => x.d - y.d);
  const ratios = callouts
    .map((c) => {
      const b = nearest(c, null)[0]!.b.feature;
      return (c.w * c.h) / (b.w * b.h);
    })
    .sort((x, y) => x - y);
  const sizeRatio = ratios.length ? ratios[Math.floor(ratios.length / 2)]! : null;
  return callouts.map((c) => {
    const [first, second] = nearest(c, sizeRatio);
    const sure = first!.d < SURE_DISTANCE && (second === undefined || second.d - first!.d > SURE_MARGIN);
    return { elementId: first!.b.elementId, sure };
  });
}

/** How far back (in parts box bricks) a section built several times may start. */
const MAX_SECTION = 60;

/**
 * A big "2x" at the end of a section means the whole section is built twice, but the parts boxes only show
 * the bricks for one. The manual does not say where the section starts, so the parts list decides: the
 * section is the run of bricks ending on the mark's page that, multiplied, brings the totals closest to the
 * parts list without giving any brick more than the parts list has. Nothing is multiplied when no run does.
 * `callouts` are in building order and are changed in place; `marks` give the index of the last brick on the
 * mark's page.
 */
export function applyMultipliers(
  callouts: { elementId: string; qty: number }[],
  marks: { end: number; factor: number }[],
  expected: Map<string, number>,
): void {
  const totals = new Map<string, number>();
  for (const c of callouts) totals.set(c.elementId, (totals.get(c.elementId) ?? 0) + c.qty);
  for (const { end, factor } of marks) {
    let best: { start: number; gain: number } | null = null;
    const added = new Map<string, number>();
    let gain = 0;
    for (let start = end; start >= 0 && end - start < MAX_SECTION; start--) {
      const { elementId, qty } = callouts[start]!;
      const extra = qty * (factor - 1);
      const now = (totals.get(elementId) ?? 0) + (added.get(elementId) ?? 0);
      // A longer section would give this brick more than the set has: the section starts after it.
      if (now + extra > (expected.get(elementId) ?? 0)) break;
      added.set(elementId, (added.get(elementId) ?? 0) + extra);
      gain += extra;
      if (!best || gain > best.gain) best = { start, gain };
    }
    if (!best) continue;
    for (let i = best.start; i <= end; i++) {
      const c = callouts[i]!;
      totals.set(c.elementId, (totals.get(c.elementId) ?? 0) + c.qty * (factor - 1));
      c.qty *= factor;
    }
  }
}

const RENDER_SCALE = 4;
const toBbox = (b: PtBox, width: number, height: number): Bbox => {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x = clamp(b.x0 / width);
  const y = clamp(b.y0 / height);
  return { x, y, w: Math.min(clamp(b.x1 / width) - x, 1 - x), h: Math.min(clamp(b.y1 / height) - y, 1 - y) };
};

export interface ReadBricks {
  /** `${manualId}_${page}` → the page's bricks (without stepIndex, which needs the page analysis). */
  pages: Map<string, { manualId: string; page: number; inventory: InventoryBrick[]; callouts: Omit<BrickCallout, "stepIndex">[] }>;
  /** elementId → WebP picture from the parts list. */
  images: Map<string, Buffer>;
  /** WebP pictures of the parts box bricks whose match is uncertain. */
  calloutImages: { manualId: string; page: number; index: number; webp: Buffer }[];
}

/**
 * Reads the bricks of a set from its manuals (in booklet order): the parts list, the parts boxes, and which
 * parts list brick each parts box brick is. Every page of every manual gets an entry.
 */
export async function readBricks(manuals: { manualId: string; pdf: Buffer }[]): Promise<ReadBricks> {
  const out: ReadBricks = { pages: new Map(), images: new Map(), calloutImages: [] };
  const inventory: { elementId: string; feature: Feature }[] = [];
  const callouts: { key: string; index: number; feature: Feature; webp: Buffer }[] = [];
  const marks: { end: number; factor: number }[] = [];
  const webp = (crop: Sharp) => crop.clone().webp({ quality: 90 }).toBuffer();

  for (const { manualId, pdf } of manuals) {
    for await (const { page, width, height, texts, images, render } of pdfLayout(pdf)) {
      const key = `${manualId}_${page}`;
      const layout = pageLayout(texts, images);
      const entry = { manualId, page, inventory: [] as InventoryBrick[], callouts: [] as Omit<BrickCallout, "stepIndex">[] };
      out.pages.set(key, entry);
      if (layout.inventory.length === 0 && layout.callouts.length === 0) continue;
      const png = render(RENDER_SCALE);
      const size = { width: Math.round(width * RENDER_SCALE), height: Math.round(height * RENDER_SCALE) };
      const meta = await sharp(png).metadata();
      if (meta.width && meta.height) Object.assign(size, { width: meta.width, height: meta.height });
      for (const b of layout.inventory) {
        entry.inventory.push({ elementId: b.elementId, qty: b.qty, bbox: toBbox(b.box, width, height) });
        // The first page that lists an element gives its picture.
        if (out.images.has(b.elementId)) continue;
        const crop = cropBox(png, b.box, RENDER_SCALE, size);
        inventory.push({ elementId: b.elementId, feature: await featureOf(crop, b.box) });
        out.images.set(b.elementId, await webp(crop));
      }
      for (const [index, c] of layout.callouts.entries()) {
        const crop = cropBox(png, c.box, RENDER_SCALE, size);
        callouts.push({ key, index, feature: await featureOf(crop, c.box), webp: await webp(crop) });
        // elementId and sure are filled in below, once the whole parts list is known.
        entry.callouts.push({ qty: c.qty, bbox: toBbox(c.box, width, height), elementId: "", sure: false });
      }
      if (callouts.length > 0) for (const factor of layout.multipliers) marks.push({ end: callouts.length - 1, factor });
    }
  }

  const matches = matchBricks(callouts.map((c) => c.feature), inventory);
  callouts.forEach((c, i) => {
    const entry = out.pages.get(c.key)!;
    const match = matches[i];
    if (!match) return;
    Object.assign(entry.callouts[c.index]!, match);
    if (!match.sure) out.calloutImages.push({ manualId: entry.manualId, page: entry.page, index: c.index, webp: c.webp });
  });
  if (inventory.length > 0) {
    const expected = new Map<string, number>();
    for (const p of out.pages.values()) for (const b of p.inventory) expected.set(b.elementId, (expected.get(b.elementId) ?? 0) + b.qty);
    applyMultipliers(callouts.map((c) => out.pages.get(c.key)!.callouts[c.index]!), marks, expected);
  }
  // Without a parts list nothing can be matched: the packing list then uses the parts the AI read.
  if (inventory.length === 0) for (const entry of out.pages.values()) entry.callouts = [];
  return out;
}

const MAX_CONCURRENT_UPLOADS = 8;

export class BricksNotReadyError extends Error {
  constructor() {
    super("Alle manualene må være ferdig lest før brikkene kan hentes.");
    this.name = "BricksNotReadyError";
  }
}

/**
 * Reads the bricks from the calendar's manuals and stores them: `bricks` on every page document and the
 * pictures in Storage. Plans and the AI's analysis are not touched. Safe to run again (it replaces the result).
 */
export async function updateBricks({ db, bucket }: Pick<PipelineDeps, "db" | "bucket">, calId: string): Promise<{ elements: number; unsure: number }> {
  const [manuals, pageSnaps] = await Promise.all([manualsOf(db, calId).get(), pagesOf(db, calId).get()]);
  if (manuals.empty || !manuals.docs.every((m) => m.get("status") === "done")) throw new BricksNotReadyError();
  const ordered = [...manuals.docs].sort((a, b) => (a.get("order") as number) - (b.get("order") as number) || a.id.localeCompare(b.id));
  const pdfs = await Promise.all(
    ordered.map(async (m) => ({ manualId: m.id, pdf: (await bucket.file(storagePaths.manualPdf(calId, m.id)).download())[0] })),
  );
  const read = await readBricks(pdfs);

  await bucket.deleteFiles({ prefix: storagePaths.bricksDir(calId) });
  const files = [
    ...[...read.images].map(([elementId, data]) => ({ path: storagePaths.brickImage(calId, elementId), data })),
    ...read.calloutImages.map((c) => ({ path: storagePaths.calloutImage(calId, c.manualId, c.page, c.index), data: c.webp })),
  ];
  await forEachLimited(files, MAX_CONCURRENT_UPLOADS, ({ path, data }) =>
    bucket.file(path).save(data, { contentType: "image/webp", resumable: false }),
  );

  // Written after the pictures, so a page that has bricks also has their pictures.
  const writer = db.bulkWriter();
  for (const snap of pageSnaps.docs) {
    const doc = PageDoc.safeParse(snap.data());
    if (!doc.success) continue;
    const found = read.pages.get(`${doc.data.manualId}_${doc.data.page}`);
    const analysis = doc.data.analysis;
    const bricks: PageBricks = {
      inventory: found?.inventory ?? [],
      callouts: (found?.callouts ?? []).map((c) => ({ ...c, stepIndex: analysis ? stepIndexAt(analysis, c.bbox) : null })),
    };
    void writer.update(db.doc(paths.page(calId, doc.data.manualId, doc.data.page)), { bricks });
  }
  await writer.close();
  return { elements: read.images.size, unsure: read.calloutImages.length };
}
