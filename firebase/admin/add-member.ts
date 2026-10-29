// Adds a family member: pnpm add-member --email <email> --name <name> [--emulator]
//
// In production the person must have signed in to the app once so their Auth account exists,
// and you need Application Default Credentials (gcloud auth application-default login).
// With --emulator the Auth user is created if it doesn't exist.
import { parseArgs } from "node:util";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { MemberDoc, paths } from "@meling/shared";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    emulator: { type: "boolean", default: false },
  },
});

if (values.emulator) {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
}

const member = MemberDoc.parse({ displayName: values.name, email: values.email });

initializeApp({ projectId: "meling-app" });
const auth = getAuth();

async function findOrCreateUser() {
  try {
    return await auth.getUserByEmail(member.email);
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
    if (!values.emulator) {
      throw new Error(`${member.email} har ingen konto. Be personen logge inn i appen én gang først.`);
    }
    return auth.createUser({ email: member.email, displayName: member.displayName });
  }
}

const user = await findOrCreateUser();
await getFirestore().doc(paths.member(user.uid)).set(member);
console.log(`La til ${member.displayName} (${member.email}) som medlem: ${paths.member(user.uid)}`);
