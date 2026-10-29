import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";

// Imported first from index.ts: ES module imports are evaluated before the importing
// module's body, so global options must be set in a module of their own.
initializeApp();
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });
