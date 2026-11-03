import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { collection, doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { CalendarDoc, MemberDoc, calendarId, paths } from "@meling/shared";
import { db } from "../../firebase";
import { fromFirestore } from "../../firestore";
import { useCalendar, type Manual } from "./useCalendar";

const BADGE: Record<CalendarDoc["draft"], string> = {
  waiting: "badge-wait",
  running: "badge-run",
  done: "badge-ok",
  error: "badge-err",
};

export function draftLabel(c: CalendarDoc): string {
  switch (c.draft) {
    case "waiting":
      return "Venter på manualer";
    case "running":
      return "AI lager utkast …";
    case "done":
      return "Utkast klart";
    case "error":
      return `Feil: ${c.draftError ?? "ukjent feil"}`;
  }
}

export function manualSummary(manuals: Manual[]): string {
  if (manuals.length === 0) return "Ingen manualer";
  const noun = manuals.length === 1 ? "manual" : "manualer";
  const parts = [`${manuals.length} ${noun}`];
  const analyzing = manuals.filter((m) => m.status === "rendering" || m.status === "analyzing");
  const failed = manuals.filter((m) => m.status === "error").length;
  if (analyzing.length > 0) {
    const done = analyzing.reduce((n, m) => n + m.pagesAnalyzed, 0);
    const total = analyzing.reduce((n, m) => n + (m.pageCount ?? 0), 0);
    parts.push(`${analyzing.length} analyseres${total > 0 ? ` (${done}/${total} sider)` : ""}`);
  }
  if (failed > 0) parts.push(`${failed} med feil`);
  return parts.join(", ");
}

function CalendarCard({ calId }: { calId: string }) {
  const { calendar, manuals, loading } = useCalendar(calId);
  if (loading) return null;
  if (!calendar)
    return (
      <article className="card">
        <h2>Ugyldig kalender</h2>
        <p>Dokumentet «{calId}» kunne ikke leses.</p>
      </article>
    );
  const base = `/julekalender/admin/${calId}`;
  const sets = manuals.map((m) => m.setNumber).filter((s): s is string => !!s);
  return (
    <article className="card">
      <div className="card-head">
        <h2>{calendar.childName}</h2>
        <span className={`pill ${BADGE[calendar.draft]}`}>{draftLabel(calendar)}</span>
      </div>
      <dl>
        <div>
          <dt>Sett</dt>
          <dd>{sets.length > 0 ? sets.join(", ") : "–"}</dd>
        </div>
        <div>
          <dt>Manualer</dt>
          <dd>{manualSummary(manuals)}</dd>
        </div>
        <div>
          <dt>Versjon</dt>
          <dd>{calendar.currentVersion ?? "–"}</dd>
        </div>
      </dl>
      <div className="card-links">
        <Link to={`${base}/manualer`}>Manualer</Link>
        <Link to={`${base}/fordeling`}>Fordeling</Link>
        <Link to={`${base}/pakkeliste`}>Pakkeliste</Link>
        <Link to={`${base}/historikk`}>Historikk</Link>
      </div>
    </article>
  );
}

interface Child {
  uid: string;
  name: string;
}

export function Overview({ uid }: { uid: string }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [calendars, setCalendars] = useState<{ id: string; year: number }[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [creating, setCreating] = useState(false);
  const [childUid, setChildUid] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        collection(db, "julekalender"),
        (snap) => setCalendars(snap.docs.map((d) => ({ id: d.id, year: Number(d.data().year) }))),
        () => setLoadError("Kunne ikke hente kalendere."),
      ),
    [],
  );

  useEffect(
    () =>
      onSnapshot(
        collection(db, "members"),
        (snap) =>
          setChildren(
            snap.docs.flatMap((d) => {
              const parsed = MemberDoc.safeParse(d.data());
              return parsed.success && parsed.data.role === "child"
                ? [{ uid: d.id, name: parsed.data.displayName }]
                : [];
            }),
          ),
        () => setLoadError("Kunne ikke hente barn."),
      ),
    [],
  );

  const years = useMemo(
    () => [...new Set([thisYear, ...calendars.map((c) => c.year)])].sort((a, b) => b - a),
    [calendars, thisYear],
  );
  const shown = calendars.filter((c) => c.year === year).sort((a, b) => a.id.localeCompare(b.id));

  async function create() {
    const child = children.find((c) => c.uid === childUid);
    if (!child || busy) return;
    setBusy(true);
    setMessage(null);
    const id = calendarId(year, child.uid);
    try {
      if ((await getDoc(doc(db, paths.calendar(id)))).exists()) {
        setMessage(`${child.name} har allerede en julekalender for ${year}.`);
        return;
      }
      // The Firestore create rule accepts exactly this shape.
      const data = {
        year,
        childUid: child.uid,
        childName: child.name,
        wishes: { balance: "bricks", text: "" },
        currentVersion: null,
        draft: "waiting",
        draftError: null,
        createdBy: uid,
      };
      CalendarDoc.parse(fromFirestore(data));
      await setDoc(doc(db, paths.calendar(id)), data);
      setCreating(false);
      setChildUid("");
    } catch (error) {
      console.error(error);
      setMessage("Kunne ikke opprette kalenderen. Prøv igjen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin">
      <header className="admin-head row">
        <div>
          <span className="crumbs">
            <Link to="/">meling.app</Link> › Julekalender › Admin
          </span>
          <h1>Julekalender</h1>
        </div>
        <div className="toolbar">
          <label htmlFor="year">År</label>
          <select id="year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button className="primary" onClick={() => setCreating((v) => !v)}>
            Ny julekalender
          </button>
        </div>
      </header>

      {loadError && <p role="alert">{loadError}</p>}

      {creating && (
        <form className="card create" onSubmit={(e) => (e.preventDefault(), void create())}>
          <label htmlFor="child">Barn</label>
          <select id="child" value={childUid} onChange={(e) => setChildUid(e.target.value)}>
            <option value="">Velg barn …</option>
            {children.map((c) => (
              <option key={c.uid} value={c.uid}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="primary" type="submit" disabled={!childUid || busy}>
            Opprett for {year}
          </button>
          <button type="button" disabled={busy} onClick={() => setCreating(false)}>
            Avbryt
          </button>
        </form>
      )}
      {message && <p role="alert">{message}</p>}

      <div className="cards">
        {shown.map((c) => (
          <CalendarCard key={c.id} calId={c.id} />
        ))}
        {shown.length === 0 && <p>Ingen kalendere for {year} ennå.</p>}
      </div>
    </div>
  );
}
