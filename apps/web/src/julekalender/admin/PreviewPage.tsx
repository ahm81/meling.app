import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { DOOR_COUNT, wholePageSteps } from "@meling/shared";
import { ChildFrame, DAYS, doorFace } from "./Doors";
import { buildSteps, childImages, indexSteps, manualsChangedSincePlan } from "./plan-view";
import { useCalendar } from "./useCalendar";
import { useCutouts, useDownloadUrls } from "./useCutouts";
import { usePages } from "./usePages";

/**
 * «Forhåndsvisning»: the calendar as the child will meet it, for adults. The front page with the 24 doors,
 * and every door can be opened whatever the date. Nothing here is stored: «Ferdig bygget!» only marks the
 * door as done until the page is left. Like the child's view it shows no step, page or brick numbers.
 */
export function PreviewPage() {
  const { calId = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const { calendar, manuals, currentVersion, error } = useCalendar(calId);
  const { pages, loaded, error: pagesError } = usePages(calId);
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());

  const versionNo = calendar?.currentVersion ?? null;
  const plan = currentVersion && currentVersion.number === versionNo ? currentVersion.plan : null;
  const manualsChanged = plan !== null && manualsChangedSincePlan(plan, manuals);
  const cutouts = useCutouts(calId, plan && !manualsChanged ? versionNo : null);

  const pageDocs = useMemo(() => pages.map((p) => p.page), [pages]);
  const steps = useMemo(() => buildSteps(pageDocs, manuals), [pageDocs, manuals]);
  const index = useMemo(() => indexSteps(steps), [steps]);

  const parsed = Number(search.get("luke"));
  const door = Number.isInteger(parsed) && parsed >= 1 && parsed <= DOOR_COUNT ? parsed : null;
  const open = (d: number | null) => setSearch(d === null ? {} : { luke: String(d) });

  // The pictures of the open door, in building order; a whole page in effect is one picture.
  const images = useMemo(() => {
    if (!plan || door === null) return [];
    const daySteps = (plan.days[door - 1]?.stepIds ?? []).flatMap((id) => index.byId.get(id) ?? []);
    const whole = new Map(
      wholePageSteps(plan, steps)
        .filter((w) => w.day === door)
        .flatMap((w) => w.stepIds.map((id) => [id, `${w.manualId}/${w.page}`] as const)),
    );
    return childImages(daySteps, whole);
  }, [plan, door, index, steps]);
  const urls = useDownloadUrls(images.flatMap((img) => cutouts.cutouts[img.stepIds[0]!] ?? []));

  const doorUrls = useDownloadUrls(Object.values(calendar?.doorImages ?? {}));
  const face = (d: number, extra = "") => {
    const path = calendar?.doorImages[d];
    const f = doorFace(path ? doorUrls[path] : null);
    return { ...f, className: `${f.className}${extra}` };
  };

  if (!calendar) return error ? <p role="alert">{error}</p> : null;

  const notice = (
    <p className="preview-notice">
      Forhåndsvisning for voksne. {calendar.childName} ser ikke kalenderen ennå, og her kan alle lukene åpnes uansett
      dato. Ingenting du gjør her lagres.
    </p>
  );

  if (calendar.currentVersion === null) {
    return (
      <section className="preview">
        {notice}
        <p>Det finnes ingen fordeling ennå.</p>
      </section>
    );
  }
  if (!plan || !loaded) {
    return (
      <section className="preview">
        {notice}
        <p role="status">Laster kalenderen …</p>
      </section>
    );
  }

  return (
    <section className="preview">
      {notice}
      {pagesError && <p role="alert">{pagesError}</p>}
      {manualsChanged && (
        <p role="alert">Manualene er endret siden fordelingen ble laget. Lag et nytt utkast for å se bildene.</p>
      )}
      <ChildFrame theme={calendar.theme}>
        {door === null ? (
          <>
            <h2 className="child-title">God jul, {calendar.childName}!</h2>
            <div className="doors">
              {DAYS.map((d) => (
                <button key={d} {...face(d, done.has(d) ? " done" : "")} onClick={() => open(d)}>
                  <span className="door-number">{d}</span>
                  {done.has(d) && <span className="door-done">Ferdig</span>}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div {...face(door, " door-head")}>
              <span className="door-number">{door}</span>
            </div>
            {cutouts.error ? (
              <p role="alert">
                {cutouts.error}{" "}
                <button className="door-retry" onClick={cutouts.retry}>
                  Prøv igjen
                </button>
              </p>
            ) : (
              cutouts.loading && <p role="status">Lager bildene … Dette kan ta litt tid.</p>
            )}
            {images.length === 0 && <p>Denne luken har ingen bilder.</p>}
            <div className="door-images">
              {images.map((img, i) => {
                const path = cutouts.cutouts[img.stepIds[0]!];
                const url = path ? urls[path] : null;
                return url ? (
                  <img key={img.key} src={url} alt={`Bilde ${i + 1}`} />
                ) : (
                  <div key={img.key} className="cutout-empty">
                    {cutouts.loading ? "Lager …" : "Ikke klar"}
                  </div>
                );
              })}
            </div>
            <button
              className="door-finish"
              onClick={() => {
                setDone((s) => new Set(s).add(door));
                open(null);
              }}
            >
              Ferdig bygget!
            </button>
          </>
        )}
      </ChildFrame>
      {door !== null && (
        <div className="toolbar preview-nav">
          <button className="btn" disabled={door === 1} onClick={() => open(door - 1)}>
            Forrige luke
          </button>
          <button className="btn" onClick={() => open(null)}>
            Til kalenderen
          </button>
          <button className="btn" disabled={door === DOOR_COUNT} onClick={() => open(door + 1)}>
            Neste luke
          </button>
        </div>
      )}
    </section>
  );
}
