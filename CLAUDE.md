# meling.app

Privat app kun for Meling-familien (Amund, Ingjerd, Julian og Ida), med tjenester som for eksempel en julekalender. Ingen åpen registrering. Firebase-prosjekt: `meling-app` (Blaze, Firestore `eur3`, Storage `EU`, functions-region `europe-west1`). Domene: meling.app.

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

## CI/CD

- `.github/workflows/js.yml`: typecheck, tester, bygg og regeltester på PR-er (gjenbrukes av deploy).
- `.github/workflows/apple.yml`: MelingCore-tester og bygg av iOS, macOS og tvOS på PR-er.
- `.github/workflows/preview.yml`: web deployes til en Hosting-forhåndsvisning (`pr-<nr>`, 7 dager) på PR-er fra repoet.
- `.github/workflows/deploy.yml`: ved push til main kjøres sjekkene, deretter `firebase deploy --force` til `meling-app`.
- Autentisering mot Google Cloud skjer med Workload Identity (ingen nøkler i GitHub), med to kontoer:
  `github-deployer` (full deploy, kun GitHub-miljøet `production`, som bare `main` kan bruke) og
  `github-preview` (kun Hosting, kun `pull_request`-jobber).
  Engangsoppsett: `scripts/setup-github-deploy.sh`. Repo-variablene er
  `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT` og `GCP_PREVIEW_SERVICE_ACCOUNT`.
- Alle actions er låst til commit-SHA. Dependabot (`.github/dependabot.yml`) oppdaterer dem.
- Web-konfigurasjonen for produksjon ligger i `apps/web/.env.production`. Den er offentlig og ikke hemmelig.
