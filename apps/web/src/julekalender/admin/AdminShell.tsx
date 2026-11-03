import { Link, NavLink, Outlet, useParams } from "react-router";
import { useCalendar } from "./useCalendar";

/** Gate for the admin routes: only adults get through. */
export function AdultOnly({ adult }: { adult: boolean }) {
  if (!adult) {
    return (
      <main>
        <p role="alert">Denne siden er bare for voksne.</p>
        <Link to="/">Til forsiden</Link>
      </main>
    );
  }
  return <Outlet />;
}

const tabs = [
  ["manualer", "Manualer"],
  ["fordeling", "Fordeling"],
  ["pakkeliste", "Pakkeliste"],
  ["historikk", "Historikk"],
] as const;

/** Frame around one calendar's admin pages. */
export function AdminShell() {
  const { calId = "" } = useParams();
  const { calendar, loading } = useCalendar(calId);

  return (
    <div className="admin">
      <header className="admin-head">
        <span className="crumbs">
          <Link to="/">meling.app</Link> › <Link to="/julekalender/admin">Julekalender</Link> › Admin
        </span>
        <h1>{calendar ? `${calendar.childName} ${calendar.year}` : "Julekalender"}</h1>
        <nav className="admin-tabs">
          {tabs.map(([to, label]) => (
            <NavLink key={to} to={`/julekalender/admin/${calId}/${to}`}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      {loading ? <p>Laster…</p> : calendar ? <Outlet /> : <p role="alert">Fant ikke kalenderen.</p>}
    </div>
  );
}

export function Placeholder({ title }: { title: string }) {
  return (
    <section>
      <h2>{title}</h2>
      <p>Kommer snart.</p>
    </section>
  );
}
