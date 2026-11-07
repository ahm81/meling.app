import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { MemberDoc, paths } from "@meling/shared";
import { auth, db, useEmulators } from "./firebase";
import { AdminShell, AdultOnly } from "./julekalender/admin/AdminShell";
import { HistoryPage } from "./julekalender/admin/HistoryPage";
import { ManualsPage } from "./julekalender/admin/ManualsPage";
import { Overview } from "./julekalender/admin/Overview";
import { PackingListPrint } from "./julekalender/admin/PackingListPrint";
import { PlanPage } from "./julekalender/admin/PlanPage";

type Access =
  | { state: "loading" }
  | { state: "signedOut" }
  | { state: "denied"; user: User }
  | { state: "invalidMember"; user: User }
  | { state: "member"; user: User; member: MemberDoc };

async function resolveAccess(user: User | null): Promise<Access> {
  if (!user) return { state: "signedOut" };
  let data: unknown;
  try {
    const snapshot = await getDoc(doc(db, paths.member(user.uid)));
    if (!snapshot.exists()) return { state: "denied", user };
    data = snapshot.data();
  } catch {
    // Rules deny reads for anyone who isn't in members/, so a failed read means no access.
    return { state: "denied", user };
  }
  const member = MemberDoc.safeParse(data);
  if (!member.success) {
    // A member, but the document is incomplete (for example without role): fixed by add-member, not by us.
    console.error("Ugyldig medlemsdokument", member.error);
    return { state: "invalidMember", user };
  }
  return { state: "member", user, member: member.data };
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

  if (access.state !== "member") {
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

        {access.state === "invalidMember" && (
          <>
            <p role="alert">Medlemskapet ditt mangler rolle eller er ugyldig. Be en voksen kjøre add-member på nytt.</p>
            <button onClick={() => signOut(auth)}>Logg ut</button>
          </>
        )}
      </main>
    );
  }

  const { user, member } = access;
  const adult = member.role === "adult";

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <main>
              <h1>meling.app</h1>
              {useEmulators && <p className="badge">Kjører mot lokale emulatorer</p>}
              <p>Hei, {member.displayName}!</p>
              {adult && (
                <nav>
                  <Link className="btn" to="/julekalender/admin">
                    Julekalender
                  </Link>
                </nav>
              )}
              <button onClick={() => signOut(auth)}>Logg ut</button>
            </main>
          }
        />
        <Route path="/julekalender/admin" element={<AdultOnly adult={adult} />}>
          <Route index element={<Overview uid={user.uid} />} />
          <Route path=":calId" element={<AdminShell />}>
            <Route index element={<Navigate to="manualer" replace />} />
            <Route path="manualer" element={<ManualsPage />} />
            <Route path="fordeling" element={<PlanPage />} />
            <Route path="historikk" element={<HistoryPage />} />
            <Route path="pakkeliste" element={<PackingListPrint />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
