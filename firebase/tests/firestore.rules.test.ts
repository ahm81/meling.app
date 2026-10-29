import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
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
    await assertFails(setDoc(doc(db, paths.member("stranger")), { displayName: "X", email: "x@example.com" }));
  });

  it("lets a member change their own display name", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertSucceeds(updateDoc(doc(db, paths.member("amund")), { displayName: "Amund M." }));
  });

  it("denies a member changing their email", async () => {
    const db = env.authenticatedContext("amund").firestore();
    await assertFails(updateDoc(doc(db, paths.member("amund")), { email: "other@example.com" }));
  });
});
