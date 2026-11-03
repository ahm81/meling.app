import { DOOR_COUNT, type Plan, type Step } from "@meling/shared";

export class TooFewStepsError extends Error {
  constructor(n: number) {
    super(`Manualene har bare ${n} byggetrinn. Det trengs minst ${DOOR_COUNT}.`);
    this.name = "TooFewStepsError";
  }
}

/**
 * stepOnDay: the step lands on the given day (1–24).
 * stepLast: the step is the last step of whichever day it lands on (a day ends right after it).
 */
export type Constraint = { kind: "stepOnDay"; stepId: string; day: number } | { kind: "stepLast"; stepId: string };

const UNSATISFIABLE = "Ønskene kan ikke oppfylles samtidig.";

/**
 * Splits the ordered steps into DOOR_COUNT contiguous days.
 *
 * Minimises Σ (weight(day) − mean)² + PAGE_SPLIT_PENALTY per day boundary that falls inside a page,
 * where weight is bricks or steps per `balance`. A day with weight 0 is not allowed. Constraints are
 * enforced by only allowing day boundaries that satisfy them; if none remain, it throws.
 */
export function distribute(
  steps: Step[],
  opts: { balance: "bricks" | "steps"; constraints: Constraint[] },
): Plan["days"] {
  const n = steps.length;
  const D = DOOR_COUNT;
  if (n < D) throw new TooFewStepsError(n);

  // prefix[j] = total weight of steps[0..j)
  const prefix = new Float64Array(n + 1);
  steps.forEach((s, i) => (prefix[i + 1] = prefix[i]! + (opts.balance === "bricks" ? s.brickCount : 1)));
  const mean = prefix[n]! / D;
  const PAGE_SPLIT_PENALTY = 0.25 * mean * mean;

  // A boundary at j (day ends before steps[j]) splits a page if steps[j-1] and steps[j] share it.
  const splitsPage = (j: number) =>
    j > 0 && j < n && steps[j - 1]!.manualId === steps[j]!.manualId && steps[j - 1]!.page === steps[j]!.page;

  const position = new Map(steps.map((s, i) => [s.id, i]));
  const pos = (id: string) => {
    const p = position.get(id);
    if (p === undefined) throw new Error(`Ukjent trinn i ønskene: ${id}`);
    return p;
  };

  // stepOnDay → allowed range for end[d], the exclusive end index of day d (1-based):
  // a step at p on day k needs end[d] <= p for d < k and end[d] >= p + 1 for d >= k.
  const minEnd = new Int32Array(D + 1).fill(1);
  const maxEnd = new Int32Array(D + 1).fill(n);
  // stepLast → a day may not continue past the step: for a day starting at i, end <= p + 1
  // for the first stepLast position p >= i.
  const lastAt = new Uint8Array(n);
  for (const c of opts.constraints) {
    const p = pos(c.stepId);
    if (c.kind === "stepLast") {
      lastAt[p] = 1;
      continue;
    }
    if (!Number.isInteger(c.day) || c.day < 1 || c.day > D) throw new Error(UNSATISFIABLE);
    for (let d = 1; d < c.day; d++) maxEnd[d] = Math.min(maxEnd[d]!, p);
    for (let d = c.day; d <= D; d++) minEnd[d] = Math.max(minEnd[d]!, p + 1);
  }
  const segmentLimit = new Int32Array(n + 1).fill(n); // max allowed end for a day starting at i
  for (let i = n - 1; i >= 0; i--) segmentLimit[i] = lastAt[i] ? i + 1 : segmentLimit[i + 1]!;

  // cost[d][j]: best cost for putting steps[0..j) into days 1..d, with day d ending at j.
  // from[d][j]: where day d starts in that best solution.
  const cost = Array.from({ length: D + 1 }, () => new Float64Array(n + 1).fill(Infinity));
  const from = Array.from({ length: D + 1 }, () => new Int32Array(n + 1).fill(-1));
  cost[0]![0] = 0;
  for (let d = 1; d <= D; d++) {
    // Day d needs at least d steps before its end and leaves at least D − d steps for later days.
    const lo = Math.max(d, minEnd[d]!);
    const hi = d === D ? n : Math.min(n - (D - d), maxEnd[d]!);
    for (let j = lo; j <= hi; j++) {
      const penalty = splitsPage(j) ? PAGE_SPLIT_PENALTY : 0;
      let best = Infinity;
      let bestI = -1;
      for (let i = d - 1; i < j; i++) {
        const prev = cost[d - 1]![i]!;
        if (prev === Infinity || j > segmentLimit[i]!) continue;
        const w = prefix[j]! - prefix[i]!;
        if (w <= 0) continue;
        const c = prev + (w - mean) ** 2 + penalty;
        if (c < best) {
          best = c;
          bestI = i;
        }
      }
      cost[d]![j] = best;
      from[d]![j] = bestI;
    }
  }
  if (cost[D]![n] === Infinity) throw new Error(UNSATISFIABLE);

  const days: Plan["days"] = [];
  for (let d = D, j = n; d >= 1; d--) {
    const i = from[d]![j]!;
    days.unshift({ stepIds: steps.slice(i, j).map((s) => s.id) });
    j = i;
  }
  return days;
}
