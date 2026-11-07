// Adds a family member: pnpm add-member --email <email> --name <name> --role adult|child [--emulator]
//
// The person does not need to have signed in first: if no Auth account has the email, one is created
// with no sign-in method and the email marked as verified. Firebase allows one account per email, so
// signing in with Google on that address later lands in this account (same uid, already a member).
// Google is trusted for Gmail and Google Workspace addresses; other addresses may need a test first.
// Production needs Application Default Credentials (gcloud auth application-default login).
import { parseArgs } from "node:util";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { MemberDoc, paths } from "@meling/shared";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string" },
    emulator: { type: "boolean", default: false },
  },
});

if (values.emulator) {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
}

const member = MemberDoc.parse({ displayName: values.name, email: values.email, role: values.role });

initializeApp({ projectId: "meling-app" });
const auth = getAuth();

async function findOrCreateUser() {
  try {
    return await auth.getUserByEmail(member.email);
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
    const created = await auth.createUser({
      email: member.email,
      emailVerified: true,
      displayName: member.displayName,
    });
    console.log(`Opprettet konto for ${member.email}. Personen logger inn med Google på samme adresse.`);
    return created;
  }
}

const user = await findOrCreateUser();
await getFirestore().doc(paths.member(user.uid)).set(member);
console.log(`La til ${member.displayName} (${member.email}) som medlem: ${paths.member(user.uid)}`);
