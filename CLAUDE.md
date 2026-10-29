# meling.app

Privat app kun for Meling-familien (Amund, Ingjerd, Julian og Ida), med tjenester som for eksempel en julekalender. Ingen åpen registrering. Firebase-prosjekt: `meling-app` (functions-region `europe-west1`). Domene: meling.app.

## Struktur

- `apps/web` – React 19 + TypeScript + Vite. Hostes på Firebase Hosting.
- `apps/apple` – XcodeGen-prosjekt (`project.yml`) med targets for iOS, macOS, watchOS og tvOS.
  - `Packages/MelingKit` – `MelingCore` (modeller, alle plattformer) og `MelingFirebase` (ikke watchOS).
  - `Shared/` – SwiftUI-kode felles for iOS, macOS og tvOS.
- `packages/shared` – zod-skjemaer, typer og Firestore-stier for web og functions.
- `firebase/` – `functions/` (TS, bundles med tsup), `admin/` (admin-skript som `add-member`), `firestore.rules`, `storage.rules`, `tests/` (regeltester).
- `docs/datamodel.md` – kontrakten for Firestore. `docs/adr/` – arkitekturbeslutninger.

## Regler

- Endringer i datamodellen oppdateres samtidig i `packages/shared`, `MelingCore`, `firestore.rules`,
  regeltestene og `docs/datamodel.md`.
- Tilgang: innlogget bruker er medlem hvis og bare hvis `members/{uid}` finnes. Medlemmer legges til med `pnpm add-member`, aldri fra klientene.
- Nye tjenester får egen samling på toppnivå og egen `match`-blokk med `isMember()` i `firestore.rules`, pluss regeltester.
- Functions importerer `@meling/shared` via tsconfig-`paths` og tsup-bundling, ikke som npm-avhengighet.
- Ikke sjekk inn `Meling.xcodeproj`; endre `project.yml` og kjør `xcodegen generate`.

## Kommandoer

```bash
pnpm install
pnpm emulators            # Firebase Emulator Suite (UI på :4000)
pnpm --filter @meling/web dev
pnpm typecheck && pnpm test
pnpm test:rules           # Firestore-regeltester mot emulatoren
pnpm add-member --email <e-post> --name <navn> [--emulator]
cd apps/apple && xcodegen generate && open Meling.xcodeproj
cd apps/apple/Packages/MelingKit && swift test
```

Apple-appene konfigurerer Firebase bare hvis `GoogleService-Info.plist` finnes i app-bundlen.
Start med launch-argumentet `-useEmulators` for å bruke lokale emulatorer.
