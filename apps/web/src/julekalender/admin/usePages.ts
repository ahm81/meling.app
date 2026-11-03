import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { PageDoc, paths } from "@meling/shared";
import { db } from "../../firebase";
import { fromFirestore } from "../../firestore";

export interface PageEntry {
  id: string;
  page: PageDoc;
}

/** Live view of a calendar's analysed pages (`pages/{manualId}_{page}`). */
export function usePages(calId: string): { pages: PageEntry[]; loaded: boolean; error: string | null } {
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setPages([]);
    setLoaded(false);
    setError(null);
    return onSnapshot(
      collection(db, paths.calendar(calId), "pages"),
      (snap) => {
        setPages(
          snap.docs.flatMap((d) => {
            const parsed = PageDoc.safeParse(fromFirestore(d.data()));
            return parsed.success ? [{ id: d.id, page: parsed.data }] : [];
          }),
        );
        setLoaded(true);
      },
      (e) => {
        console.error("sidene", e);
        setError("Kunne ikke hente sidene AI-en har lest.");
        setLoaded(true);
      },
    );
  }, [calId]);
  return { pages, loaded, error };
}
