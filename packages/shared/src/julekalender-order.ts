import { type PageAnalysis, type Step, stepId } from "./julekalender";

type StepBox = PageAnalysis["steps"][number];

// Reading order on one page: a box entirely left of another comes first (columns),
// otherwise the higher box comes first.
const readingOrder = (a: StepBox, b: StepBox): number => {
  if (a.bbox.x + a.bbox.w <= b.bbox.x) return -1;
  if (b.bbox.x + b.bbox.w <= a.bbox.x) return 1;
  return a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x;
};

/**
 * Global build order: by manualOrder, then page, then reading order on the page.
 * The printed step number is kept for display only; it restarts in each manual and is
 * sometimes misread, so it never decides the order.
 */
export function orderSteps(
  pages: { manualId: string; manualOrder: number; page: number; analysis: PageAnalysis }[],
): Step[] {
  return [...pages]
    .sort((a, b) => a.manualOrder - b.manualOrder || a.page - b.page)
    .flatMap(({ manualId, manualOrder, page, analysis }) =>
      [...analysis.steps].sort(readingOrder).map((s, index) => ({
        id: stepId(manualId, page, index),
        manualId,
        manualOrder,
        page,
        index,
        printedNumber: s.printedNumber,
        bbox: s.bbox,
        parts: s.parts,
        brickCount: s.parts.reduce((n, p) => n + p.qty, 0),
      })),
    );
}
