// Pure helpers for the plan page, the day detail and the printable packing list.
import { DOOR_COUNT, orderSteps, type Bbox, type Hidden, type PageDoc, type Plan, type Step } from "@meling/shared";
import type { Manual } from "./useCalendar";

export function manualName(m: Pick<Manual, "setNumber" | "fileName">): string {
  return m.setNumber ? `${m.setNumber} (${m.fileName})` : m.fileName;
}

/** The global build order, as the functions compute it: only analysed pages of known manuals. */
export function buildSteps(pages: PageDoc[], manuals: Pick<Manual, "id" | "order">[]): Step[] {
  const order = new Map(manuals.map((m) => [m.id, m.order]));
  return orderSteps(
    pages.flatMap((p) => {
      const manualOrder = order.get(p.manualId);
      return p.analysis && manualOrder !== undefined
        ? [{ manualId: p.manualId, manualOrder, page: p.page, analysis: p.analysis }]
        : [];
    }),
  );
}

export interface StepIndex {
  byId: Map<string, Step>;
  /** 1-based position in the global build order. */
  globalNo: Map<string, number>;
}

export function indexSteps(steps: Step[]): StepIndex {
  return {
    byId: new Map(steps.map((s) => [s.id, s])),
    globalNo: new Map(steps.map((s, i) => [s.id, i + 1])),
  };
}

/** The number printed in the manual, or the global number if the AI could not read one. */
export function stepNo(step: Step, index: StepIndex): number {
  return step.printedNumber >= 1 ? step.printedNumber : (index.globalNo.get(step.id) ?? 0);
}

const range = (a: number, b: number) => (a === b ? `${a}` : `${a}–${b}`);

export type DayWarning = "midt på side" | "få brikker";

export interface DayRow {
  day: number;
  steps: Step[];
  /** «Trinn 9–11» from the printed numbers. */
  label: string;
  /** Global numbers for the tooltip. */
  title: string;
  bricks: number;
  warnings: DayWarning[];
}

const samePage = (a: Step, b: Step) => a.manualId === b.manualId && a.page === b.page;

/**
 * One row per day: step range, brick count and warnings. «midt på side» when the day's first step
 * shares a page with the previous day's last step; «få brikker» when the day has under half the
 * average bricks per day. Unknown step ids (pages still loading) are skipped.
 */
export function dayRows(plan: Plan, index: StepIndex): DayRow[] {
  const days = plan.days.map((d) => d.stepIds.flatMap((id) => index.byId.get(id) ?? []));
  const total = days.reduce((n, steps) => n + steps.reduce((m, s) => m + s.brickCount, 0), 0);
  const average = total / DOOR_COUNT;
  return days.map((steps, i) => {
    const bricks = steps.reduce((n, s) => n + s.brickCount, 0);
    const first = steps[0];
    const last = steps[steps.length - 1];
    const warnings: DayWarning[] = [];
    const prevLast = days[i - 1]?.at(-1);
    if (first && prevLast && samePage(first, prevLast)) warnings.push("midt på side");
    if (average > 0 && bricks < average / 2) warnings.push("få brikker");
    let label = "Ingen trinn";
    let title = "";
    if (first && last) {
      const a = stepNo(first, index);
      const b = stepNo(last, index);
      label = first.manualId === last.manualId ? `Trinn ${range(a, b)}` : `Trinn ${a} – ${b} (to manualer)`;
      title = `Trinn ${range(index.globalNo.get(first.id) ?? 0, index.globalNo.get(last.id) ?? 0)} i hele byggerekkefølgen`;
    }
    return { day: i + 1, steps, label, title, bricks, warnings };
  });
}

/**
 * The moves the server allows for a day (see functions ops.ts): the first step to the day before,
 * the last step to the day after, never leaving the day empty.
 */
export function moveOptions(plan: Plan, day: number): { firstToPrev: string | null; lastToNext: string | null } {
  const ids = plan.days[day - 1]?.stepIds ?? [];
  const canMove = ids.length > 1;
  return {
    firstToPrev: canMove && day > 1 ? ids[0]! : null,
    lastToNext: canMove && day < DOOR_COUNT ? ids[ids.length - 1]! : null,
  };
}

/** The distinct pages (in build order) that the given steps are on. */
export function pagesOf(steps: Step[]): { manualId: string; page: number }[] {
  const seen = new Set<string>();
  const out: { manualId: string; page: number }[] = [];
  for (const s of steps) {
    const key = `${s.manualId}_${s.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ manualId: s.manualId, page: s.page });
  }
  return out;
}

export function hiddenOnPage(hidden: Hidden[], manualId: string, page: number): Hidden[] {
  return hidden.filter((h) => h.manualId === manualId && h.page === page);
}

/** Day (1-based) of every planned step. */
export function dayOfStep(plan: Plan): Map<string, number> {
  return new Map(plan.days.flatMap((d, i) => d.stepIds.map((id) => [id, i + 1] as const)));
}

const MAX_SUMMARY = 200;
const quoteLabel = (label: string) => `«${label.length > 80 ? `${label.slice(0, 79)}…` : label}»`;
const clip = (s: string) => (s.length > MAX_SUMMARY ? `${s.slice(0, MAX_SUMMARY - 1)}…` : s);

export const summaries = {
  move: (no: number, from: number, to: number) => clip(`Flyttet trinn ${no} fra dag ${from} til dag ${to}`),
  hide: (label: string, page: number) => clip(`Skjulte ${quoteLabel(label)} på side ${page}`),
  show: (label: string) => clip(`Viste ${quoteLabel(label)} igjen`),
};

/** Smallest region the picker accepts, as a fraction of the page side. */
export const MIN_REGION = 0.02;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** Start and size on one axis, rounded and kept inside [0,1] so start + size ≤ 1. */
function fitAxis(a: number, b: number): [number, number] {
  const start = round(Math.min(clamp01(a), clamp01(b)));
  let size = round(Math.abs(clamp01(a) - clamp01(b)));
  if (start + size > 1) size = round(1 - start);
  while (size > 0 && start + size > 1) size -= 0.0001;
  return [start, Math.max(0, size)];
}

/**
 * The normalised box spanned by two points (any order, any values; clamped to the page),
 * or null if it is smaller than `min` on either side.
 */
export function rectFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
  min = MIN_REGION,
): Bbox | null {
  const [x, w] = fitAxis(a.x, b.x);
  const [y, h] = fitAxis(a.y, b.y);
  if (w < min || h < min) return null;
  return { x, y, w, h };
}

/** CSS percentages for absolutely positioning a normalised box. */
export function boxStyle(b: Bbox): { left: string; top: string; width: string; height: string } {
  const pct = (n: number) => `${n * 100}%`;
  return { left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) };
}

// Common LEGO colour names as the AI writes them (mostly Norwegian), for a swatch next to the part.
const COLORS: Record<string, string> = {
  rød: "#c91a09",
  mørkerød: "#720e0f",
  blå: "#0055bf",
  mørkeblå: "#0a3463",
  lyseblå: "#9fc3e9",
  mellomblå: "#5a93db",
  asurblå: "#078bc9",
  turkis: "#36aebf",
  gul: "#f2cd37",
  lysegul: "#fbe696",
  grønn: "#237841",
  mørkegrønn: "#184632",
  lysegrønn: "#73dca1",
  lime: "#bbe90b",
  limegrønn: "#bbe90b",
  oliven: "#9b9a5a",
  svart: "#1b2a34",
  sort: "#1b2a34",
  hvit: "#f4f4f4",
  grå: "#a0a5a9",
  lysgrå: "#a0a5a9",
  lysegrå: "#a0a5a9",
  mørkgrå: "#6c6e68",
  mørkegrå: "#6c6e68",
  oransje: "#fe8a18",
  brun: "#583927",
  mørkebrun: "#352100",
  rødbrun: "#582a12",
  beige: "#e4cd9e",
  sand: "#e4cd9e",
  mørkbeige: "#958a73",
  mørkebeige: "#958a73",
  rosa: "#fc97ac",
  mørkrosa: "#c870a0",
  lilla: "#81007b",
  fiolett: "#4354a3",
  lavendel: "#cda4de",
  sølv: "#a0a5a9",
  gull: "#dbac34",
  red: "#c91a09",
  blue: "#0055bf",
  yellow: "#f2cd37",
  green: "#237841",
  black: "#1b2a34",
  white: "#f4f4f4",
  gray: "#a0a5a9",
  grey: "#a0a5a9",
  orange: "#fe8a18",
  brown: "#583927",
  tan: "#e4cd9e",
  pink: "#fc97ac",
  purple: "#81007b",
};

/** A CSS colour for a part colour name, or null if unknown (then no swatch is shown). */
export function swatchColor(name: string): string | null {
  const raw = name.trim().toLowerCase();
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(raw)) return raw;
  const key = raw.replace(/[\s-]+/g, "");
  return COLORS[key] ?? null;
}

/** Callable errors: failed-precondition means the version is stale, the rest show their message. */
export function callableError(e: unknown): { message: string; stale: boolean } {
  const { code, message } = (e ?? {}) as { code?: string; message?: string };
  if (code === "functions/failed-precondition") {
    return { message: message || "Kalenderen er endret av noen andre. Last siden på nytt.", stale: true };
  }
  if ((code === "functions/invalid-argument" || code === "functions/not-found" || code === "functions/permission-denied") &&
    message) {
    return { message, stale: false };
  }
  return { message: "Noe gikk galt. Prøv igjen om litt.", stale: false };
}

export interface PlanDiff {
  /** One line per day whose steps differ, e.g. «Dag 5: trinn 9–11 → 9–12». */
  days: string[];
  added: Hidden[];
  removed: Hidden[];
}

/** «trinn 9–11» from printed numbers when the steps are known, else «3 trinn». */
function stepsLabel(ids: string[], index: StepIndex): string {
  if (ids.length === 0) return "ingen trinn";
  const steps = ids.map((id) => index.byId.get(id));
  const first = steps[0];
  const last = steps[steps.length - 1];
  if (first && last && steps.every(Boolean)) {
    const a = stepNo(first, index);
    const b = stepNo(last, index);
    if (first.manualId === last.manualId) return `trinn ${range(a, b)}`;
  }
  return `${ids.length} trinn`;
}

/** What changed from `prev` to `next`: days with different steps, and hidden regions added or removed (by id). */
export function diffPlans(prev: Plan, next: Plan, index: StepIndex): PlanDiff {
  const days: string[] = [];
  next.days.forEach((d, i) => {
    const before = prev.days[i]?.stepIds ?? [];
    const same = before.length === d.stepIds.length && before.every((id, k) => id === d.stepIds[k]);
    if (!same) days.push(`Dag ${i + 1}: ${stepsLabel(before, index)} → ${stepsLabel(d.stepIds, index)}`);
  });
  const prevIds = new Set(prev.hidden.map((h) => h.id));
  const nextIds = new Set(next.hidden.map((h) => h.id));
  return {
    days,
    added: next.hidden.filter((h) => !prevIds.has(h.id)),
    removed: prev.hidden.filter((h) => !nextIds.has(h.id)),
  };
}
