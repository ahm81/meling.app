// Manual check of the page analysis against real Vertex AI; not deployed.
// Needs `gcloud auth application-default login` and roles/aiplatform.user in meling-app.
//   pnpm --filter @meling/functions try-analysis [path/to/manual.pdf] [firstPage] [lastPage]
// The PDFs are LEGO's content: keep them out of the repo.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { toPageAnalysis } from "../src/julekalender/analysis";
import { vertexAi } from "../src/julekalender/gemini";
import { renderPdf } from "../src/julekalender/pdf";

const [pdfPath = join(homedir(), "Downloads", "6242006.pdf"), first = "4", last = "8"] = process.argv.slice(2);
const from = Number(first);
const to = Number(last);

const ai = vertexAi();
const pdf = await readFile(pdfPath);
const pct = (v: number) => `${Math.round(v * 100)}%`;

for await (const { page, png, width, height } of renderPdf(pdf)) {
  if (page < from) continue;
  if (page > to) break;
  const { analysis, setNumber } = toPageAnalysis(await ai.analyzePage(png, page));
  console.log(`\nSide ${page} (${width}×${height}): ${analysis.kind}${setNumber ? `, sett ${setNumber}` : ""}`);
  for (const s of analysis.steps) {
    const { x, y, w, h } = s.bbox;
    console.log(`  trinn ${s.printedNumber}: boks x=${pct(x)} y=${pct(y)} w=${pct(w)} h=${pct(h)}`);
    for (const p of s.parts) console.log(`    ${p.qty}× ${p.name} (${p.color})`);
  }
  for (const s of analysis.spoilers) console.log(`  spoiler: ${s.label}`);
  if (analysis.inventory.length) console.log(`  brikkeoversikt: ${analysis.inventory.length} brikketyper`);
}
