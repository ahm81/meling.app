import { type Bbox, PageAnalysis, PageKind, Part } from "@meling/shared";
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

// Lenient shape for parsing the answer: only kind and the steps list must be right; bad entries are dropped.
const LooseList = z.array(z.unknown()).catch([]);
const LoosePageAnalysis = z.object({
  kind: PageKind,
  steps: z.array(z.object({ printed_number: z.unknown(), box_2d: z.unknown(), parts: LooseList.default([]) }).catch({ printed_number: null, box_2d: null, parts: [] })),
  spoilers: LooseList.default([]),
  inventory: LooseList.default([]),
  set_number: z.string().nullable().catch(null).default(null),
});

const PrintedNumber = z.int().min(1);
const LooseSpoiler = z.object({ box_2d: z.unknown(), label: z.string() });

/** Keeps the parts that are valid after trimming the name: integer qty ≥ 1, non-empty name. */
function validParts(list: unknown[]): Part[] {
  const out: Part[] = [];
  for (const p of list) {
    if (typeof p !== "object" || p === null) continue;
    const { name, ...rest } = p as { name?: unknown };
    const r = Part.safeParse({ ...rest, name: typeof name === "string" ? name.trim() : name });
    if (r.success) out.push(r.data);
  }
  return out;
}

/** box_2d as a Bbox, or null if it is malformed or has zero area. */
function looseBbox(box: unknown): Bbox | null {
  const r = Box2d.safeParse(box);
  return r.success && r.data.every(Number.isFinite) ? toBbox(r.data) : null;
}

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

/** Parses one page's AI answer. Invalid steps, boxes and parts are dropped instead of failing the page. */
export function toPageAnalysis(raw: unknown): { analysis: PageAnalysis; setNumber: string | null } {
  const r = LoosePageAnalysis.parse(raw);
  const steps: PageAnalysis["steps"] = [];
  for (const s of r.steps) {
    const n = PrintedNumber.safeParse(s.printed_number);
    const bbox = looseBbox(s.box_2d);
    // A step whose parts were all invalid keeps an empty list (distribute handles zero-brick steps).
    if (n.success && bbox) steps.push({ printedNumber: n.data, bbox, parts: validParts(s.parts) });
  }
  const spoilers: PageAnalysis["spoilers"] = [];
  for (const raw of r.spoilers) {
    const sp = LooseSpoiler.safeParse(raw);
    const bbox = sp.success ? looseBbox(sp.data.box_2d) : null;
    if (sp.success && bbox) spoilers.push({ bbox, label: sp.data.label });
  }
  const analysis = PageAnalysis.parse({ kind: r.kind, steps, spoilers, inventory: validParts(r.inventory) });
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
