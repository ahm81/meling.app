import { type Bbox, PageAnalysis, PageKind } from "@meling/shared";
import { z } from "zod";
import type { Constraint } from "./distribute";

const Box2d = z.tuple([z.number(), z.number(), z.number(), z.number()]); // [ymin, xmin, ymax, xmax], 0–1000
const RawPart = z.object({ qty: z.int().min(1), name: z.string(), color: z.string() });

export const RawPageAnalysis = z.object({
  kind: PageKind,
  steps: z.array(z.object({ printed_number: z.int().min(1), box_2d: Box2d, parts: z.array(RawPart).default([]) })),
  spoilers: z.array(z.object({ box_2d: Box2d, label: z.string() })).default([]),
  inventory: z.array(RawPart).default([]),
  set_number: z.string().nullable().default(null),
});
export type RawPageAnalysis = z.infer<typeof RawPageAnalysis>;

export const RawConstraints = z.object({
  constraints: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("stepOnDay"), step_id: z.string(), day: z.int().min(1).max(24) }),
      z.object({ kind: z.literal("stepLast"), step_id: z.string() }),
    ]),
  ),
});

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Converts [ymin,xmin,ymax,xmax] in 0–1000 to a Bbox inside the page; null if the area is zero. */
function toBbox([ymin, xmin, ymax, xmax]: [number, number, number, number]): Bbox | null {
  const x = clamp01(Math.min(xmin, xmax) / 1000);
  const y = clamp01(Math.min(ymin, ymax) / 1000);
  const x2 = clamp01(Math.max(xmin, xmax) / 1000);
  const y2 = clamp01(Math.max(ymin, ymax) / 1000);
  // Clamp after division so float error never pushes x + w past 1.
  const w = Math.min(x2 - x, 1 - x);
  const h = Math.min(y2 - y, 1 - y);
  if (!(w > 0) || !(h > 0)) return null;
  return { x, y, w, h };
}

export function toPageAnalysis(raw: unknown): { analysis: PageAnalysis; setNumber: string | null } {
  const r = RawPageAnalysis.parse(raw);
  const steps: PageAnalysis["steps"] = [];
  for (const s of r.steps) {
    const bbox = toBbox(s.box_2d);
    if (bbox) steps.push({ printedNumber: s.printed_number, bbox, parts: s.parts });
  }
  const spoilers: PageAnalysis["spoilers"] = [];
  for (const s of r.spoilers) {
    const bbox = toBbox(s.box_2d);
    if (bbox) spoilers.push({ bbox, label: s.label });
  }
  const analysis = PageAnalysis.parse({ kind: r.kind, steps, spoilers, inventory: r.inventory });
  return { analysis, setNumber: r.set_number };
}

/** Validates the AI's reading of the wishes; constraints on unknown step ids are dropped. */
export function toConstraints(raw: unknown, knownStepIds: Set<string>): Constraint[] {
  const out: Constraint[] = [];
  for (const c of RawConstraints.parse(raw).constraints) {
    if (!knownStepIds.has(c.step_id)) continue;
    out.push(c.kind === "stepOnDay" ? { kind: "stepOnDay", stepId: c.step_id, day: c.day } : { kind: "stepLast", stepId: c.step_id });
  }
  return out;
}
