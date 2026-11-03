import { Timestamp } from "firebase/firestore";

/** Recursively turns Firestore Timestamps into Dates so shared zod schemas (z.date()) can parse the data. */
export function fromFirestore(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate();
  if (Array.isArray(value)) return value.map(fromFirestore);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromFirestore(v)]));
  }
  return value;
}
