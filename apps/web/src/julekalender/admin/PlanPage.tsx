import { useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { DOOR_COUNT, reconcile, type PageDoc, type PlanOp } from "@meling/shared";
import { editPlan, redraft } from "./api";
import { DayDetail } from "./DayDetail";
import { REDRAFT_CONFIRM, buildSteps, callableError, dayRows, indexSteps, manualName } from "./plan-view";
import { useCalendar } from "./useCalendar";
import { useCutouts } from "./useCutouts";
import { usePages } from "./usePages";

/** «Fordeling»: the 24 days, the selected day in detail, edits and the parts reconciliation. */
export function PlanPage() {
  const { calId = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const { calendar, manuals, currentVersion, error } = useCalendar(calId);
  const { pages, loaded: pagesLoaded, error: pagesError } = usePages(calId);
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState<{ message: string; stale: boolean } | null>(null);
  const [redrafting, setRedrafting] = useState(false);
  // Guards against double submits before React re-renders with busy = true.
  const inFlight = useRef(false);

  const versionNo = calendar?.currentVersion ?? null;
  // Only edit when the plan we show is the calendar's current version.
  const plan = currentVersion && currentVersion.number === versionNo ? currentVersion.plan : null;
  const cutouts = useCutouts(calId, plan ? versionNo : null);

  const pageDocs = useMemo(() => pages.map((p) => p.page), [pages]);
  const steps = useMemo(() => buildSteps(pageDocs, manuals), [pageDocs, manuals]);
  const index = useMemo(() => indexSteps(steps), [steps]);
  const rows = useMemo(() => (plan ? dayRows(plan, index) : []), [plan, index]);
  const pageMap = useMemo(() => new Map<string, PageDoc>(pages.map((p) => [`${p.page.manualId}_${p.page.page}`, p.page])), [pages]);

  const discrepancies = useMemo(
    () =>
      manuals.flatMap((m) => {
        const inventory = pageDocs.filter((p) => p.manualId === m.id).flatMap((p) => p.analysis?.inventory ?? []);
        if (inventory.length === 0) return [];
        const lines = reconcile(
          steps.filter((s) => s.manualId === m.id),
          inventory,
        );
        return [{ manual: m, lines }];
      }),
    [manuals, pageDocs, steps],
  );

  const parsedDay = Number(search.get("dag"));
  const day = Number.isInteger(parsedDay) && parsedDay >= 1 && parsedDay <= DOOR_COUNT ? parsedDay : 1;
  const selectDay = (d: number) => setSearch({ dag: String(d) }, { replace: true });

  async function edit(ops: PlanOp[], summary: string): Promise<boolean> {
    if (!calendar || versionNo === null || inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setEditError(null);
    try {
      await editPlan({ calendarId: calId, baseVersion: versionNo, ops, summary });
      return true;
    } catch (e) {
      console.error("editPlan", e);
      setEditError(callableError(e));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function startRedraft() {
    if (!calendar || redrafting) return;
    if (!window.confirm(REDRAFT_CONFIRM)) return;
    setRedrafting(true);
    setEditError(null);
    // Progress follows calendar.draft through the Firestore snapshot.
    redraft({ calendarId: calId, baseVersion: calendar.currentVersion })
      .catch((e) => {
        console.error("redraft", e);
        setEditError({ ...callableError(e), stale: false });
      })
      .finally(() => setRedrafting(false));
  }

  // Show why there is nothing to show (for example a denied read) instead of a blank page.
  if (!calendar) return error ? <p role="alert">{error}</p> : null;

  const draftRunning = calendar.draft === "running";
  const selected = rows[day - 1];

  return (
    <section className="plan">
      {error && <p role="alert">{error}</p>}
      {pagesError && <p role="alert">{pagesError}</p>}

      <div className="admin-head row">
        <div>
          <h2 className="plan-title">Fordeling på 24 dager</h2>
          {currentVersion && plan && (
            <span className="muted small">
              Versjon {currentVersion.number}: {currentVersion.summary}
            </span>
          )}
        </div>
        <div className="toolbar">
          <Link className="btn" to={`/julekalender/admin/${calId}/pakkeliste`}>
            Pakkeliste
          </Link>
          {versionNo !== null && (
            <button onClick={startRedraft} disabled={redrafting || draftRunning || busy}>
              Lag nytt AI-forslag
            </button>
          )}
        </div>
      </div>

      {draftRunning && (
        <div className="banner run" role="status">
          <span>AI-en lager et nytt forslag …</span>
        </div>
      )}
      {calendar.draft === "error" && versionNo !== null && (
        <div className="banner err" role="alert">
          <span>Det nye forslaget feilet: {calendar.draftError ?? "ukjent feil"}</span>
        </div>
      )}
      {editError && (
        <div className="banner err" role="alert">
          <span>{editError.message}</span>
          {editError.stale ? (
            <button className="primary" onClick={() => setEditError(null)}>
              Last på nytt
            </button>
          ) : (
            <button onClick={() => setEditError(null)}>Lukk</button>
          )}
        </div>
      )}

      {versionNo === null ? (
        <div className="card">
          <p>Det finnes ingen fordeling ennå.</p>
          <Link className="btn" to={`/julekalender/admin/${calId}/manualer`}>
            Til manualene
          </Link>
        </div>
      ) : !plan || !pagesLoaded ? (
        <p role="status">Laster fordelingen …</p>
      ) : (
        <div className="plan-layout">
          <nav className="day-list card" aria-label="Dager">
            <div className="day-row day-head" aria-hidden="true">
              <span>Dag</span>
              <span>Trinn</span>
              <span className="num">Brikker</span>
            </div>
            {rows.map((r) => (
              <button
                key={r.day}
                aria-current={r.day === day ? "true" : undefined}
                className={`day-row${r.day === day ? " selected" : ""}`}
                title={r.title}
                onClick={() => selectDay(r.day)}
              >
                <strong>{r.day}</strong>
                <span className="day-steps">
                  {r.label}
                  {r.warnings.map((w) => (
                    <span key={w} className="flag">
                      {w}
                    </span>
                  ))}
                </span>
                <span className="num">{r.bricks}</span>
              </button>
            ))}
          </nav>

          <div className="plan-detail">
            {selected && (
              <DayDetail
                key={day}
                calId={calId}
                plan={plan}
                row={selected}
                steps={steps}
                index={index}
                pages={pageMap}
                manuals={manuals}
                cutouts={cutouts}
                busy={busy || redrafting || draftRunning}
                onEdit={edit}
              />
            )}

            <div className="card">
              <h3>Delelisten</h3>
              {discrepancies.length === 0 ? (
                <p className="muted">Fant ingen deleliste i manualene, så antallet kan ikke kontrolleres.</p>
              ) : (
                discrepancies.map(({ manual, lines }) => (
                  <div key={manual.id} className="reconcile">
                    {discrepancies.length > 1 && <strong>{manualName(manual)}</strong>}
                    {lines.length === 0 ? (
                      <p className="muted">Alle brikkene i delelisten er fordelt på en dag.</p>
                    ) : (
                      <ul className="hidden-list">
                        {lines.map((l) => (
                          <li key={`${l.color}/${l.name}`}>
                            {l.name}
                            {l.color && `, ${l.color}`}:{" "}
                            <span className="muted">
                              Delelisten sier {l.expected}, fordelt {l.distributed}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
