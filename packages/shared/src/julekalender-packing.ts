import type { Part, Step } from "./julekalender";

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
