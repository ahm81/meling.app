import { useEffect, useRef, useState } from "react";
import {
  storagePaths,
  type BrickBag,
  type PlacedCallout,
} from "@meling/shared";
import { useDownloadUrls } from "./useCutouts";

const calloutPath = (calId: string, c: PlacedCallout) =>
  storagePaths.calloutImage(calId, c.manualId, c.page, c.index);

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
      <span className="brick-image">
        {url && <img src={url} alt="" loading="lazy" />}
      </span>
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
  fix,
}: {
  calId: string;
  bag: BrickBag;
  tick?: boolean;
  busy?: boolean;
  /** Takes the bricks placed by hand out of the bag again. */
  onRemove?: (elementId: string, qty: number) => void;
  /** Lets an adult say which brick an uncertain entry is (elementId null takes the answer back). */
  fix?: {
    choices: BrickChoices;
    onFix: (callouts: PlacedCallout[], elementId: string | null) => void;
  };
}) {
  const [picking, setPicking] = useState<PlacedCallout[] | null>(null);
  // The entries behind a line that have not been corrected yet (a sure match can still be wrong).
  const behind = (elementId: string) => bag.sure.filter((c) => c.elementId === elementId && !c.fixed);
  const urls = useDownloadUrls([
    ...bag.lines.map((l) => storagePaths.brickImage(calId, l.elementId)),
    ...bag.unsure.map((c) => calloutPath(calId, c)),
    ...(fix ? bag.fixed.map((c) => calloutPath(calId, c)) : []),
  ]);
  if (bag.lines.length === 0 && bag.unsure.length === 0)
    return <p className="muted">Ingen brikker.</p>;
  return (
    <>
      <ul className="part-list">
        {bag.lines.map((l) => (
          <BrickLine
            key={l.elementId}
            url={urls[storagePaths.brickImage(calId, l.elementId)]}
            elementId={l.elementId}
            note={
              l.extra > 0
                ? l.extra === l.qty
                  ? "lagt til for hånd"
                  : `${l.extra} lagt til for hånd`
                : undefined
            }
            tick={tick}
          >
            {fix && behind(l.elementId).length > 0 && (
            <button
              className="link-button no-print"
              disabled={busy}
              title="Feil brikke? Velg den riktige"
              onClick={() => setPicking(behind(l.elementId))}
            >
              Rett
            </button>
          )}
          {l.extra > 0 && onRemove && (
              <button
                className="link-button no-print"
                disabled={busy}
                onClick={() => onRemove(l.elementId, l.extra)}
              >
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
            {fix && (
              <button
                className="link-button no-print"
                disabled={busy}
                onClick={() => setPicking([c])}
              >
                Rett
              </button>
            )}
            <strong>{c.qty}×</strong>
          </BrickLine>
        ))}
        {fix &&
          bag.fixed.map((c) => (
            <li
              key={`fixed/${c.manualId}/${c.page}/${c.index}`}
              className="part-line fixed-line no-print"
            >
              <span className="brick-image">
                {urls[calloutPath(calId, c)] && (
                  <img
                    src={urls[calloutPath(calId, c)]!}
                    alt=""
                    loading="lazy"
                  />
                )}
              </span>
              <span className="part-name muted small">
                Side {c.page}: rettet til {c.elementId}
              </span>
              <button
                className="link-button"
                disabled={busy}
                onClick={() => fix.onFix([c], null)}
              >
                Angre
              </button>
            </li>
          ))}
      </ul>
      {fix && picking && (
        <BrickPicker
          calId={calId}
          callouts={picking}
          choices={fix.choices}
          onPick={(elementId) => {
            setPicking(null);
            // Choosing what a sure line already is changes nothing.
            const same = picking.every((c) => c.sure && c.elementId === elementId);
            if (elementId && !same) fix.onFix(picking, elementId);
          }}
        />
      )}
    </>
  );
}

/** The bricks an uncertain entry can be: those the bags are short of first, then the whole parts list. */
export interface BrickChoices {
  missing: string[];
  all: string[];
}

/** A dialog that asks which brick an uncertain parts box entry is. `onPick(null)` means cancelled. */
function BrickPicker({
  calId,
  callouts,
  choices,
  onPick,
}: {
  calId: string;
  /** The entries to correct together: at least one, all with the same current match. */
  callouts: PlacedCallout[];
  choices: BrickChoices;
  onPick: (elementId: string | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  const callout = callouts[0]!;
  const pagesText = [...new Set(callouts.map((c) => c.page))].join(", ");
  // Pictures of sure entries exist once the bricks have been read again; without one the head has no picture.
  const calloutUrl = useDownloadUrls([calloutPath(calId, callout)])[calloutPath(calId, callout)];
  const urls = useDownloadUrls(choices.all.map((id) => storagePaths.brickImage(calId, id)));
  const grid = (ids: string[]) => (
    <div className="brick-choices">
      {ids.map((id) => (
        <button key={id} className="brick-choice" onClick={() => onPick(id)}>
          <span className="brick-image">
            {urls[storagePaths.brickImage(calId, id)] && (
              <img
                src={urls[storagePaths.brickImage(calId, id)]!}
                alt=""
                loading="lazy"
              />
            )}
          </span>
          <span className="brick-id">{id}</span>
        </button>
      ))}
    </div>
  );
  return (
    // Escape fires "cancel"; treat it as Avbryt.
    <dialog
      ref={ref}
      className="confirm brick-picker"
      onCancel={(e) => (e.preventDefault(), onPick(null))}
    >
      <div className="brick-picker-head">
        <span className="brick-image large">
          {calloutUrl && <img src={calloutUrl} alt="" />}
        </span>
        <p>
          <strong>Hvilken brikke er dette?</strong>
          <br />
          <span className="muted small">
            Fra brikkeboksen på side {pagesText}. Appen mente {callout.elementId}.
            {callouts.length > 1 && ` Gjelder ${callouts.length} brikkebokser i denne posen.`}
          </span>
        </p>
      </div>
      <h4>Appens valg</h4>
      {grid([callout.elementId])}
      {choices.missing.length > 0 && (
        <>
          <h4>Mangler i posene</h4>
          {grid(choices.missing)}
        </>
      )}
      <h4>Alle brikker</h4>
      {grid(choices.all)}
      <div className="toolbar">
        <button onClick={() => onPick(null)}>Avbryt</button>
      </div>
    </dialog>
  );
}

export const bagCount = (bag: BrickBag) =>
  bag.lines.reduce((n, l) => n + l.qty, 0) +
  bag.unsure.reduce((n, c) => n + c.qty, 0);

export const bricksText = (n: number) =>
  `${n} ${n === 1 ? "brikke" : "brikker"}`;

/**
 * The bricks that are in no bag, as pictures to press: pressing one puts one of it in the bag at hand.
 * Shown next to the day's pages, so an adult can find the brick by its looks without the manual.
 */
export function UnplacedBricks({
  calId,
  bricks,
  busy,
  onPlace,
}: {
  calId: string;
  bricks: { elementId: string; left: number }[];
  busy?: boolean;
  onPlace: (elementId: string) => void;
}) {
  const urls = useDownloadUrls(bricks.map((b) => storagePaths.brickImage(calId, b.elementId)));
  return (
    <div className="brick-choices">
      {bricks.map((b) => (
        <button
          key={b.elementId}
          className="brick-choice"
          disabled={busy}
          title={`Legg én ${b.elementId} i denne posen`}
          onClick={() => onPlace(b.elementId)}
        >
          <span className="brick-image">
            {urls[storagePaths.brickImage(calId, b.elementId)] && (
              <img src={urls[storagePaths.brickImage(calId, b.elementId)]!} alt="" loading="lazy" />
            )}
          </span>
          <span className="brick-id">{b.elementId}</span>
          <span className="muted">{b.left} igjen</span>
        </button>
      ))}
    </div>
  );
}

/** The version summary for correcting (or taking back the correction of) parts box entries. */
export function fixSummary(callouts: PlacedCallout[], elementId: string | null): string {
  const pages = [...new Set(callouts.map((c) => c.page))].join(", ");
  const what = callouts.length === 1 ? "en brikke" : `${callouts.length} brikker`;
  return elementId ? `Rettet ${what} på side ${pages} til ${elementId}` : `Angret rettingen av ${what} på side ${pages}`;
}
