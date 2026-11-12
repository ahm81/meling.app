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

// A page the child sees as one image (the whole page, hidden regions painted over) instead of one cutout
// per step. Only used while all the page's steps are on the same day; otherwise the steps are shown one by one.
export const WholePage = z.object({ manualId: z.string(), page: z.int().min(1) });
export type WholePage = z.infer<typeof WholePage>;

export const Plan = z.object({
  days: z.array(z.object({ stepIds: z.array(z.string()) })).length(DOOR_COUNT),
  hidden: z.array(Hidden),
  // Missing in versions written before whole pages existed.
  wholePages: z.array(WholePage).default([]),
});
export type Plan = z.infer<typeof Plan>;

/**
 * The plan's whole pages that are in effect: the page has steps and all of them are on one day.
 * `day` is 1-based; `stepIds` are in the day's order. Pages split over days are left out.
 */
export function wholePageSteps(
  plan: Plan,
  steps: Step[],
): { manualId: string; page: number; day: number; stepIds: string[] }[] {
  const dayOf = new Map(plan.days.flatMap((d, i) => d.stepIds.map((id) => [id, i + 1] as const)));
  return plan.wholePages.flatMap(({ manualId, page }) => {
    const onPage = new Set(steps.filter((s) => s.manualId === manualId && s.page === page).map((s) => s.id));
    const days = new Set([...onPage].map((id) => dayOf.get(id)));
    if (onPage.size === 0 || days.size !== 1) return [];
    const day = [...days][0];
    if (day === undefined) return [];
    return [{ manualId, page, day, stepIds: plan.days[day - 1]!.stepIds.filter((id) => onPage.has(id)) }];
  });
}

export const PlanOp = z.discriminatedUnion("type", [
  z.object({ type: z.literal("moveStep"), stepId: z.string(), toDay: z.int().min(1).max(DOOR_COUNT) }),
  z.object({ type: z.literal("hide"), hidden: Hidden }),
  z.object({ type: z.literal("show"), hiddenId: z.string() }),
  z.object({ type: z.literal("wholePage"), manualId: z.string(), page: z.int().min(1), whole: z.boolean() }),
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
  // Set by functions whenever `draft` changes; a "running" draft older than 15 minutes can be redone.
  // A Date here; readers convert the Firestore Timestamp before parsing.
  draftUpdatedAt: z.date().optional(),
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
  // Set by functions on every status or progress write; a manual stuck in "rendering" or "analyzing"
  // for more than 15 minutes can be retried. Never set by clients. A Date here (readers convert).
  updatedAt: z.date().optional(),
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
