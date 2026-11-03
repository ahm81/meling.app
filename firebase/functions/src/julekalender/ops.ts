import type { Plan, PlanOp, Step } from "@meling/shared";

export class InvalidOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOpError";
  }
}

/**
 * Applies edit operations in order and returns a new plan; the input is never mutated.
 * moveStep: only the first step of a day (to the day before) or the last (to the day after), and
 * the source day may not become empty. hide: the id must be new. show: the id must exist.
 */
export function applyOps(plan: Plan, steps: Step[], ops: PlanOp[]): Plan {
  const known = new Set(steps.map((s) => s.id));
  const days = plan.days.map((d) => ({ stepIds: [...d.stepIds] }));
  let hidden = [...plan.hidden];

  for (const op of ops) {
    if (op.type === "moveStep") {
      const from = days.findIndex((d) => d.stepIds.includes(op.stepId));
      if (from < 0 || !known.has(op.stepId)) throw new InvalidOpError(`Fant ikke trinnet ${op.stepId}.`);
      const to = op.toDay - 1;
      if (Math.abs(to - from) !== 1) throw new InvalidOpError("Et trinn kan bare flyttes til dagen før eller etter.");
      const src = days[from]!.stepIds;
      const isFirst = src[0] === op.stepId;
      const isLast = src[src.length - 1] === op.stepId;
      if (!(to < from ? isFirst : isLast)) {
        throw new InvalidOpError(
          "Du kan bare flytte det første trinnet til dagen før eller det siste til dagen etter (bare første eller siste trinn).",
        );
      }
      if (src.length === 1) throw new InvalidOpError("Dagen kan ikke bli tom.");
      src.splice(to < from ? 0 : src.length - 1, 1);
      if (to < from) days[to]!.stepIds.push(op.stepId);
      else days[to]!.stepIds.unshift(op.stepId);
    } else if (op.type === "hide") {
      if (hidden.some((h) => h.id === op.hidden.id)) throw new InvalidOpError("Området er allerede skjult.");
      hidden = [...hidden, op.hidden];
    } else {
      if (!hidden.some((h) => h.id === op.hiddenId)) throw new InvalidOpError("Fant ikke det skjulte området.");
      hidden = hidden.filter((h) => h.id !== op.hiddenId);
    }
  }
  return { days, hidden };
}
