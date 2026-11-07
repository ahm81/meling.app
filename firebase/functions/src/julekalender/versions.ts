import { Plan, VersionAuthor, paths } from "@meling/shared";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

export class StaleVersionError extends Error {
  constructor() {
    super("Kalenderen er endret av noen andre. Last siden på nytt.");
    this.name = "StaleVersionError";
  }
}

export type VersionInput = {
  baseVersion: number | null;
  author: VersionAuthor;
  summary: string;
  plan: Plan;
  restoredFrom?: number;
};

/**
 * Writes the next version and points the calendar at it, in one transaction.
 * Fails with StaleVersionError unless the calendar is still at `baseVersion`.
 * createdAt is a server timestamp; readers convert it to a Date (VersionDoc).
 */
export async function writeVersion(db: Firestore, calId: string, input: VersionInput): Promise<number> {
  const author = VersionAuthor.parse(input.author);
  const plan = Plan.parse(input.plan);
  if (input.summary.length > 200) throw new Error("Oppsummeringen er for lang.");
  const calRef = db.doc(paths.calendar(calId));
  return db.runTransaction(async (tx) => {
    const cal = await tx.get(calRef);
    if (!cal.exists) throw new Error("Fant ikke kalenderen.");
    const current = (cal.get("currentVersion") as number | null | undefined) ?? null;
    if (current !== input.baseVersion) throw new StaleVersionError();
    const number = (current ?? 0) + 1;
    tx.create(db.doc(paths.version(calId, number)), {
      number,
      createdAt: FieldValue.serverTimestamp(),
      author,
      summary: input.summary,
      plan,
      restoredFrom: input.restoredFrom ?? null,
    });
    tx.update(calRef, { currentVersion: number });
    return number;
  });
}
