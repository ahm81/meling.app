import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { MemberDoc, VersionDoc, paths, type VersionAuthor } from "@meling/shared";
import { db } from "../../firebase";
import { fromFirestore } from "../../firestore";
import { restoreVersion } from "./api";
import { buildSteps, callableError, diffPlans, indexSteps } from "./plan-view";
import { useCalendar } from "./useCalendar";
import { usePages } from "./usePages";
import { useConfirm } from "./useConfirm";

/** «3. nov. kl. 21.14» */
export function formatTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const month = get("month").replace(/\.$/, "");
  return `${get("day")}. ${month}. kl. ${get("hour")}.${get("minute")}`;
}

export function authorLabel(author: VersionAuthor, names: Map<string, string>): string {
  const name = (uid: string) => names.get(uid) ?? "Ukjent";
  if (author.kind === "adult") return name(author.uid);
  return author.requestedBy ? `AI, bestilt av ${name(author.requestedBy)}` : "AI";
}

function useVersions(calId: string) {
  const [versions, setVersions] = useState<VersionDoc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setVersions([]);
    setLoaded(false);
    setError(null);
    return onSnapshot(
      query(collection(db, paths.calendar(calId), "versions"), orderBy("number", "desc")),
      (snap) => {
        setVersions(
          snap.docs.flatMap((d) => {
            const parsed = VersionDoc.safeParse(fromFirestore(d.data()));
            return parsed.success ? [parsed.data] : [];
          }),
        );
        setLoaded(true);
      },
      (e) => {
        console.error("versjonene", e);
        setError("Kunne ikke hente historikken.");
      },
    );
  }, [calId]);
  return { versions, loaded, error };
}

function useMemberNames(): Map<string, string> {
  const [names, setNames] = useState(new Map<string, string>());
  useEffect(
    () =>
      onSnapshot(
        collection(db, "members"),
        (snap) =>
          setNames(
            new Map(
              snap.docs.flatMap((d) => {
                const m = MemberDoc.safeParse(d.data());
                return m.success ? [[d.id, m.data.displayName] as const] : [];
              }),
            ),
          ),
        (e) => console.error("medlemmer", e),
      ),
    [],
  );
  return names;
}

/** «Historikk»: every version, who made it, a diff against the one before, and restore. */
export function HistoryPage() {
  const { calId = "" } = useParams();
  const { calendar, manuals, error } = useCalendar(calId);
  const { versions, loaded: versionsLoaded, error: versionsError } = useVersions(calId);
  const { pages } = usePages(calId);
  const names = useMemberNames();
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; ok: boolean } | null>(null);
  const inFlight = useRef(false);
  const { confirm, dialog } = useConfirm();

  const index = useMemo(
    () =>
      indexSteps(
        buildSteps(
          pages.map((p) => p.page),
          manuals,
        ),
      ),
    [pages, manuals],
  );
  const current = calendar?.currentVersion ?? null;

  async function restore(v: VersionDoc) {
    if (current === null || inFlight.current) return;
    if (!(await confirm(`Gjenopprette versjon ${v.number}? Det lager en ny versjon, og den gjeldende blir liggende i historikken.`, "Gjenopprett"))) return;
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const { data } = await restoreVersion({ calendarId: calId, baseVersion: current, fromVersion: v.number });
      setNotice({ message: `Gjenopprettet versjon ${v.number} som versjon ${data.version}.`, ok: true });
    } catch (e) {
      console.error("restoreVersion", e);
      setNotice({ message: callableError(e).message, ok: false });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  // Show why there is nothing to show (for example a denied read) instead of a blank page.
  if (!calendar) return error ? <p role="alert">{error}</p> : null;

  return (
    <section className="history">
      {dialog}
      {error && <p role="alert">{error}</p>}
      {versionsError && <p role="alert">{versionsError}</p>}
      <div>
        <h2 className="plan-title">Endringshistorikk</h2>
        <span className="muted small">
          Hver lagring blir en versjon. Gjenoppretting lager en ny versjon, så ingenting går tapt.
        </span>
      </div>
      {notice && (
        <div className={`banner ${notice.ok ? "run" : "err"}`} role={notice.ok ? "status" : "alert"}>
          <span>{notice.message}</span>
        </div>
      )}
      {versionsLoaded && versions.length === 0 && !versionsError && <p>Ingen versjoner ennå.</p>}
      <ol className="history-list">
        {versions.map((v, i) => {
          const isCurrent = v.number === current;
          const prev = versions[i + 1];
          const label = authorLabel(v.author, names);
          const diff = open === v.number && prev ? diffPlans(prev.plan, v.plan, index) : null;
          return (
            <li key={v.number} className={`history-row${isCurrent ? " current" : ""}`}>
              <div className="history-main">
                <strong>
                  Versjon {v.number}: {v.summary}
                </strong>
                <span className="muted small">
                  {label} · {formatTime(v.createdAt)}
                  {v.restoredFrom !== null && ` · Gjenopprettet fra versjon ${v.restoredFrom}`}
                </span>
              </div>
              {isCurrent && <span className="pill badge-ok">Gjeldende</span>}
              <div className="toolbar">
                {prev && (
                  <button aria-expanded={open === v.number} onClick={() => setOpen(open === v.number ? null : v.number)}>
                    Se endringen
                  </button>
                )}
                {!isCurrent && (
                  <button className="restore" disabled={busy || current === null} onClick={() => void restore(v)}>
                    Gjenopprett
                  </button>
                )}
              </div>
              {diff && (
                <div className="history-diff">
                  {diff.days.length === 0 && diff.added.length === 0 && diff.removed.length === 0 && (
                    <p>Ingen forskjell i fordelingen eller skjulte områder.</p>
                  )}
                  {diff.days.length > 0 && (
                    <ul>
                      {diff.days.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                  {diff.added.length > 0 && (
                    <p>Skjult: {diff.added.map((h) => `«${h.label}» (side ${h.page})`).join(", ")}</p>
                  )}
                  {diff.removed.length > 0 && (
                    <p>Vist igjen: {diff.removed.map((h) => `«${h.label}» (side ${h.page})`).join(", ")}</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
