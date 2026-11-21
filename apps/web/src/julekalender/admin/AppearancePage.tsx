import { useState } from "react";
import { useParams } from "react-router";
import { deleteField, doc, updateDoc } from "firebase/firestore";
import { deleteObject, ref, uploadBytes } from "firebase/storage";
import { FIXED_THEMES, type Theme, paths, storagePaths } from "@meling/shared";
import { db, storage } from "../../firebase";
import { ChildFrame, DAYS, THEME_LABELS, doorFace } from "./Doors";
import { useCalendar } from "./useCalendar";
import { useDownloadUrls } from "./useCutouts";

const SIZE = 640;

/** The middle square of a picture as a JPEG of at most 640 px, so door pictures stay small and load fast. */
async function squareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const out = Math.min(SIZE, side);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no blob"))), "image/jpeg", 0.85),
    );
  } finally {
    bitmap.close();
  }
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** «Utseende»: the adults choose the calendar's theme and put pictures on its doors. */
export function AppearancePage() {
  const { calId = "" } = useParams();
  const { calendar, error } = useCalendar(calId);
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const urls = useDownloadUrls(Object.values(calendar?.doorImages ?? {}));

  if (!calendar) return error ? <p role="alert">{error}</p> : null;

  const calRef = doc(db, paths.calendar(calId));
  const images = calendar.doorImages;
  const empty = DAYS.filter((d) => !images[d]);

  // An old picture nobody points to any more; failing to delete it only leaves a stray file.
  const discard = (path: string | undefined) => {
    if (path) deleteObject(ref(storage, path)).catch((e) => console.error("Kunne ikke slette", path, e));
  };

  async function setTheme(theme: Theme) {
    setFailure(null);
    try {
      await updateDoc(calRef, { theme });
    } catch (e) {
      console.error(e);
      setFailure("Kunne ikke lagre temaet. Prøv igjen.");
    }
  }

  /** Puts `files[i]` on door `days[i]`. */
  async function upload(days: number[], files: File[]) {
    setFailure(null);
    setMessage(null);
    setBusy((b) => new Set([...b, ...days]));
    const saved: Record<string, string> = {};
    let failed = 0;
    for (const [i, day] of days.entries()) {
      try {
        const path = storagePaths.doorImage(calId, day, newId());
        await uploadBytes(ref(storage, path), await squareJpeg(files[i]!), {
          contentType: "image/jpeg",
        });
        saved[`doorImages.${day}`] = path;
      } catch (e) {
        console.error(e);
        failed++;
      }
    }
    try {
      if (Object.keys(saved).length > 0) {
        await updateDoc(calRef, saved);
        for (const day of days) if (saved[`doorImages.${day}`]) discard(images[day]);
      }
      if (failed > 0) {
        setFailure(
          failed === 1 && days.length === 1
            ? "Kunne ikke bruke bildet. Prøv et annet bilde (JPEG eller PNG)."
            : `${failed} av bildene kunne ikke brukes. Prøv dem på nytt som JPEG eller PNG.`,
        );
      }
    } catch (e) {
      console.error(e);
      Object.values(saved).forEach(discard);
      setFailure("Kunne ikke lagre bildene. Prøv igjen.");
    } finally {
      setBusy((b) => new Set([...b].filter((d) => !days.includes(d))));
    }
  }

  function uploadMany(files: File[]) {
    const days = empty.slice(0, files.length);
    void upload(days, files.slice(0, days.length)).then(() => {
      if (files.length > days.length) {
        setMessage(
          `Det var bare ${days.length} luker uten bilde, så ${files.length - days.length} bilder ble ikke brukt.`,
        );
      }
    });
  }

  async function remove(day: number) {
    setFailure(null);
    setMessage(null);
    try {
      await updateDoc(calRef, { [`doorImages.${day}`]: deleteField() });
      discard(images[day]);
    } catch (e) {
      console.error(e);
      setFailure("Kunne ikke fjerne bildet. Prøv igjen.");
    }
  }

  return (
    <section className="appearance">
      <div className="card">
        <h2>Tema</h2>
        <p className="muted">Fargene {calendar.childName} får på kalenderen sin.</p>
        <div className="theme-choices" role="radiogroup" aria-label="Tema">
          {FIXED_THEMES.map((theme) => (
            <label key={theme} className={`theme-choice${calendar.theme === theme ? " chosen" : ""}`}>
              <input
                type="radio"
                name="theme"
                checked={calendar.theme === theme}
                onChange={() => void setTheme(theme)}
              />
              <span className="child-frame theme-swatch" data-theme={theme} aria-hidden="true">
                {[1, 2, 3].map((d) => (
                  <span key={d} className="door">
                    <span className="door-number">{d}</span>
                  </span>
                ))}
              </span>
              <span>{THEME_LABELS[theme]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Bilder på lukene</h2>
        <p className="muted">
          Trykk på en luke for å velge bilde. Bildet beskjæres til et kvadrat fra midten. Luker uten bilde får temaets
          farge.
        </p>
        <div className="toolbar">
          <label className={`btn${empty.length === 0 ? " disabled" : ""}`}>
            Legg bilder på flere luker
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              disabled={empty.length === 0}
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                if (files.length > 0) uploadMany(files);
              }}
            />
          </label>
          <span className="muted">
            {empty.length === 0
              ? "Alle lukene har bilde."
              : `Bildene legges på lukene uten bilde, i rekkefølge fra luke ${empty[0]}.`}
          </span>
        </div>
        {failure && <p role="alert">{failure}</p>}
        {message && <p role="status">{message}</p>}
        <ChildFrame theme={calendar.theme}>
          <div className="doors">
            {DAYS.map((day) => {
              const path = images[day];
              const face = doorFace(path ? urls[path] : null);
              const working = busy.has(day);
              return (
                <div key={day} className="door-edit">
                  <label {...face} className={`${face.className}${working ? " working" : ""}`}>
                    <span className="door-number">{day}</span>
                    {working && <span className="door-done">Laster opp …</span>}
                    <input
                      type="file"
                      accept="image/*"
                      className="visually-hidden"
                      aria-label={path ? `Bytt bilde på luke ${day}` : `Velg bilde til luke ${day}`}
                      disabled={working}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void upload([day], [file]);
                      }}
                    />
                  </label>
                  {path && !working && (
                    <button
                      className="door-remove"
                      onClick={() => void remove(day)}
                      aria-label={`Fjern bildet på luke ${day}`}
                    >
                      Fjern
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </ChildFrame>
      </div>
    </section>
  );
}
