import { useEffect, useState } from "react";
import { getDownloadURL, ref } from "firebase/storage";
import { storage } from "../../firebase";
import { renderCutouts } from "./api";

// Download URLs never change for a path (cutout paths include the mask key), so they are cached for the session.
const urlCache = new Map<string, Promise<string>>();

function downloadUrl(path: string): Promise<string> {
  let url = urlCache.get(path);
  if (!url) {
    url = getDownloadURL(ref(storage, path));
    urlCache.set(path, url);
    // A failed lookup may succeed later (e.g. the file was just written), so it is not cached.
    url.catch(() => urlCache.delete(path));
  }
  return url;
}

/** Download URLs for Storage paths; a path maps to null while loading or if it failed. */
export function useDownloadUrls(paths: string[]): Record<string, string | null> {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const key = paths.join("\n");
  useEffect(() => {
    let live = true;
    for (const path of key ? key.split("\n") : []) {
      downloadUrl(path).then(
        (url) => live && setUrls((u) => (u[path] === url ? u : { ...u, [path]: url })),
        (e) => console.error("Fant ikke bildet", path, e),
      );
    }
    return () => {
      live = false;
    };
  }, [key]);
  return urls;
}

export interface CutoutState {
  /** stepId → Storage path, for `version`. */
  cutouts: Record<string, string>;
  version: number | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

const DEBOUNCE_MS = 1500;

/**
 * Runs renderCutouts for the calendar's current version (debounced, since each edit makes a new
 * version) and keeps the last result. Rendering can take tens of seconds the first time.
 */
export function useCutouts(calId: string, version: number | null): CutoutState {
  const [state, setState] = useState<Omit<CutoutState, "retry">>({
    cutouts: {},
    version: null,
    loading: false,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (version === null) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(() => {
      renderCutouts({ calendarId: calId, version }).then(
        ({ data }) => live && setState({ cutouts: data.cutouts, version, loading: false, error: null }),
        (e) => {
          console.error("renderCutouts", e);
          if (live) setState((s) => ({ ...s, loading: false, error: "Kunne ikke lage forhåndsvisningen." }));
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [calId, version, attempt]);

  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
