import { useEffect, useState, type FormEvent } from "react";
import { onAuthStateChanged, signInAnonymously, signOut, type User } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import type { CreateFamilyRequest, CreateFamilyResponse } from "@meling/shared";
import { auth, functions, useEmulators } from "./firebase";

const createFamily = httpsCallable<CreateFamilyRequest, CreateFamilyResponse>(functions, "createFamily");

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [familyName, setFamilyName] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  async function handleCreateFamily(event: FormEvent) {
    event.preventDefault();
    setStatus("Oppretter…");
    try {
      const { data } = await createFamily({ name: familyName, displayName: "Meg" });
      setStatus(`Familie opprettet: ${data.familyId}`);
    } catch (error) {
      setStatus(`Feil: ${(error as Error).message}`);
    }
  }

  return (
    <main>
      <h1>meling.app</h1>
      {useEmulators && <p className="badge">Kjører mot lokale emulatorer</p>}

      {user ? (
        <>
          <p>Innlogget som {user.uid}</p>
          <form onSubmit={handleCreateFamily}>
            <input
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              placeholder="Familienavn"
              required
            />
            <button type="submit">Opprett familie</button>
          </form>
          {status && <p>{status}</p>}
          <button onClick={() => signOut(auth)}>Logg ut</button>
        </>
      ) : (
        <button onClick={() => signInAnonymously(auth)}>Logg inn (anonymt)</button>
      )}
    </main>
  );
}
