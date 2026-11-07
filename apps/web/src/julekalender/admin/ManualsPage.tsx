import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useParams } from "react-router";
import { collection, doc, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { ref, uploadBytesResumable } from "firebase/storage";
import { Wishes, paths, storagePaths } from "@meling/shared";
import { db, storage } from "../../firebase";
import { deleteManual, redraft, retryManual } from "./api";
import { REDRAFT_CONFIRM, callableError, manualName, manualsChangedSincePlan, reorderedManuals } from "./plan-view";
import { usePages } from "./usePages";
import { useCalendar, type Manual } from "./useCalendar";

const MAX_BYTES = 50 * 1024 * 1024;
const STALE_MS = 15 * 60 * 1000;

const STEPS = ["Last opp", "AI leser manualene", "Forslag", "Godkjenn"];

interface Upload {
  key: string;
  name: string;
  percent: number;
  error: string | null;
  done: boolean;
}

function isStale(updatedAt: Date | undefined, now: number): boolean {
  return !!updatedAt && now - updatedAt.getTime() > STALE_MS;
}

function validate(file: File): string | null {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return "Bare PDF-filer støttes.";
  if (file.size >= MAX_BYTES) return "Filen er for stor (maks 50 MB).";
  return null;
}

function ManualRow({
  manual,
  now,
  onRetry,
  retrying,
  onDelete,
  deleting,
  onUp,
  onDown,
  rowError,
}: {
  manual: Manual;
  now: number;
  onRetry: () => void;
  retrying: boolean;
  onDelete: () => void;
  deleting: boolean;
  /** Null when the manual cannot move that way (first or last, or a reorder is in progress). */
  onUp: (() => void) | null;
  onDown: (() => void) | null;
  rowError: string | null;
}) {
  const processing = manual.status === "rendering" || manual.status === "analyzing";
  const stale = processing && isStale(manual.updatedAt, now);
  const canRetry = manual.status === "error" || stale;
  // The function refuses while the AI is reading, unless the manual is stuck.
  const canDelete = !processing || stale;
  let status: string;
  let tone = "";
  switch (manual.status) {
    case "uploaded":
      status = "Lastet opp, venter på AI";
      break;
    case "rendering":
      status = "Gjør klar sidene …";
      break;
    case "analyzing":
      status = `AI leser side ${manual.pagesAnalyzed} av ${manual.pageCount ?? "?"}`;
      break;
    case "done":
      status = "Lest";
      tone = "ok";
      break;
    case "error":
      status = manual.error ?? "Ukjent feil";
      tone = "err";
      break;
  }
  const showBar = manual.status === "analyzing" || manual.status === "done";
  const percent =
    manual.status === "done" ? 100 : manual.pageCount ? Math.round((manual.pagesAnalyzed / manual.pageCount) * 100) : 0;
  return (
    <li className="manual-row">
      <div className="manual-main">
        <strong>
          {manual.order}. {manualName(manual)}
        </strong>
        <span className={`manual-status ${tone}`} role={tone === "err" ? "alert" : undefined}>
          {status}
        </span>
        {stale && <span className="manual-status err">Ser ut til å ha stoppet.</span>}
        {showBar && <progress max={100} value={percent} aria-label="Fremdrift" />}
        {rowError && (
          <span className="manual-status err" role="alert">
            {rowError}
          </span>
        )}
      </div>
      <div className="manual-actions">
        <button onClick={onUp ?? undefined} disabled={!onUp} aria-label={`Flytt ${manualName(manual)} opp`} title="Flytt opp">
          ↑
        </button>
        <button onClick={onDown ?? undefined} disabled={!onDown} aria-label={`Flytt ${manualName(manual)} ned`} title="Flytt ned">
          ↓
        </button>
        {canRetry && (
          <button onClick={onRetry} disabled={retrying || deleting}>
            {retrying ? "Prøver …" : "Prøv igjen"}
          </button>
        )}
        {canDelete && (
          <button onClick={onDelete} disabled={deleting || retrying}>
            {deleting ? "Sletter …" : "Slett"}
          </button>
        )}
      </div>
    </li>
  );
}

export function ManualsPage() {
  const { calId = "" } = useParams();
  // A new calendar starts with fresh state (uploads, wishes form, order counter).
  return <CalendarManuals key={calId} calId={calId} />;
}

function CalendarManuals({ calId }: { calId: string }) {
  const { calendar, manuals, currentVersion, error } = useCalendar(calId);
  const { pages, error: pagesError } = usePages(calId);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [reordering, setReordering] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const reorderingRef = useRef(false);
  const deletingRef = useRef(new Set<string>());
  const redraftingRef = useRef(false);
  const [redrafting, setRedrafting] = useState(false);
  const [redraftError, setRedraftError] = useState<string | null>(null);
  const [balance, setBalance] = useState<Wishes["balance"]>("bricks");
  const [text, setText] = useState("");
  const [wishesLoaded, setWishesLoaded] = useState(false);
  const [wishesState, setWishesState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const manualsRef = useRef<Manual[]>([]);
  const lastOrder = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  manualsRef.current = manuals;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (calendar && !wishesLoaded) {
      setBalance(calendar.wishes.balance);
      setText(calendar.wishes.text);
      setWishesLoaded(true);
    }
  }, [calendar, wishesLoaded]);

  const findings = useMemo(() => {
    const byId = new Map(manuals.map((m) => [m.id, m]));
    let steps = 0;
    let twoStepPages = 0;
    const hiddenList: { key: string; manual: string; page: number; label: string }[] = [];
    for (const { id, page } of pages) {
      const a = page.analysis;
      if (!a) continue;
      const manual = byId.get(page.manualId);
      const name = manual ? manualName(manual) : "Ukjent manual";
      steps += a.steps.length;
      if (a.steps.length === 2) twoStepPages += 1;
      if (a.kind === "cover" || a.kind === "inventory" || a.kind === "other") {
        const label = a.kind === "cover" ? "Forside" : a.kind === "inventory" ? "Delliste" : "Annen side";
        hiddenList.push({ key: `${id}:page`, manual: name, page: page.page, label: `${label} (hel side)` });
      }
      a.spoilers.forEach((s, i) =>
        hiddenList.push({ key: `${id}:${i}`, manual: name, page: page.page, label: s.label || "Spoiler" }),
      );
    }
    hiddenList.sort((x, y) => x.manual.localeCompare(y.manual) || x.page - y.page);
    return { steps, twoStepPages, hiddenList };
  }, [pages, manuals]);

  async function uploadOne(file: File, key: string) {
    const patch = (p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)));
    try {
      // Auto-id first: it is part of the storage path, and the doc is created only after the upload.
      const manualRef = doc(collection(db, paths.calendar(calId), "manuals"));
      const path = storagePaths.manualPdf(calId, manualRef.id);
      const task = uploadBytesResumable(ref(storage, path), file, { contentType: "application/pdf" });
      await new Promise<void>((resolve, reject) => {
        task.on(
          "state_changed",
          (s) => patch({ percent: Math.round((s.bytesTransferred / s.totalBytes) * 100) }),
          reject,
          () => resolve(),
        );
      });
      const max = Math.max(0, lastOrder.current, ...manualsRef.current.map((m) => m.order));
      const order = max + 1;
      lastOrder.current = order;
      await setDoc(doc(db, paths.manual(calId, manualRef.id)), {
        order,
        fileName: file.name,
        storagePath: path,
        status: "uploaded",
        pageCount: null,
        pagesAnalyzed: 0,
        setNumber: null,
        error: null,
      });
      patch({ percent: 100, done: true });
    } catch (e) {
      console.error(e);
      patch({ error: "Opplastingen feilet. Prøv igjen." });
    }
  }

  function addFiles(list: FileList | File[]) {
    const errors: string[] = [];
    const accepted: { file: File; key: string }[] = [];
    for (const file of Array.from(list)) {
      const problem = validate(file);
      if (problem) errors.push(`${file.name}: ${problem}`);
      else accepted.push({ file, key: `${Date.now()}-${Math.random().toString(36).slice(2)}` });
    }
    setFileErrors(errors);
    if (accepted.length === 0) return;
    setUploads((u) => [
      ...u.filter((x) => !x.done),
      ...accepted.map(({ file, key }) => ({ key, name: file.name, percent: 0, error: null, done: false })),
    ]);
    // One at a time keeps the order numbers in the order the files were chosen.
    for (const { file, key } of accepted) {
      queue.current = queue.current.then(() => uploadOne(file, key));
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  async function retry(m: Manual) {
    setRetrying((r) => ({ ...r, [m.id]: true }));
    setRowErrors((r) => ({ ...r, [m.id]: "" }));
    // Progress arrives through Firestore snapshots; the reply can take many minutes.
    retryManual({ calendarId: calId, manualId: m.id })
      .catch((e) => {
        console.error(e);
        setRowErrors((r) => ({ ...r, [m.id]: "Kunne ikke starte på nytt. Prøv igjen om litt." }));
      })
      .finally(() => setRetrying((r) => ({ ...r, [m.id]: false })));
  }

  function remove(m: Manual) {
    if (deletingRef.current.has(m.id)) return;
    if (!window.confirm(`Slette ${manualName(m)}? Sidene og utklippene fra manualen slettes også.`)) return;
    deletingRef.current.add(m.id);
    setDeleting((d) => ({ ...d, [m.id]: true }));
    setRowErrors((r) => ({ ...r, [m.id]: "" }));
    // The row disappears through the manuals snapshot.
    deleteManual({ calendarId: calId, manualId: m.id })
      .catch((e) => {
        console.error(e);
        setRowErrors((r) => ({ ...r, [m.id]: callableError(e).message }));
      })
      .finally(() => {
        deletingRef.current.delete(m.id);
        setDeleting((d) => ({ ...d, [m.id]: false }));
      });
  }

  async function move(index: number, dir: -1 | 1) {
    if (reorderingRef.current) return;
    const changes = reorderedManuals(manuals, index, dir);
    if (changes.length === 0) return;
    reorderingRef.current = true;
    setReordering(true);
    setOrderError(null);
    try {
      const batch = writeBatch(db);
      for (const { id, order } of changes) batch.update(doc(db, paths.manual(calId, id)), { order });
      await batch.commit();
    } catch (e) {
      console.error(e);
      setOrderError("Kunne ikke endre rekkefølgen. Prøv igjen.");
    } finally {
      reorderingRef.current = false;
      setReordering(false);
    }
  }

  function startRedraft() {
    if (!calendar || redraftingRef.current) return;
    const ok = window.confirm(
      calendar.currentVersion !== null
        ? REDRAFT_CONFIRM
        : "AI-en beregner det den skjuler for barnet på nytt. Eventuelle endringer du har gjort i hva som skjules, kan gå tapt. Vil du fortsette?",
    );
    if (!ok) return;
    redraftingRef.current = true;
    setRedrafting(true);
    setRedraftError(null);
    redraft({ calendarId: calId, baseVersion: calendar.currentVersion })
      .catch((e) => {
        console.error(e);
        setRedraftError("Kunne ikke lage nytt utkast. Prøv igjen om litt.");
      })
      .finally(() => {
        redraftingRef.current = false;
        setRedrafting(false);
      });
  }

  async function saveWishes() {
    setWishesState("saving");
    try {
      const wishes = Wishes.parse({ balance, text });
      await updateDoc(doc(db, paths.calendar(calId)), { wishes });
      setWishesState("saved");
    } catch (e) {
      console.error(e);
      setWishesState("error");
    }
  }

  // Show why there is nothing to show (for example a denied read) instead of a blank page.
  if (!calendar) return error ? <p role="alert">{error}</p> : null;

  const hasPlan = calendar.currentVersion !== null;
  const draftStale = calendar.draft === "running" && isStale(calendar.draftUpdatedAt, now);
  const anyAnalysis = manuals.some((m) => m.status !== "uploaded") || pages.length > 0;
  const activeStep = hasPlan || calendar.draft === "done" ? 2 : manuals.length > 0 ? 1 : 0;
  const busyUploading = uploads.some((u) => !u.done && !u.error);
  const manualsChanged = hasPlan && currentVersion !== null && manualsChangedSincePlan(currentVersion.plan, manuals);
  const allRead = manuals.length > 0 && manuals.every((m) => m.status === "done");

  return (
    <section className="manuals">
      {error && <p role="alert">{error}</p>}

      <ol className="stepper" aria-label="Fremgang">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={i === 3 ? "future" : i < activeStep ? "past" : i === activeStep ? "current" : "future"}
            aria-current={i === activeStep ? "step" : undefined}
          >
            <span className="dot">{i + 1}</span> {label}
          </li>
        ))}
      </ol>

      {calendar.draft === "running" && (
        <div className="banner run" role="status">
          <span>{draftStale ? "Utkastet ser ut til å ha stoppet." : "AI-en lager første utkast …"}</span>
          {draftStale && (
            <button onClick={startRedraft} disabled={redrafting}>
              Lag utkast på nytt
            </button>
          )}
        </div>
      )}
      {calendar.draft === "done" && (
        <div className="banner ok" role="status">
          <span>Førsteutkast klart</span>
          <Link className="btn primary" to={`/julekalender/admin/${calId}/fordeling`}>
            Se fordelingen
          </Link>
        </div>
      )}
      {calendar.draft === "error" && (
        <div className="banner err" role="alert">
          <span>Utkastet feilet: {calendar.draftError ?? "ukjent feil"}</span>
          <button onClick={startRedraft} disabled={redrafting}>
            Lag utkast på nytt
          </button>
        </div>
      )}
      {manualsChanged && calendar.draft !== "running" && (
        <div className="banner run" role="status">
          <span>
            Manualene er endret siden fordelingen ble laget.
            {!allRead && " Vent til AI-en har lest alle manualene."}
          </span>
          <button onClick={startRedraft} disabled={redrafting || !allRead}>
            {redrafting ? "Lager utkast …" : "Lag nytt utkast"}
          </button>
        </div>
      )}
      {redraftError && <p role="alert">{redraftError}</p>}

      <div className="card">
        <h2>Manualer</h2>
        <div
          className={`dropzone${dragging ? " over" : ""}`}
          onDragOver={(e) => (e.preventDefault(), setDragging(true))}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p>Slipp PDF-manualer her</p>
          <label className="btn primary-label" htmlFor="pdf-input">
            Velg PDF-filer
          </label>
          <input
            id="pdf-input"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <small>Kun PDF, under 50 MB per fil.</small>
        </div>
        {fileErrors.map((m) => (
          <p key={m} role="alert" className="manual-status err">
            {m}
          </p>
        ))}
        {uploads.length > 0 && (
          <ul className="manual-list">
            {uploads.map((u) => (
              <li key={u.key} className="manual-row">
                <div className="manual-main">
                  <strong>{u.name}</strong>
                  {u.error ? (
                    <span className="manual-status err" role="alert">
                      {u.error}
                    </span>
                  ) : u.done ? (
                    <span className="manual-status ok">Lastet opp</span>
                  ) : (
                    <>
                      <span className="manual-status">Laster opp … {u.percent} %</span>
                      <progress max={100} value={u.percent} aria-label="Opplasting" />
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {busyUploading && <small>Ikke lukk siden før opplastingen er ferdig.</small>}

        {orderError && (
          <p role="alert" className="manual-status err">
            {orderError}
          </p>
        )}
        {manuals.length > 0 ? (
          <ul className="manual-list">
            {manuals.map((m, i) => (
              <ManualRow
                key={m.id}
                manual={m}
                now={now}
                retrying={!!retrying[m.id]}
                onRetry={() => void retry(m)}
                deleting={!!deleting[m.id]}
                onDelete={() => remove(m)}
                onUp={i > 0 && !reordering ? () => void move(i, -1) : null}
                onDown={i < manuals.length - 1 && !reordering ? () => void move(i, 1) : null}
                rowError={rowErrors[m.id] || null}
              />
            ))}
          </ul>
        ) : (
          <p className="muted">Ingen manualer ennå.</p>
        )}
      </div>

      <div className="card">
        <h2>Ønsker til fordelingen</h2>
        <label htmlFor="balance">Balanse</label>
        <select
          id="balance"
          value={balance}
          onChange={(e) => (setBalance(e.target.value as Wishes["balance"]), setWishesState("idle"))}
        >
          <option value="bricks">Jevnt antall brikker</option>
          <option value="steps">Jevnt antall trinn</option>
        </select>
        <label htmlFor="wish-text">Andre ønsker</label>
        <textarea
          id="wish-text"
          rows={4}
          maxLength={1000}
          value={text}
          onChange={(e) => (setText(e.target.value), setWishesState("idle"))}
        />
        <div className="toolbar">
          <button className="primary" onClick={() => void saveWishes()} disabled={wishesState === "saving"}>
            Lagre ønsker
          </button>
          {wishesState === "saved" && <span role="status">Lagret</span>}
          {wishesState === "error" && <span role="alert">Kunne ikke lagre. Prøv igjen.</span>}
        </div>
      </div>

      {pagesError && <p role="alert">{pagesError}</p>}
      {anyAnalysis && (
        <div className="cards">
          <div className="card">
            <h2>Dette har AI-en funnet</h2>
            <dl>
              <div>
                <dt>Trinn</dt>
                <dd>{findings.steps}</dd>
              </div>
              <div>
                <dt>Sider med to trinn</dt>
                <dd>{findings.twoStepPages}</dd>
              </div>
            </dl>
          </div>
          <div className="card">
            <h2>Skjules for barnet</h2>
            {findings.hiddenList.length === 0 ? (
              <p className="muted">Ingenting skjules så langt.</p>
            ) : (
              <ul className="hidden-list">
                {findings.hiddenList.map((h) => (
                  <li key={h.key}>
                    {h.label}
                    <span className="muted">
                      {" "}
                      – {h.manual}, side {h.page}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
