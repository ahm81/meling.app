import { type ExtraBrick, type PageDoc, type Part, type Plan, type Step, stepId } from "./julekalender";

const key = (p: { name: string; color: string }) => `${p.color}\u0000${p.name}`;
const byColorThenName = (a: { name: string; color: string }, b: { name: string; color: string }) =>
  a.color.localeCompare(b.color, "nb") || a.name.localeCompare(b.name, "nb");

// Sums qty per (name, color).
function tally(parts: Iterable<Part>): Map<string, { name: string; color: string; qty: number }> {
  const out = new Map<string, { name: string; color: string; qty: number }>();
  for (const p of parts) {
    const line = out.get(key(p));
    if (line) line.qty += p.qty;
    else out.set(key(p), { name: p.name, color: p.color, qty: p.qty });
  }
  return out;
}

/** Parts needed for the given steps, merged on (name, color) and sorted by color, then name. Unknown ids are ignored. */
export function packingList(steps: Step[], stepIds: string[]): { name: string; color: string; qty: number }[] {
  const wanted = new Set(stepIds);
  const parts = steps.filter((s) => wanted.has(s.id)).flatMap((s) => s.parts);
  return [...tally(parts).values()].sort(byColorThenName);
}

/**
 * Compares the manual's inventory (expected) with the parts found in the steps (distributed).
 * Returns only lines where the counts differ, including parts missing on either side.
 */
export function reconcile(
  steps: Step[],
  inventory: Part[],
): { name: string; color: string; expected: number; distributed: number }[] {
  const expected = tally(inventory);
  const distributed = tally(steps.flatMap((s) => s.parts));
  const lines = new Map<string, { name: string; color: string; expected: number; distributed: number }>();
  for (const [k, p] of expected) lines.set(k, { name: p.name, color: p.color, expected: p.qty, distributed: 0 });
  for (const [k, p] of distributed) {
    const line = lines.get(k) ?? { name: p.name, color: p.color, expected: 0, distributed: 0 };
    line.distributed = p.qty;
    lines.set(k, line);
  }
  return [...lines.values()].filter((l) => l.expected !== l.distributed).sort(byColorThenName);
}

/** One brick in a step's parts box, with where it is so its picture can be found. */
export interface PlacedCallout {
  manualId: string;
  page: number;
  /** Position in the page's `bricks.callouts`. */
  index: number;
  /** The step it belongs to, or null when the page has no step for it. */
  stepId: string | null;
  elementId: string;
  qty: number;
  sure: boolean;
}

export interface BrickCatalog {
  /** Element ids in the order the parts list shows them (manual order, page, position), with the set's count. */
  inventory: { elementId: string; qty: number }[];
  callouts: PlacedCallout[];
}

/**
 * The bricks read from the PDFs of the given manuals, or null when no parts list was found (then the
 * packing list falls back to the parts the AI read). A brick listed on several pages is counted once per page.
 */
export function brickCatalog(pages: PageDoc[], manuals: { id: string; order: number }[]): BrickCatalog | null {
  const order = new Map(manuals.map((m) => [m.id, m.order]));
  const sorted = pages
    .filter((p) => order.has(p.manualId))
    .sort((a, b) => order.get(a.manualId)! - order.get(b.manualId)! || a.page - b.page || a.manualId.localeCompare(b.manualId));
  const inventory = new Map<string, number>();
  const callouts: PlacedCallout[] = [];
  for (const p of sorted) {
    for (const b of p.bricks?.inventory ?? []) inventory.set(b.elementId, (inventory.get(b.elementId) ?? 0) + b.qty);
    (p.bricks?.callouts ?? []).forEach((c, index) => {
      callouts.push({
        manualId: p.manualId,
        page: p.page,
        index,
        stepId: c.stepIndex === null ? null : stepId(p.manualId, p.page, c.stepIndex),
        elementId: c.elementId,
        qty: c.qty,
        sure: c.sure,
      });
    });
  }
  if (inventory.size === 0) return null;
  return { inventory: [...inventory].map(([elementId, qty]) => ({ elementId, qty })), callouts };
}

export interface BrickBag {
  /**
   * Bricks summed per element id, in the parts list's order: those matched with confidence in the steps'
   * parts boxes plus those placed by hand (`extra` of the `qty`).
   */
  lines: { elementId: string; qty: number; extra: number }[];
  /** Bricks whose match is uncertain, one entry per parts box entry, so an adult can check each. */
  unsure: PlacedCallout[];
}

/** The bricks needed for the given steps, plus the bricks placed by hand in that bag. */
export function brickBag(catalog: BrickCatalog, stepIds: string[], extras: ExtraBrick[] = []): BrickBag {
  const wanted = new Set(stepIds);
  const lines = new Map<string, { elementId: string; qty: number; extra: number }>();
  const add = (elementId: string, qty: number, extra: number) => {
    const line = lines.get(elementId) ?? { elementId, qty: 0, extra: 0 };
    lines.set(elementId, { elementId, qty: line.qty + qty, extra: line.extra + extra });
  };
  const unsure: PlacedCallout[] = [];
  for (const c of catalog.callouts) {
    if (c.stepId === null || !wanted.has(c.stepId)) continue;
    if (c.sure) add(c.elementId, c.qty, 0);
    else unsure.push(c);
  }
  for (const e of extras) add(e.elementId, e.qty, e.qty);
  const position = new Map(catalog.inventory.map((b, i) => [b.elementId, i]));
  const last = catalog.inventory.length;
  return {
    lines: [...lines.values()].sort((a, b) => (position.get(a.elementId) ?? last) - (position.get(b.elementId) ?? last)),
    unsure,
  };
}

/** The bag of every day in the plan. */
export function brickBags(catalog: BrickCatalog, plan: Plan): BrickBag[] {
  return plan.days.map((d, i) => brickBag(catalog, d.stepIds, plan.extraBricks.filter((e) => e.day === i + 1)));
}

/**
 * Compares the parts list with the bricks in the plan's bags. Returns the element ids whose counts differ,
 * in the parts list's order: `expected` from the parts list, `distributed` in the bags (uncertain matches
 * count as their best guess, and bricks placed by hand count too).
 */
export function brickReconcile(
  catalog: BrickCatalog,
  plan: Plan,
): { elementId: string; expected: number; distributed: number }[] {
  const wanted = new Set(plan.days.flatMap((d) => d.stepIds));
  const distributed = new Map<string, number>();
  for (const c of catalog.callouts) {
    if (c.stepId !== null && wanted.has(c.stepId)) distributed.set(c.elementId, (distributed.get(c.elementId) ?? 0) + c.qty);
  }
  for (const e of plan.extraBricks) distributed.set(e.elementId, (distributed.get(e.elementId) ?? 0) + e.qty);
  return catalog.inventory
    .map((b) => ({ elementId: b.elementId, expected: b.qty, distributed: distributed.get(b.elementId) ?? 0 }))
    .filter((l) => l.expected !== l.distributed);
}
