import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { CalendarDoc, ManualDoc, VersionDoc, paths } from "@meling/shared";
import { db } from "../../firebase";
import { fromFirestore } from "../../firestore";

export type Manual = ManualDoc & { id: string };

export interface CalendarState {
  calendar: CalendarDoc | null;
  manuals: Manual[];
  currentVersion: VersionDoc | null;
  loading: boolean;
  error: string | null;
}

function parseOrNull<T>(schema: { parse(v: unknown): T }, data: unknown): T | null {
  try {
    return schema.parse(fromFirestore(data));
  } catch (error) {
    console.error("Ugyldig dokument", error);
    return null;
  }
}

/** Live view of one calendar: the doc, its manuals and the current plan version. */
export function useCalendar(calId: string): CalendarState {
  const [calendar, setCalendar] = useState<CalendarDoc | null>(null);
  const [calendarLoaded, setCalendarLoaded] = useState(false);
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [version, setVersion] = useState<VersionDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentNumber = calendar?.currentVersion ?? null;

  useEffect(() => {
    setCalendar(null);
    setCalendarLoaded(false);
    setManuals([]);
    setError(null);
    const fail = (what: string) => (e: Error) => {
      console.error(what, e);
      setError(`Kunne ikke hente ${what}.`);
    };
    const offCalendar = onSnapshot(
      doc(db, paths.calendar(calId)),
      (snap) => {
        setCalendar(snap.exists() ? parseOrNull(CalendarDoc, snap.data()) : null);
        setCalendarLoaded(true);
      },
      (e) => {
        fail("kalenderen")(e);
        setCalendarLoaded(true);
      },
    );
    const offManuals = onSnapshot(
      query(collection(db, paths.calendar(calId), "manuals"), orderBy("order")),
      (snap) =>
        setManuals(
          snap.docs.flatMap((d) => {
            const m = parseOrNull(ManualDoc, d.data());
            return m ? [{ ...m, id: d.id }] : [];
          }),
        ),
      fail("manualene"),
    );
    return () => {
      offCalendar();
      offManuals();
    };
  }, [calId]);

  useEffect(() => {
    setVersion(null);
    if (currentNumber === null) return;
    return onSnapshot(doc(db, paths.version(calId, currentNumber)), (snap) =>
      setVersion(snap.exists() ? parseOrNull(VersionDoc, snap.data()) : null),
    (e) => {
      console.error("versjonen", e);
      setError("Kunne ikke hente versjonen.");
    });
  }, [calId, currentNumber]);

  return {
    calendar,
    manuals,
    currentVersion: currentNumber === null ? null : version,
    loading: !calendarLoaded,
    error,
  };
}
