import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { paths } from "@meling/shared";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-meling",
    firestore: {
      rules: readFileSync(fileURLToPath(new URL("../firestore.rules", import.meta.url)), "utf8"),
    },
  });
});

afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), paths.member("amund")), {
      displayName: "Amund",
      email: "amund@example.com",
      role: "adult",
    });
    await setDoc(doc(ctx.firestore(), paths.member("ida")), {
      displayName: "Ida",
      email: "ida@example.com",
      role: "child",
    });
  });
});

describe("members", () => {
  it("lets members read the member list", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertSucceeds(getDoc(doc(db, paths.member("amund"))));
  });

  it("denies signed-in users who are not members", async () => {
    const db = env.authenticatedContext("stranger").firestore();
    await assertFails(getDoc(doc(db, paths.member("amund"))));
  });

  it("denies unauthenticated users", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, paths.member("amund"))));
  });

  it("denies adding yourself as a member", async () => {
    const db = env.authenticatedContext("stranger").firestore();
    await assertFails(setDoc(doc(db, paths.member("stranger")), { displayName: "X", email: "x@example.com", role: "adult" }));
  });

  it("lets a member change their own display name", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertSucceeds(updateDoc(doc(db, paths.member("amund")), { displayName: "Amund M." }));
  });

  it("denies a member changing their email", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertFails(updateDoc(doc(db, paths.member("amund")), { email: "other@example.com" }));
  });

  it("denies a member changing their own role", async () => {
    const db = env.authenticatedContext("ida").firestore();
    await assertFails(updateDoc(doc(db, paths.member("ida")), { role: "adult" }));
  });
});

describe("julekalender", () => {
  const newCalendar = (createdBy: string) => ({
    year: 2026,
    childUid: "julian",
    childName: "Julian",
    wishes: { balance: "bricks", text: "" },
    currentVersion: null,
    draft: "waiting",
    draftError: null,
    createdBy,
  });
  const newManual = (status: string, manualId = "m1") => ({
    order: 1,
    fileName: "set.pdf",
    storagePath: `julekalender/2026-ida/manuals/${manualId}.pdf`,
    status,
    pageCount: null,
    pagesAnalyzed: 0,
    setNumber: null,
    error: null,
  });

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, paths.calendar("2026-ida")), { ...newCalendar("amund"), childUid: "ida", childName: "Ida" });
      await setDoc(doc(db, paths.manual("2026-ida", "m1")), newManual("uploaded"));
      await setDoc(doc(db, paths.page("2026-ida", "m1", 1)), { manualId: "m1", page: 1 });
      await setDoc(doc(db, paths.version("2026-ida", 1)), { n: 1 });
    });
  });

  it("adults read calendars", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertSucceeds(getDoc(doc(db, paths.calendar("2026-ida"))));
    await assertSucceeds(getDoc(doc(db, paths.manual("2026-ida", "m1"))));
    await assertSucceeds(getDoc(doc(db, paths.page("2026-ida", "m1", 1))));
    await assertSucceeds(getDoc(doc(db, paths.version("2026-ida", 1))));
  });

  it("children cannot read calendars", async () => {
    const db = env.authenticatedContext("ida").firestore();
    await assertFails(getDoc(doc(db, paths.calendar("2026-ida"))));
    await assertFails(getDoc(doc(db, paths.manual("2026-ida", "m1"))));
    await assertFails(getDoc(doc(db, paths.version("2026-ida", 1))));
  });

  it("non-members cannot read calendars", async () => {
    const db = env.authenticatedContext("stranger").firestore();
    await assertFails(getDoc(doc(db, paths.calendar("2026-ida"))));
  });

  it("adults create a calendar in waiting state", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertSucceeds(setDoc(doc(db, paths.calendar("2026-julian")), newCalendar("amund")));
  });

  it("denies creating a calendar with an extra key", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertFails(setDoc(doc(db, paths.calendar("2026-julian")), { ...newCalendar("amund"), extra: 1 }));
  });

  it("denies creating a calendar with a missing key", async () => {
    const db = env.authenticatedContext("amund").firestore();
    const { draftError: _omit, ...rest } = newCalendar("amund");
    await assertFails(setDoc(doc(db, paths.calendar("2026-julian")), rest));
  });

  it("denies creating a calendar with the wrong createdBy", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertFails(setDoc(doc(db, paths.calendar("2026-julian")), newCalendar("someone-else")));
  });

  it("denies creating a calendar with a non-null currentVersion", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertFails(setDoc(doc(db, paths.calendar("2026-julian")), { ...newCalendar("amund"), currentVersion: 3 }));
  });

  it("denies creating a calendar that is not waiting", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertFails(setDoc(doc(db, paths.calendar("2026-julian")), { ...newCalendar("amund"), draft: "done" }));
  });

  it("denies children and non-members creating calendars", async () => {
    await assertFails(
      setDoc(doc(env.authenticatedContext("ida").firestore(), paths.calendar("2026-julian")), newCalendar("ida")),
    );
    await assertFails(
      setDoc(doc(env.authenticatedContext("stranger").firestore(), paths.calendar("2026-julian")), newCalendar("stranger")),
    );
  });

  it("adults may change wishes and childName", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertSucceeds(
      updateDoc(doc(db, paths.calendar("2026-ida")), { wishes: { balance: "steps", text: "mer" }, childName: "Ida M." }),
    );
  });

  it("adults may only change wishes and childName", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertFails(updateDoc(doc(db, paths.calendar("2026-ida")), { currentVersion: 5 }));
    await assertFails(updateDoc(doc(db, paths.calendar("2026-ida")), { draft: "done" }));
  });

  it("children cannot update calendars", async () => {
    const db = env.authenticatedContext("ida").firestore();
    await assertFails(updateDoc(doc(db, paths.calendar("2026-ida")), { childName: "X" }));
  });

  it("nobody deletes calendars", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertFails(deleteDoc(doc(db, paths.calendar("2026-ida"))));
  });

  it("adults cannot write versions", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertFails(setDoc(doc(db, paths.version("2026-ida", 1)), { n: 2 }));
    await assertFails(setDoc(doc(db, paths.version("2026-ida", 2)), { n: 2 }));
  });

  it("adults cannot write pages", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertFails(setDoc(doc(db, paths.page("2026-ida", "m1", 2)), { manualId: "m1", page: 2 }));
  });

  it("adults create manuals only as uploaded", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertFails(setDoc(doc(db, paths.manual("2026-ida", "m2")), newManual("done", "m2")));
    await assertSucceeds(setDoc(doc(db, paths.manual("2026-ida", "m2")), newManual("uploaded", "m2")));
  });

  it("denies manuals with a wrong storagePath", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertFails(
      setDoc(doc(db, paths.manual("2026-ida", "m2")), {
        ...newManual("uploaded", "m2"),
        storagePath: "julekalender/2026-julian/manuals/m2.pdf",
      }),
    );
  });

  it("denies manuals with an extra key or preset processing fields", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertFails(setDoc(doc(db, paths.manual("2026-ida", "m2")), { ...newManual("uploaded", "m2"), extra: 1 }));
    await assertFails(setDoc(doc(db, paths.manual("2026-ida", "m2")), { ...newManual("uploaded", "m2"), pagesAnalyzed: 3 }));
  });

  it("children cannot create manuals", async () => {
    const db = env.authenticatedContext("ida").firestore();
    await assertFails(setDoc(doc(db, paths.manual("2026-ida", "m2")), newManual("uploaded", "m2")));
  });

  it("denies updating and deleting manuals from clients", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertFails(updateDoc(doc(db, paths.manual("2026-ida", "m1")), { status: "done" }));
    await assertFails(deleteDoc(doc(db, paths.manual("2026-ida", "m1"))));
  });
});
