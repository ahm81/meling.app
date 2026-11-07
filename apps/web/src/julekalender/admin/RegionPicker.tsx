import { useRef, useState, type PointerEvent } from "react";
import { Bbox, type Hidden } from "@meling/shared";
import { boxStyle, rectFromPoints } from "./plan-view";

export interface PickerPage {
  manualId: string;
  page: number;
  url: string | null;
  width: number;
  height: number;
  hidden: Hidden[];
}

interface Point {
  x: number;
  y: number;
}

/**
 * Drag a rectangle on a page image (mouse or touch) and name it. Gives a normalised box inside
 * the page; the caller turns it into a `hide` operation.
 */
export function RegionPicker({
  pages,
  busy,
  onCancel,
  onSubmit,
}: {
  pages: PickerPage[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (region: { manualId: string; page: number; bbox: Bbox; label: string }) => void;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const [label, setLabel] = useState("");
  const surface = useRef<HTMLDivElement>(null);

  const page = pages[Math.min(pageIndex, pages.length - 1)];
  const bbox = start && end ? rectFromPoints(start, end) : null;
  const valid = bbox !== null && Bbox.safeParse(bbox).success;
  const name = label.trim();

  function toPoint(e: PointerEvent): Point {
    const r = surface.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toPoint(e);
    setStart(p);
    setEnd(p);
    setDragging(true);
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    if (dragging) setEnd(toPoint(e));
  }

  function up(e: PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setEnd(toPoint(e));
    setDragging(false);
  }

  function choosePage(i: number) {
    setPageIndex(i);
    setStart(null);
    setEnd(null);
  }

  if (!page) return null;

  return (
    <form
      className="card region-picker"
      aria-label="Skjul et område"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && name && !busy) onSubmit({ manualId: page.manualId, page: page.page, bbox: bbox!, label: name });
      }}
    >
      <h3>Skjul et område</h3>
      <p className="muted">Dra et rektangel over det barnet ikke skal se, og gi det et navn.</p>
      {pages.length > 1 && (
        <div className="toolbar" role="group" aria-label="Velg side">
          {pages.map((p, i) => (
            <button
              key={`${p.manualId}_${p.page}`}
              type="button"
              aria-pressed={i === pageIndex}
              className={i === pageIndex ? "selected" : undefined}
              onClick={() => choosePage(i)}
            >
              Side {p.page}
            </button>
          ))}
        </div>
      )}
      <div
        ref={surface}
        className="page-figure picker-surface"
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDragging(false)}
      >
        {page.url ? <img src={page.url} alt={`Side ${page.page}`} draggable={false} /> : <span className="muted">Laster side …</span>}
        {page.hidden.map((h) => (
          <div key={h.id} className="overlay hidden-area" style={boxStyle(h.bbox ?? { x: 0, y: 0, w: 1, h: 1 })} />
        ))}
        {bbox && <div className="overlay picked" style={boxStyle(bbox)} />}
      </div>
      {start && end && !dragging && !bbox && <p className="manual-status err">Området er for lite. Dra et større rektangel.</p>}
      <label htmlFor="region-name">Navn på området</label>
      <input
        id="region-name"
        required
        maxLength={80}
        value={label}
        placeholder="For eksempel «ferdig modell»"
        onChange={(e) => setLabel(e.target.value)}
      />
      <div className="toolbar">
        <button type="submit" className="primary" disabled={!valid || !name || busy}>
          {busy ? "Skjuler …" : "Skjul området"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Avbryt
        </button>
      </div>
    </form>
  );
}
