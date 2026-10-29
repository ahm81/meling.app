# meling.app

Familieapp. Firebase-prosjekt: `meling-app` (functions-region `europe-west1`). Domene: meling.app.

## Struktur

- `apps/web` – React 19 + TypeScript + Vite. Hostes på Firebase Hosting.
- `apps/apple` – XcodeGen-prosjekt (`project.yml`) med targets for iOS, macOS, watchOS og tvOS.
  - `Packages/MelingKit` – `MelingCore` (modeller, alle plattformer) og `MelingFirebase` (ikke watchOS).
  - `Shared/` – SwiftUI-kode felles for iOS, macOS og tvOS.
- `packages/shared` – zod-skjemaer, typer og Firestore-stier for web og functions.
- `firebase/` – `functions/` (TS, bundles med tsup), `firestore.rules`, `storage.rules`, `tests/` (regeltester).
- `docs/datamodel.md` – kontrakten for Firestore. `docs/adr/` – arkitekturbeslutninger.

## Regler

- Endringer i datamodellen oppdateres samtidig i `packages/shared`, `MelingCore`, `firestore.rules`,
  regeltestene og `docs/datamodel.md`.
- Felter som styrer tilgang (`memberIds`, `familyIds`, `role`) skrives kun av Cloud Functions.
- Functions importerer `@meling/shared` via tsconfig-`paths` og tsup-bundling, ikke som npm-avhengighet.
- Ikke sjekk inn `Meling.xcodeproj`; endre `project.yml` og kjør `xcodegen generate`.

## Kommandoer

```bash
pnpm install
pnpm emulators            # Firebase Emulator Suite (UI på :4000)
pnpm --filter @meling/web dev
pnpm typecheck && pnpm test
pnpm test:rules           # Firestore-regeltester mot emulatoren
cd apps/apple && xcodegen generate && open Meling.xcodeproj
cd apps/apple/Packages/MelingKit && swift test
```

Apple-appene konfigurerer Firebase bare hvis `GoogleService-Info.plist` finnes i app-bundlen.
Start med launch-argumentet `-useEmulators` for å bruke lokale emulatorer.
