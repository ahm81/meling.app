import { z } from "zod";

export const DOOR_COUNT = 24;

const unit = z.number().min(0).max(1);

// Normalised bounding box on a page image; all values in [0,1] and inside the page.
export const Bbox = z
  .object({ x: unit, y: unit, w: unit, h: unit })
  .refine((b) => b.x + b.w <= 1 && b.y + b.h <= 1, { message: "bbox outside page" });
export type Bbox = z.infer<typeof Bbox>;

export const Part = z.object({
  qty: z.int().min(1),
  name: z.string().min(1),
  color: z.string(),
});
export type Part = z.infer<typeof Part>;

export const PageKind = z.enum(["cover", "instructions", "inventory", "other"]);
export type PageKind = z.infer<typeof PageKind>;

export const PageAnalysis = z.object({
  kind: PageKind,
  steps: z.array(z.object({ printedNumber: z.int().min(1), bbox: Bbox, parts: z.array(Part) })),
  spoilers: z.array(z.object({ bbox: Bbox, label: z.string() })),
  inventory: z.array(Part),
});
export type PageAnalysis = z.infer<typeof PageAnalysis>;

export const Step = z.object({
  id: z.string(),
  manualId: z.string(),
  manualOrder: z.int(),
  page: z.int().min(1),
  index: z.int().min(0),
  printedNumber: z.int(),
  bbox: Bbox,
  parts: z.array(Part),
  brickCount: z.int().min(0),
});
export type Step = z.infer<typeof Step>;

// bbox null means the whole page.
export const Hidden = z.object({
  id: z.string(),
  manualId: z.string(),
  page: z.int(),
  bbox: Bbox.nullable(),
  label: z.string(),
  source: z.enum(["ai", "adult"]),
});
export type Hidden = z.infer<typeof Hidden>;

export const Plan = z.object({
  days: z.array(z.object({ stepIds: z.array(z.string()) })).length(DOOR_COUNT),
  hidden: z.array(Hidden),
});
export type Plan = z.infer<typeof Plan>;

export const PlanOp = z.discriminatedUnion("type", [
  z.object({ type: z.literal("moveStep"), stepId: z.string(), toDay: z.int().min(1).max(DOOR_COUNT) }),
  z.object({ type: z.literal("hide"), hidden: Hidden }),
  z.object({ type: z.literal("show"), hiddenId: z.string() }),
]);
export type PlanOp = z.infer<typeof PlanOp>;

export const VersionAuthor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("adult"), uid: z.string() }),
  z.object({ kind: z.literal("ai"), requestedBy: z.string().nullable() }),
]);
export type VersionAuthor = z.infer<typeof VersionAuthor>;

// createdAt is a Date here; functions write Firestore Timestamps and readers convert before parsing.
export const VersionDoc = z.object({
  number: z.int().min(1),
  createdAt: z.date(),
  author: VersionAuthor,
  summary: z.string().max(200),
  plan: Plan,
  restoredFrom: z.int().nullable(),
});
export type VersionDoc = z.infer<typeof VersionDoc>;

export const Wishes = z.object({
  balance: z.enum(["bricks", "steps"]),
  text: z.string().max(1000),
});
export type Wishes = z.infer<typeof Wishes>;

export const CalendarDoc = z.object({
  year: z.int().min(2024),
  childUid: z.string(),
  childName: z.string(),
  wishes: Wishes,
  currentVersion: z.int().nullable(),
  draft: z.enum(["waiting", "running", "done", "error"]),
  draftError: z.string().nullable(),
  createdBy: z.string(),
});
export type CalendarDoc = z.infer<typeof CalendarDoc>;

export const ManualDoc = z.object({
  order: z.int().min(1),
  fileName: z.string(),
  storagePath: z.string(),
  status: z.enum(["uploaded", "rendering", "analyzing", "done", "error"]),
  pageCount: z.int().nullable(),
  pagesAnalyzed: z.int(),
  setNumber: z.string().nullable(),
  error: z.string().nullable(),
});
export type ManualDoc = z.infer<typeof ManualDoc>;

export const PageDoc = z.object({
  manualId: z.string(),
  page: z.int(),
  imagePath: z.string(),
  width: z.int(),
  height: z.int(),
  analysis: PageAnalysis.nullable(),
});
export type PageDoc = z.infer<typeof PageDoc>;

export const stepId = (manualId: string, page: number, index: number) =>
  `${manualId}:${page}:${index}`;

export const calendarId = (year: number, childUid: string) => `${year}-${childUid}`;
