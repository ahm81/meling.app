// Manual check of the AI theme against real Vertex AI; not deployed.
// Needs `gcloud auth application-default login` and roles/aiplatform.user in meling-app.
//   pnpm --filter @meling/functions try-theme "<prompt>" [childName] [antall=4]
// Override the models or Vertex location without code changes:
//   GEMINI_IMAGE_MODEL=... GEMINI_MODEL=... GEMINI_LOCATION=... pnpm --filter @meling/functions try-theme "..."
// Pictures are written to .try-theme/ (gitignored). Each picture costs money: keep the count small.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { geminiConfig } from "../src/julekalender/gemini";
import { ImageRefusedError, imageModel, vertexThemeAi } from "../src/julekalender/theme/themeAi";
import { toDoorJpeg } from "../src/julekalender/theme/themeJob";

const [prompt, childName = "", count = "4"] = process.argv.slice(2);
if (!prompt) {
  console.error('Bruk: try-theme "<ønske>" [barnets navn] [antall bilder=4]');
  process.exit(1);
}
const n = Math.max(0, Math.min(24, Number(count) || 0));

const secs = (since: number) => ((performance.now() - since) / 1000).toFixed(1);
const out = join(process.cwd(), ".try-theme");
await mkdir(out, { recursive: true });

const ai = vertexThemeAi();
const { model, location } = geminiConfig();
console.log(`Planlegging ${model}, bilder ${imageModel()}, lokasjon ${location}`);

let t = performance.now();
const plan = await ai.planTheme(prompt, childName);
console.log(`\nPlan (${secs(t)} s):\n${JSON.stringify(plan, null, 2)}`);

const slug = prompt.toLowerCase().replace(/[^a-zæøå0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
t = performance.now();
const reference = await sharp(await ai.styleImage(plan.style)).png().toBuffer();
await writeFile(join(out, `${slug}-stil.png`), reference);
console.log(`\nStilbilde (${secs(t)} s)`);

for (let i = 0; i < n; i++) {
  const motif = plan.motifs[i]!;
  t = performance.now();
  try {
    const jpeg = await toDoorJpeg(await ai.doorImage(plan.style, motif, reference));
    const file = `${slug}-luke-${String(i + 1).padStart(2, "0")}.jpg`;
    await writeFile(join(out, file), jpeg);
    console.log(`Luke ${i + 1} «${motif}» (${secs(t)} s): ${file}`);
  } catch (e) {
    if (!(e instanceof ImageRefusedError)) throw e;
    console.log(`Luke ${i + 1} «${motif}» (${secs(t)} s): avvist: ${e.message}`);
  }
}
