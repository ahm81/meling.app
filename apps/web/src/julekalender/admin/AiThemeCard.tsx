import { useState } from "react";
import { DOOR_COUNT, isAiDoorImage, type CalendarDoc } from "@meling/shared";
import { ChildFrame, DAYS, doorFace } from "./Doors";
import { applyThemeDraft, generateTheme, regenerateDoor } from "./api";
import { useChoice } from "./useConfirm";
import { useDownloadUrls } from "./useCutouts";

const MAX_PROMPT = 500;

/** The message of a failed callable. A client timeout is no failure: the work goes on and the snapshot shows it. */
function callError(e: unknown, fallback: string): string | null {
  const code = (e as { code?: string }).code;
  if (code === "functions/deadline-exceeded") return null;
  console.error(e);
  return (e as { message?: string }).message || fallback;
}

/**
 * «Lag eget tema med AI»: an adult describes the child and gets a draft theme (colours and 24 door pictures).
 * Generation is fire-and-forget; progress and result come from `calendar.themeDraft` through the snapshot, so
 * the page can be closed and reopened meanwhile. The draft is only used on the calendar after «Bruk dette temaet».
 */
export function AiThemeCard({ calId, calendar }: { calId: string; calendar: CalendarDoc }) {
  const draft = calendar.themeDraft;
  const [prompt, setPrompt] = useState(draft?.prompt ?? calendar.customTheme?.prompt ?? "");
  const [starting, setStarting] = useState(false);
  const [regenerating, setRegenerating] = useState<ReadonlySet<number>>(new Set());
  const [applying, setApplying] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { choose, dialog } = useChoice<boolean>();

  const doors = draft?.doors ?? {};
  const doneCount = DAYS.filter((d) => doors[String(d)]?.status === "done").length;
  const running = draft?.status === "running";
  const urls = useDownloadUrls(DAYS.flatMap((d) => doors[String(d)]?.path ?? []));
  const uploaded = DAYS.filter((d) => {
    const path = calendar.doorImages[d];
    return path !== undefined && !isAiDoorImage(path);
  }).length;

  async function generate() {
    setFailure(null);
    setMessage(null);
    setStarting(true);
    try {
      await generateTheme({ calendarId: calId, prompt: prompt.trim() });
    } catch (e) {
      setFailure(callError(e, "Kunne ikke lage temaet. Prøv igjen."));
    } finally {
      setStarting(false);
    }
  }

  async function variant(day: number) {
    setFailure(null);
    setMessage(null);
    setRegenerating((s) => new Set(s).add(day));
    try {
      await regenerateDoor({ calendarId: calId, day });
    } catch (e) {
      setFailure(callError(e, "Kunne ikke lage en ny variant. Prøv igjen."));
    } finally {
      setRegenerating((s) => new Set([...s].filter((d) => d !== day)));
    }
  }

  async function apply() {
    setFailure(null);
    setMessage(null);
    let keepUploaded = false;
    if (uploaded > 0) {
      const choice = await choose(
        `${uploaded} luker har bilder du har lastet opp selv. Vil du erstatte dem med AI-bildene?`,
        [
          { label: "Erstatt alle 24", value: false },
          { label: "Behold mine", value: true },
        ],
      );
      if (choice === null) return;
      keepUploaded = choice;
    }
    setApplying(true);
    try {
      await applyThemeDraft({ calendarId: calId, keepUploaded });
      setMessage("Temaet er tatt i bruk.");
    } catch (e) {
      setFailure(callError(e, "Kunne ikke ta i bruk temaet. Prøv igjen."));
    } finally {
      setApplying(false);
    }
  }

  const canApply = draft?.status === "done" && doneCount === DOOR_COUNT && !applying;

  return (
    <div className="card">
      <h2>Lag eget tema med AI</h2>
      <p className="muted">
        Beskriv {calendar.childName}, så lager AI farger og et bilde til hver luke. Du kan se på forslaget og lage nye
        varianter før du tar det i bruk.
      </p>
      <textarea
        value={prompt}
        maxLength={MAX_PROMPT}
        rows={3}
        aria-label="Beskriv temaet"
        placeholder="For eksempel: LEGO-jul for Ida, 5 år, som liker katter og rosa"
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="toolbar">
        <button
          className="primary"
          disabled={running || starting || prompt.trim() === ""}
          onClick={() => void generate()}
        >
          {draft ? "Lag på nytt" : "Lag tema"}
        </button>
        {running && (
          <span role="status">
            Lager tema … {doneCount} av {DOOR_COUNT} bilder
          </span>
        )}
      </div>
      {draft?.status === "error" && <p role="alert">{draft.error}</p>}
      {failure && <p role="alert">{failure}</p>}
      {message && <p role="status">{message}</p>}
      {draft && (
        <>
          <ChildFrame theme="egen" colors={draft.colors}>
            <div className="doors">
              {DAYS.map((day) => {
                const door = doors[String(day)];
                const path = door?.path;
                const face = doorFace(path ? urls[path] : null);
                const pending = door?.status === "pending" || regenerating.has(day);
                return (
                  <div key={day} className="door-edit">
                    <div {...face} className={`${face.className}${pending ? " working" : ""}`}>
                      <span className="door-number">{day}</span>
                      {pending && <span className="door-done">Lager …</span>}
                    </div>
                    {door?.status === "error" && !pending && <span role="alert">{door.error}</span>}
                    <button
                      className="door-remove"
                      disabled={running || pending}
                      onClick={() => void variant(day)}
                      aria-label={`Ny variant av luke ${day}`}
                    >
                      Ny variant
                    </button>
                  </div>
                );
              })}
            </div>
          </ChildFrame>
          <div className="toolbar">
            <button className="primary" disabled={!canApply} onClick={() => void apply()}>
              Bruk dette temaet
            </button>
          </div>
        </>
      )}
      {dialog}
    </div>
  );
}
