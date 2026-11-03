import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { packingList } from "@meling/shared";
import { PartLine } from "./DayDetail";
import { buildSteps } from "./plan-view";
import { useCalendar } from "./useCalendar";
import { usePages } from "./usePages";

/** Printable packing list: one section per day («Pose N») with the parts. No images of the finished model. */
export function PackingListPrint() {
  const { calId = "" } = useParams();
  const { calendar, manuals, currentVersion, error } = useCalendar(calId);
  const { pages, loaded, error: pagesError } = usePages(calId);

  const pageDocs = useMemo(() => pages.map((p) => p.page), [pages]);
  const steps = useMemo(() => buildSteps(pageDocs, manuals), [pageDocs, manuals]);
  const plan =
    calendar && currentVersion && currentVersion.number === calendar.currentVersion ? currentVersion.plan : null;
  const bags = useMemo(() => (plan ? plan.days.map((d) => packingList(steps, d.stepIds)) : []), [plan, steps]);

  // Show why there is nothing to show (for example a denied read) instead of a blank page.
  if (!calendar) return error ? <p role="alert">{error}</p> : null;

  return (
    <section className="packing">
      {error && <p role="alert">{error}</p>}
      {pagesError && <p role="alert">{pagesError}</p>}
      <div className="admin-head row no-print">
        <h2 className="plan-title">Pakkeliste</h2>
        <div className="toolbar">
          <Link className="btn" to={`/julekalender/admin/${calId}/fordeling`}>
            Til fordelingen
          </Link>
          <button className="primary" onClick={() => window.print()} disabled={!plan || !loaded}>
            Skriv ut
          </button>
        </div>
      </div>

      {calendar.currentVersion === null ? (
        <p>Det finnes ingen fordeling ennå.</p>
      ) : !plan || !loaded ? (
        <p role="status">Laster pakkelisten …</p>
      ) : (
        <>
          <p className="print-only">
            Julekalender {calendar.year} – {calendar.childName} (versjon {calendar.currentVersion})
          </p>
          <div className="bags">
            {bags.map((parts, i) => (
              <section key={i} className="bag">
                <h3>Pose {i + 1}</h3>
                {parts.length === 0 ? (
                  <p className="muted">Ingen brikker.</p>
                ) : (
                  <ul className="part-list">
                    {parts.map((p) => (
                      <PartLine key={`${p.color}/${p.name}`} part={p} />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
