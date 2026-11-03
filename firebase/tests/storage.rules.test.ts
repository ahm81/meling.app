import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { paths, storagePaths } from "@meling/shared";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let env: RulesTestEnvironment;
const read = (name: string) => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), "utf8");
const bytes = () => new Uint8Array([1, 2, 3]);

beforeAll(async () => {
  // Storage rules read members through the Firestore emulator of the emulators' project, so this
  // must match `--project` in the root test:rules script.
  env = await initializeTestEnvironment({
    projectId: "demo-meling",
    firestore: { rules: read("firestore.rules") },
    storage: { rules: read("storage.rules") },
  });
});

afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, paths.member("amund")), { displayName: "Amund", email: "amund@example.com", role: "adult" });
    await setDoc(doc(db, paths.member("ida")), { displayName: "Ida", email: "ida@example.com", role: "child" });
    await uploadBytes(ref(ctx.storage(), storagePaths.pageImage("2026-ida", "m1", 1)), bytes(), {
      contentType: "image/png",
    });
  });
});

describe("storage julekalender", () => {
  it("adults upload a PDF manual", async () => {
    const st = env.authenticatedContext("amund").storage();
    await assertSucceeds(
      uploadBytes(ref(st, storagePaths.manualPdf("2026-ida", "m2")), bytes(), { contentType: "application/pdf" }),
    );
  });

  it("rejects non-PDF manuals", async () => {
    const st = env.authenticatedContext("amund").storage();
    await assertFails(
      uploadBytes(ref(st, storagePaths.manualPdf("2026-ida", "m2")), bytes(), { contentType: "image/png" }),
    );
  });

  it("rejects PDF manuals of 50 MB or more", async () => {
    const st = env.authenticatedContext("amund").storage();
    await assertFails(
      uploadBytes(ref(st, storagePaths.manualPdf("2026-ida", "m3")), new Uint8Array(50 * 1024 * 1024), {
        contentType: "application/pdf",
      }),
    );
  });

  it("children cannot upload manuals", async () => {
    const st = env.authenticatedContext("ida").storage();
    await assertFails(
      uploadBytes(ref(st, storagePaths.manualPdf("2026-ida", "m2")), bytes(), { contentType: "application/pdf" }),
    );
  });

  it("non-members cannot upload manuals", async () => {
    const st = env.authenticatedContext("stranger").storage();
    await assertFails(
      uploadBytes(ref(st, storagePaths.manualPdf("2026-ida", "m2")), bytes(), { contentType: "application/pdf" }),
    );
  });

  it("adults read page images", async () => {
    const st = env.authenticatedContext("amund").storage();
    await assertSucceeds(getBytes(ref(st, storagePaths.pageImage("2026-ida", "m1", 1))));
  });

  it("children cannot read page images", async () => {
    const st = env.authenticatedContext("ida").storage();
    await assertFails(getBytes(ref(st, storagePaths.pageImage("2026-ida", "m1", 1))));
  });

  it("adults cannot write page images or cutouts", async () => {
    const st = env.authenticatedContext("amund").storage();
    await assertFails(
      uploadBytes(ref(st, storagePaths.pageImage("2026-ida", "m1", 2)), bytes(), { contentType: "image/png" }),
    );
    await assertFails(
      uploadBytes(ref(st, storagePaths.cutout("2026-ida", "s1", "k")), bytes(), { contentType: "image/webp" }),
    );
  });

  it("members still use other paths", async () => {
    const st = env.authenticatedContext("ida").storage();
    await assertSucceeds(uploadBytes(ref(st, "other/x.txt"), bytes(), { contentType: "text/plain" }));
  });
});
