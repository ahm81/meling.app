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
    const db = ctx.firestore();
    await setDoc(doc(db, paths.family("f1")), { name: "Meling", ownerId: "alice", memberIds: ["alice"] });
    await setDoc(doc(db, paths.member("f1", "alice")), { displayName: "Alice", role: "parent" });
  });
});

describe("families", () => {
  it("lets members read their family", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertSucceeds(getDoc(doc(db, paths.family("f1"))));
  });

  it("denies non-members", async () => {
    const db = env.authenticatedContext("mallory").firestore();
    await assertFails(getDoc(doc(db, paths.family("f1"))));
  });

  it("denies clients from adding themselves as members", async () => {
    const db = env.authenticatedContext("mallory").firestore();
    await assertFails(updateDoc(doc(db, paths.family("f1")), { memberIds: ["alice", "mallory"] }));
  });
});

describe("users", () => {
  it("lets a user create their own profile", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(db, paths.user("alice")), { displayName: "Alice" }));
  });

  it("denies writing familyIds from the client", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, paths.user("alice")), { displayName: "Alice", familyIds: ["f1"] }));
  });
});
