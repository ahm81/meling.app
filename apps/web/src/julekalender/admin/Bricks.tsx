import { storagePaths, type BrickBag, type PlacedCallout } from "@meling/shared";
import { useDownloadUrls } from "./useCutouts";

const calloutPath = (calId: string, c: PlacedCallout) => storagePaths.calloutImage(calId, c.manualId, c.page, c.index);

/** One brick: its picture from the manual, its element id and a count (or other trailing text). */
export function BrickLine({
  url,
  elementId,
  note,
  tick,
  children,
}: {
  url: string | null | undefined;
  elementId: string;
  note?: string;
  /** Show an empty box to tick off on paper. */
  tick?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="part-line brick-line">
      {tick && <span className="tick" aria-hidden="true" />}
      <span className="brick-image">{url && <img src={url} alt="" loading="lazy" />}</span>
      <span className="part-name">
        <span className="brick-id">{elementId}</span>
        {note && <span className="muted small"> {note}</span>}
      </span>
      {children}
    </li>
  );
}

/** The bricks of one bag: sure matches per element id, then the uncertain ones with the step's own picture. */
export function BrickBagList({
  calId,
  bag,
  tick,
  busy,
  onRemove,
}: {
  calId: string;
  bag: BrickBag;
  tick?: boolean;
  busy?: boolean;
  /** Takes the bricks placed by hand out of the bag again. */
  onRemove?: (elementId: string, qty: number) => void;
}) {
  const urls = useDownloadUrls([
    ...bag.lines.map((l) => storagePaths.brickImage(calId, l.elementId)),
    ...bag.unsure.map((c) => calloutPath(calId, c)),
  ]);
  if (bag.lines.length === 0 && bag.unsure.length === 0) return <p className="muted">Ingen brikker.</p>;
  return (
    <ul className="part-list">
      {bag.lines.map((l) => (
        <BrickLine
          key={l.elementId}
          url={urls[storagePaths.brickImage(calId, l.elementId)]}
          elementId={l.elementId}
          note={l.extra > 0 ? (l.extra === l.qty ? "lagt til for hånd" : `${l.extra} lagt til for hånd`) : undefined}
          tick={tick}
        >
          {l.extra > 0 && onRemove && (
            <button className="link-button no-print" disabled={busy} onClick={() => onRemove(l.elementId, l.extra)}>
              Fjern
            </button>
          )}
          <strong>{l.qty}×</strong>
        </BrickLine>
      ))}
      {bag.unsure.map((c) => (
        <BrickLine
          key={`${c.manualId}/${c.page}/${c.index}`}
          url={urls[calloutPath(calId, c)]}
          elementId={`${c.elementId}?`}
          note={`usikker, se side ${c.page}`}
          tick={tick}
        >
          <strong>{c.qty}×</strong>
        </BrickLine>
      ))}
    </ul>
  );
}

export const bagCount = (bag: BrickBag) =>
  bag.lines.reduce((n, l) => n + l.qty, 0) + bag.unsure.reduce((n, c) => n + c.qty, 0);

export const bricksText = (n: number) => `${n} ${n === 1 ? "brikke" : "brikker"}`;
