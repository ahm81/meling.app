import { useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { MemberDoc, paths } from "@meling/shared";
import { auth, db, useEmulators } from "./firebase";

type Access =
  | { state: "loading" }
  | { state: "signedOut" }
  | { state: "denied"; user: User }
  | { state: "member"; user: User; member: MemberDoc };

async function resolveAccess(user: User | null): Promise<Access> {
  if (!user) return { state: "signedOut" };
  try {
    const snapshot = await getDoc(doc(db, paths.member(user.uid)));
    return { state: "member", user, member: MemberDoc.parse(snapshot.data()) };
  } catch {
    // Rules deny reads for anyone who isn't in members/, so a failed read means no access.
    return { state: "denied", user };
  }
}

export function App() {
  const [access, setAccess] = useState<Access>({ state: "loading" });
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => onAuthStateChanged(auth, (user) => void resolveAccess(user).then(setAccess)), []);

  async function signIn() {
    setSignInError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
      setSignInError(
        code === "auth/popup-blocked"
          ? "Nettleseren blokkerte innloggingsvinduet. Tillat popup-vinduer for meling.app og prøv igjen."
          : "Innloggingen feilet. Prøv igjen.",
      );
    }
  }

  return (
    <main>
      <h1>meling.app</h1>
      {useEmulators && <p className="badge">Kjører mot lokale emulatorer</p>}

      {access.state === "loading" && <p>Laster…</p>}

      {access.state === "signedOut" && (
        <>
          <button onClick={signIn}>Logg inn med Google</button>
          {signInError && <p role="alert">{signInError}</p>}
        </>
      )}

      {access.state === "denied" && (
        <>
          <p>{access.user.email} har ikke tilgang. Denne appen er kun for Meling-familien.</p>
          <button onClick={() => signOut(auth)}>Logg ut</button>
        </>
      )}

      {access.state === "member" && (
        <>
          <p>Hei, {access.member.displayName}!</p>
          <button onClick={() => signOut(auth)}>Logg ut</button>
        </>
      )}
    </main>
  );
}
