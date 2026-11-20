import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { DOOR_COUNT, brickBags, brickCatalog, brickReconcile, packingList, storagePaths } from "@meling/shared";
import { editPlan, readBricks } from "./api";
import { BrickBagList, BrickLine, bagCount, bricksText } from "./Bricks";
import { PartLine } from "./DayDetail";
import { buildSteps, callableError } from "./plan-view";
import { useCalendar } from "./useCalendar";
import { useDownloadUrls } from "./useCutouts";
import { usePages } from "./usePages";

/**
 * Printable packing list: one section per day («Pose N») with the parts. With bricks read from the manuals
 * it shows each brick's picture and element id, a view per brick, and the bricks that are in no bag.
 * Otherwise it lists the parts as the AI described them. No images of the finished model.
 */
export function PackingListPrint() {
  const { calId = "" } = useParams();
  const { calendar, manuals, currentVersion, error } = useCalendar(calId);
  const { pages, loaded, error: pagesError } = usePages(calId);
  const [view, setView] = useState<"bags" | "bricks">("bags");
  const [reading, setReading] = useState(false);
  const [readMessage, setReadMessage] = useState<string | null>(null);

  const pageDocs = useMemo(() => pages.map((p) => p.page), [pages]);
  const steps = useMemo(() => buildSteps(pageDocs, manuals), [pageDocs, manuals]);
  const plan =
    calendar && currentVersion && currentVersion.number === calendar.currentVersion ? currentVersion.plan : null;
  const catalog = useMemo(() => brickCatalog(pageDocs, manuals), [pageDocs, manuals]);
  const textBags = useMemo(() => (plan ? plan.days.map((d) => packingList(steps, d.stepIds)) : []), [plan, steps]);
  const bags = useMemo(() => (plan && catalog ? brickBags(catalog, plan) : []), [plan, catalog]);
  const differences = useMemo(() => (plan && catalog ? brickReconcile(catalog, plan) : []), [plan, catalog]);
  const missing = differences.filter((d) => d.distributed < d.expected);
  const surplus = differences.filter((d) => d.distributed > d.expected);
  // Per brick: which bags it goes in.
  const perBrick = useMemo(() => {
    if (!catalog) return [];
    return catalog.inventory.map((b) => ({
      ...b,
      bags: bags.flatMap((bag, i) => {
        const qty =
          (bag.lines.find((l) => l.elementId === b.elementId)?.qty ?? 0) +
          bag.unsure.filter((c) => c.elementId === b.elementId).reduce((n, c) => n + c.qty, 0);
        return qty > 0 ? [{ day: i + 1, qty }] : [];
      }),
    }));
  }, [catalog, bags]);

  const imagePaths = useMemo(
    () => (catalog ? catalog.inventory.map((b) => storagePaths.brickImage(calId, b.elementId)) : []),
    [catalog, calId],
  );
  const urls = useDownloadUrls(view === "bricks" || differences.length > 0 ? imagePaths : []);
  const urlOf = (elementId: string) => urls[storagePaths.brickImage(calId, elementId)];

  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  // How many of each missing brick to place; defaults to all that are missing.
  const [amounts, setAmounts] = useState<Record<string, number>>({});

  /** Sets how many of a brick are placed by hand in a day's bag (0 takes them out) as a new version. */
  async function place(elementId: string, day: number, qty: number, summary: string) {
    if (!calendar || calendar.currentVersion === null || placing) return;
    setPlacing(true);
    setPlaceError(null);
    try {
      await editPlan({
        calendarId: calId,
        baseVersion: calendar.currentVersion,
        ops: [{ type: "placeBrick", elementId, day, qty }],
        summary,
      });
    } catch (e) {
      console.error("editPlan", e);
      setPlaceError(callableError(e).message);
    } finally {
      setPlacing(false);
    }
  }
  const placedIn = (elementId: string, day: number) =>
    plan?.extraBricks.find((b) => b.elementId === elementId && b.day === day)?.qty ?? 0;

  async function read() {
    setReading(true);
    setReadMessage(null);
    try {
      const { data } = await readBricks({ calendarId: calId });
      setReadMessage(
        data.elements === 0
          ? "Fant ingen deleliste med brikkenumre i manualene, så pakkelisten bruker AI-ens beskrivelser."
          : `Leste ${data.elements} brikketyper fra delelisten.`,
      );
    } catch (e) {
      console.error("readBricks", e);
      setReadMessage(callableError(e).message);
    } finally {
      setReading(false);
    }
  }

  // Show why there is nothing to show (for example a denied read) instead of a blank page.
  if (!calendar) return error ? <p role="alert">{error}</p> : null;

  const total = catalog?.inventory.reduce((n, b) => n + b.qty, 0) ?? 0;
  const inBags = bags.reduce((n, b) => n + bagCount(b), 0);
  const unsure = bags.reduce((n, b) => n + b.unsure.length, 0);

  return (
    <section className="packing">
      {error && <p role="alert">{error}</p>}
      {pagesError && <p role="alert">{pagesError}</p>}
      <div className="admin-head row no-print">
        <h2 className="plan-title">Pakkeliste</h2>
        <div className="toolbar">
          {catalog && (
            <div className="segmented" role="group" aria-label="Visning">
              <button aria-pressed={view === "bags"} onClick={() => setView("bags")}>
                Per pose
              </button>
              <button aria-pressed={view === "bricks"} onClick={() => setView("bricks")}>
                Per brikke
              </button>
            </div>
          )}
          <button className="btn" onClick={read} disabled={reading || !loaded}>
            {reading ? "Leser brikkene …" : catalog ? "Les brikkene på nytt" : "Hent bilder og brikkenumre"}
          </button>
          <Link className="btn" to={`/julekalender/admin/${calId}/fordeling`}>
            Til fordelingen
          </Link>
          <button className="primary" onClick={() => window.print()} disabled={!plan || !loaded}>
            Skriv ut
          </button>
        </div>
      </div>
      {readMessage && (
        <p role="status" className="no-print">
          {readMessage}
        </p>
      )}

      {calendar.currentVersion === null ? (
        <p>Det finnes ingen fordeling ennå.</p>
      ) : !plan || !loaded ? (
        <p role="status">Laster pakkelisten …</p>
      ) : (
        <>
          <p className="print-only">
            Julekalender {calendar.year} – {calendar.childName} (versjon {calendar.currentVersion})
          </p>
          {catalog && (
            <p className="muted">
              Delelisten har {total} brikker. {inBags} ligger i en pose
              {missing.length > 0 && `, ${missing.reduce((n, d) => n + d.expected - d.distributed, 0)} gjør det ikke`}
              {unsure > 0 && `, og ${unsure} brikkelinjer er usikre (merket med ?)`}.
            </p>
          )}

          {!catalog ? (
            <div className="bags">
              {textBags.map((parts, i) => (
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
          ) : view === "bags" ? (
            <div className="bags">
              {bags.map((bag, i) => (
                <section key={i} className="bag">
                  <h3>
                    Pose {i + 1} <span className="muted small">{bricksText(bagCount(bag))}</span>
                  </h3>
                  <BrickBagList
                    calId={calId}
                    bag={bag}
                    tick
                    busy={placing}
                    onRemove={(elementId, qty) => place(elementId, i + 1, 0, `Tok ${qty}× ${elementId} ut av pose ${i + 1}`)}
                  />
                </section>
              ))}
            </div>
          ) : (
            <ul className="brick-grid">
              {perBrick.map((b) => (
                <BrickLine key={b.elementId} url={urlOf(b.elementId)} elementId={b.elementId} note={`${b.qty} i settet`}>
                  <span className="brick-bags">
                    {b.bags.length === 0 ? "Ingen pose" : b.bags.map((x) => `Pose ${x.day}: ${x.qty}×`).join(" · ")}
                  </span>
                </BrickLine>
              ))}
            </ul>
          )}

          {catalog && missing.length > 0 && (
            <section className="bag">
              <h3>Ikke i noen pose</h3>
              <p className="muted small">
                Brikker delelisten har flere av enn byggetrinnene viser, for eksempel figurdeler. Velg posen de skal
                i, der de bygges.
              </p>
              {placeError && <p role="alert">{placeError}</p>}
              <ul className="part-list brick-columns">
                {missing.map((d) => {
                  const left = d.expected - d.distributed;
                  const amount = Math.min(amounts[d.elementId] ?? left, left);
                  return (
                    <BrickLine key={d.elementId} url={urlOf(d.elementId)} elementId={d.elementId} tick>
                      <span className="place no-print">
                        {left > 1 && (
                          <select
                            aria-label={`Antall av ${d.elementId}`}
                            value={amount}
                            disabled={placing}
                            onChange={(e) => setAmounts((a) => ({ ...a, [d.elementId]: Number(e.target.value) }))}
                          >
                            {Array.from({ length: left }, (_, n) => (
                              <option key={n + 1} value={n + 1}>
                                {n + 1}×
                              </option>
                            ))}
                          </select>
                        )}
                        <select
                          aria-label={`Legg ${d.elementId} i pose`}
                          value=""
                          disabled={placing}
                          onChange={(e) => {
                            const day = Number(e.target.value);
                            if (day) void place(d.elementId, day, placedIn(d.elementId, day) + amount, `La ${amount}× ${d.elementId} i pose ${day}`);
                          }}
                        >
                          <option value="">Legg i pose …</option>
                          {Array.from({ length: DOOR_COUNT }, (_, n) => (
                            <option key={n + 1} value={n + 1}>
                              Pose {n + 1}
                            </option>
                          ))}
                        </select>
                      </span>
                      <strong>{left}×</strong>
                    </BrickLine>
                  );
                })}
              </ul>
            </section>
          )}
          {catalog && surplus.length > 0 && (
            <section className="bag">
              <h3>Flere enn delelisten har</h3>
              <p className="muted small">
                Byggetrinnene ser ut til å bruke flere av disse enn settet har. Trolig er en brikke koblet til feil
                nummer (se etter linjer merket med ?), eller lagt i en pose for hånd en gang for mye.
              </p>
              <ul className="part-list brick-columns">
                {surplus.map((d) => (
                  <BrickLine key={d.elementId} url={urlOf(d.elementId)} elementId={d.elementId}>
                    <strong>
                      {d.distributed} av {d.expected}
                    </strong>
                  </BrickLine>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}
