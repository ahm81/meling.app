// Manual check of the brick reading against real manuals; not deployed. No network or credentials needed.
//   pnpm --filter @meling/functions try-bricks <manual1.pdf> [manual2.pdf …]   (booklets of one set, in order)
// Prints the parts list, the bricks found in the parts boxes and how they compare.
// The PDFs are LEGO's content: keep them out of the repo.
import { readFile } from "node:fs/promises";
import { readBricks } from "../src/julekalender/bricks";

const files = process.argv.slice(2);
if (files.length === 0) throw new Error("Oppgi minst én PDF.");
const read = await readBricks(await Promise.all(files.map(async (f, i) => ({ manualId: `m${i + 1}`, pdf: await readFile(f) }))));

const expected = new Map<string, number>();
const found = new Map<string, number>();
let callouts = 0;
const unsure: string[] = [];
for (const p of read.pages.values()) {
  for (const b of p.inventory) expected.set(b.elementId, (expected.get(b.elementId) ?? 0) + b.qty);
  for (const c of p.callouts) {
    callouts++;
    found.set(c.elementId, (found.get(c.elementId) ?? 0) + c.qty);
    if (!c.sure) unsure.push(`${p.manualId} side ${p.page}: ${c.qty}× ligner ${c.elementId}`);
  }
}
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
console.log(`Delelisten: ${expected.size} brikketyper, ${sum(expected)} brikker`);
console.log(`Brikkebokser: ${callouts} linjer, ${sum(found)} brikker, ${unsure.length} usikre`);
for (const u of unsure) console.log(`  usikker: ${u}`);
const diff = [...expected].filter(([id, n]) => (found.get(id) ?? 0) !== n);
console.log(`Avvik mot delelisten: ${diff.length} brikketyper`);
for (const [id, n] of diff) console.log(`  ${id}: delelisten ${n}, brikkebokser ${found.get(id) ?? 0}`);
