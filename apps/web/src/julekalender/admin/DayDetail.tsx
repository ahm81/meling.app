import { useMemo, useState } from "react";
import {
  packingList,
  storagePaths,
  wholePageSteps,
  type Hidden,
  type PageDoc,
  type Plan,
  type PlanOp,
  type Step,
} from "@meling/shared";
import { RegionPicker, type PickerPage } from "./RegionPicker";
import {
  boxStyle,
  childImages,
  dayOfStep,
  hiddenOnPage,
  manualName,
  moveOptions,
  pagesOf,
  stepNo,
  summaries,
  swatchColor,
  type DayRow,
  type StepIndex,
} from "./plan-view";
import { useDownloadUrls, type CutoutState } from "./useCutouts";
import type { Manual } from "./useCalendar";

const pageKey = (manualId: string, page: number) => `${manualId}_${page}`;
const WHOLE_PAGE = { x: 0, y: 0, w: 1, h: 1 };

export function PartLine({ part }: { part: { name: string; color: string; qty: number } }) {
  const swatch = swatchColor(part.color);
  return (
    <li className="part-line">
      <span className={`swatch${swatch ? "" : " none"}`} style={swatch ? { background: swatch } : undefined} aria-hidden="true" />
      <span className="part-name">
        {part.name}
        {part.color && <span className="muted">, {part.color}</span>}
      </span>
      <strong>{part.qty}×</strong>
    </li>
  );
}

/** Selected day: page images, the child's view, edit buttons, packing list and hidden regions. */
export function DayDetail({
  calId,
  plan,
  row,
  steps,
  index,
  pages,
  manuals,
  cutouts,
  busy,
  onEdit,
}: {
  calId: string;
  plan: Plan;
  row: DayRow;
  steps: Step[];
  index: StepIndex;
  pages: Map<string, PageDoc>;
  manuals: Manual[];
  cutouts: CutoutState;
  busy: boolean;
  onEdit: (ops: PlanOp[], summary: string) => Promise<boolean>;
}) {
  const [picking, setPicking] = useState(false);
  const { day } = row;
  const dayPages = useMemo(() => pagesOf(row.steps), [row.steps]);
  const dayOf = useMemo(() => dayOfStep(plan), [plan]);
  const manualById = useMemo(() => new Map(manuals.map((m) => [m.id, m])), [manuals]);
  const todayIds = useMemo(() => new Set(row.steps.map((s) => s.id)), [row.steps]);
  const moves = moveOptions(plan, day);
  // stepId → "manualId/page" for the steps of whole pages in effect today.
  const wholeStepIds = useMemo(
    () =>
      new Map(
        wholePageSteps(plan, steps)
          .filter((w) => w.day === day)
          .flatMap((w) => w.stepIds.map((id) => [id, `${w.manualId}/${w.page}`] as const)),
      ),
    [plan, steps, day],
  );
  const images = useMemo(() => childImages(row.steps, wholeStepIds), [row.steps, wholeStepIds]);

  const imagePaths = dayPages.map((p) => storagePaths.pageImage(calId, p.manualId, p.page));
  const cutoutPaths = row.steps.flatMap((s) => cutouts.cutouts[s.id] ?? []);
  const urls = useDownloadUrls([...imagePaths, ...cutoutPaths]);

  const parts = useMemo(() => packingList(steps, plan.days[day - 1]?.stepIds ?? []), [steps, plan, day]);
  const hiddenHere = plan.hidden.filter((h) => dayPages.some((p) => p.manualId === h.manualId && p.page === h.page));
  const hiddenElsewhere = plan.hidden.filter((h) => !hiddenHere.includes(h));

  const pageLabel = (manualId: string, page: number) => {
    const m = manualById.get(manualId);
    return manuals.length > 1 && m ? `Manual ${m.order}, side ${page}` : `Side ${page}`;
  };

  const pageRanges = (() => {
    const byManual = new Map<string, number[]>();
    for (const p of dayPages) byManual.set(p.manualId, [...(byManual.get(p.manualId) ?? []), p.page]);
    return [...byManual].map(([id, ps]) => {
      const m = manualById.get(id);
      const span = ps.length === 1 ? `side ${ps[0]}` : `side ${ps[0]}–${ps[ps.length - 1]}`;
      return `${m ? manualName(m) : "Ukjent manual"}, ${span}`;
    });
  })();

  function move(stepId: string, toDay: number) {
    const step = index.byId.get(stepId);
    void onEdit([{ type: "moveStep", stepId, toDay }], summaries.move(step ? stepNo(step, index) : 0, day, toDay));
  }

  function setWhole(manualId: string, page: number, whole: boolean) {
    void onEdit([{ type: "wholePage", manualId, page, whole }], summaries.wholePage(page, whole));
  }

  function show(h: Hidden) {
    void onEdit([{ type: "show", hiddenId: h.id }], summaries.show(h.label));
  }

  const pickerPages: PickerPage[] = dayPages.map(({ manualId, page }) => {
    const doc = pages.get(pageKey(manualId, page));
    return {
      manualId,
      page,
      url: urls[storagePaths.pageImage(calId, manualId, page)] ?? null,
      width: doc?.width ?? 3,
      height: doc?.height ?? 4,
      hidden: hiddenOnPage(plan.hidden, manualId, page),
    };
  });

  const stepOf = (id: string) => index.byId.get(id);
  const firstStep = moves.firstToPrev ? stepOf(moves.firstToPrev) : undefined;
  const lastStep = moves.lastToNext ? stepOf(moves.lastToNext) : undefined;
  const cutoutsCurrent = cutouts.version !== null && !cutouts.loading;

  return (
    <div className="day-detail">
      <div className="card">
        <div className="card-head wrap">
          <h2>
            Dag {day} · {row.label.replace(/^Trinn/, "trinn")} · {row.bricks} brikker
          </h2>
          <span className="muted small">{pageRanges.join(" · ")}</span>
        </div>

        <div className="page-grid">
          {dayPages.map(({ manualId, page }) => {
            const doc = pages.get(pageKey(manualId, page));
            const url = urls[storagePaths.pageImage(calId, manualId, page)];
            const onPage = steps.filter((s) => s.manualId === manualId && s.page === page);
            return (
              <figure key={pageKey(manualId, page)} className="page-cell">
                <figcaption className="muted small">{pageLabel(manualId, page)}</figcaption>
                <div
                  className="page-figure"
                  style={{ aspectRatio: doc ? `${doc.width} / ${doc.height}` : "3 / 4" }}
                >
                  {url ? (
                    <img src={url} alt={`Side ${page}`} />
                  ) : (
                    <span className="muted small">Laster side …</span>
                  )}
                  {onPage.map((s) => {
                    const today = todayIds.has(s.id);
                    const other = dayOf.get(s.id);
                    return (
                      <div
                        key={s.id}
                        className={`overlay ${today ? "step-today" : "step-other"}`}
                        style={boxStyle(s.bbox)}
                      >
                        <span className="overlay-label">
                          Trinn {stepNo(s, index)}
                          {!today && other !== undefined && ` · dag ${other}`}
                        </span>
                      </div>
                    );
                  })}
                  {hiddenOnPage(plan.hidden, manualId, page).map((h) => (
                    <div key={h.id} className="overlay hidden-area" style={boxStyle(h.bbox ?? WHOLE_PAGE)}>
                      <span className="overlay-label">Skjult: {h.label}</span>
                    </div>
                  ))}
                </div>
              </figure>
            );
          })}
        </div>

        {picking ? (
          <RegionPicker
            pages={pickerPages}
            busy={busy}
            onCancel={() => setPicking(false)}
            onSubmit={async ({ manualId, page, bbox, label }) => {
              const hidden: Hidden = {
                id: `adult:${crypto.randomUUID()}`,
                manualId,
                page,
                bbox,
                label,
                source: "adult",
              };
              if (await onEdit([{ type: "hide", hidden }], summaries.hide(label, page))) setPicking(false);
            }}
          />
        ) : (
          <div className="toolbar">
            <button
              disabled={busy || !moves.firstToPrev}
              title={firstStep ? `Trinn ${stepNo(firstStep, index)} til dag ${day - 1}` : undefined}
              onClick={() => moves.firstToPrev && move(moves.firstToPrev, day - 1)}
            >
              Flytt første trinn til forrige dag
            </button>
            <button
              disabled={busy || !moves.lastToNext}
              title={lastStep ? `Trinn ${stepNo(lastStep, index)} til dag ${day + 1}` : undefined}
              onClick={() => moves.lastToNext && move(moves.lastToNext, day + 1)}
            >
              Flytt siste trinn til neste dag
            </button>
            <button disabled={busy || dayPages.length === 0} onClick={() => setPicking(true)}>
              Skjul et område …
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Slik ser barnet det</h3>
        {cutouts.error ? (
          <div className="toolbar">
            <span className="manual-status err" role="alert">
              {cutouts.error}
            </span>
            <button onClick={cutouts.retry}>Prøv igjen</button>
          </div>
        ) : (
          cutouts.loading && (
            <p className="muted" role="status">
              Lager forhåndsvisning … Dette kan ta litt tid.
            </p>
          )
        )}
        <div className={`cutouts${cutoutsCurrent ? "" : " stale"}`}>
          {images.map((img, i) => {
            const path = cutouts.cutouts[img.stepIds[0]!];
            const url = path ? urls[path] : null;
            const caption = `Bilde ${i + 1} · ${pageLabel(img.manualId, img.page).toLowerCase()}${img.whole ? " (hele siden)" : ""}`;
            return (
              <figure key={img.key} className={`cutout${img.whole ? " whole" : ""}`}>
                {url ? (
                  <img src={url} alt={`${caption}, slik barnet ser det`} />
                ) : (
                  <div className="cutout-empty muted small">{cutouts.loading ? "Lager …" : "Ikke klar"}</div>
                )}
                <figcaption className="small">{caption}</figcaption>
              </figure>
            );
          })}
        </div>
        <fieldset className="whole-pages">
          <legend className="small muted">Vis en side som ett bilde i stedet for ett bilde per trinn</legend>
          {dayPages.map(({ manualId, page }) => {
            const on = plan.wholePages.some((w) => w.manualId === manualId && w.page === page);
            const split = steps.some((s) => s.manualId === manualId && s.page === page && !todayIds.has(s.id));
            return (
              <label key={pageKey(manualId, page)} className="check">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy || (split && !on)}
                  onChange={(e) => setWhole(manualId, page, e.target.checked)}
                />
                {pageLabel(manualId, page)}
                {split && (
                  <span className="muted small">
                    {on ? " (gjelder ikke nå: trinnene er fordelt på flere dager)" : " (trinnene er fordelt på flere dager)"}
                  </span>
                )}
              </label>
            );
          })}
        </fieldset>
      </div>

      <div className="cards">
        <div className="card">
          <h3>Pakkeliste dag {day}</h3>
          {parts.length === 0 ? (
            <p className="muted">Ingen brikker funnet for denne dagen.</p>
          ) : (
            <ul className="part-list">
              {parts.map((p) => (
                <PartLine key={`${p.color}/${p.name}`} part={p} />
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h3>Skjult fra barnet</h3>
          {hiddenHere.length === 0 && <p className="muted">Ingenting er skjult på sidene for denne dagen.</p>}
          <HiddenList items={hiddenHere} busy={busy} onShow={show} />
          {hiddenElsewhere.length > 0 && (
            <details>
              <summary>Skjult på andre sider ({hiddenElsewhere.length})</summary>
              <HiddenList items={hiddenElsewhere} busy={busy} onShow={show} />
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function HiddenList({ items, busy, onShow }: { items: Hidden[]; busy: boolean; onShow: (h: Hidden) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="manual-list">
      {items.map((h) => (
        <li key={h.id} className="manual-row">
          <div className="manual-main">
            <span>{h.label || "Uten navn"}</span>
            <span className="muted small">
              Side {h.page}
              {h.bbox === null && " (hele siden)"} · {h.source === "ai" ? "skjult av AI" : "skjult av en voksen"}
            </span>
          </div>
          <button disabled={busy} onClick={() => onShow(h)}>
            Vis likevel
          </button>
        </li>
      ))}
    </ul>
  );
}
