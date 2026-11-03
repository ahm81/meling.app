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
- Julekalender-functions (rendering av PDF, Gemini-analyse, fordeling, callables) ligger i
  `firebase/functions/src/julekalender/`. AI er Gemini via Vertex AI med Application Default Credentials og
  uten nøkler (prosjekt `meling-app`, location `global`). I emulatoren: `MELING_FAKE_AI=1` i
  `firebase/functions/.env.local` (gitignored) gir en falsk AI uten nettverk.
- `mupdf` (PDF-rendering) er AGPL-3.0. Det er en bevisst avhengighet i functions.
- Ikke sjekk inn `Meling.xcodeproj`; endre `project.yml` og kjør `xcodegen generate`.

## Kommandoer

```bash
pnpm install
pnpm emulators            # Firebase Emulator Suite (UI på :4000)
pnpm --filter @meling/web dev
pnpm typecheck && pnpm test
pnpm test:rules           # Firestore-regeltester mot emulatoren
pnpm test:functions       # functions-tester mot emulatoren (prosjekt demo-meling)
pnpm --filter @meling/functions check:load   # functions må la seg laste med require (også i CI)
pnpm add-member --email <e-post> --name <navn> --role adult|child [--emulator]
cd apps/apple && xcodegen generate && open Meling.xcodeproj
cd apps/apple/Packages/MelingKit && swift test
```

Julekalenderens Gemini-kall bruker modellen `GEMINI_MODEL` (standard `gemini-2.5-pro`) og Vertex-lokasjonen
`GEMINI_LOCATION` (standard `global`). Begge leses fra miljøet ved hvert kall og er ikke hemmeligheter: sett dem i
skallet for `try-analysis`, eller i `firebase/functions/.env.meling-app` (kan committes) for deploy.
`MELING_FAKE_AI=1` i `firebase/functions/.env.local` gir falsk AI i emulatoren.

Apple-appene konfigurerer Firebase bare hvis `GoogleService-Info.plist` finnes i app-bundlen.
Start med launch-argumentet `-useEmulators` for å bruke lokale emulatorer.

## CI/CD

- `.github/workflows/js.yml`: typecheck, tester, bygg og regeltester på PR-er (gjenbrukes av deploy).
- `.github/workflows/apple.yml`: MelingCore-tester og bygg av iOS, macOS og tvOS på PR-er.
- `.github/workflows/preview.yml`: web bygges uten tilgang, og en egen jobb uten prosjektkode deployer artefaktet til en Hosting-forhåndsvisning (`pr-<nr>`, 7 dager).
- `.github/workflows/deploy.yml`: ved push til main kjøres sjekkene, deretter `firebase deploy --force` til `meling-app`.
- Autentisering mot Google Cloud skjer med Workload Identity (ingen nøkler i GitHub), med to kontoer:
  `github-deployer` (full deploy, kun GitHub-miljøet `production`, som bare `main` kan bruke) og
  `github-preview` (kun Hosting, kun GitHub-miljøet `preview`).
  Engangsoppsett: `scripts/setup-github-deploy.sh`. Den må kjøres (av en prosjekteier) før første deploy av functions:
  den slår på API-ene for Functions 2. gen, Eventarc, Pub/Sub, regler og Vertex AI og gir tjenesteagentene rollene
  Firestore-triggere og `firestore.get` i `storage.rules` trenger. Repo-variablene er
  `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT` og `GCP_PREVIEW_SERVICE_ACCOUNT`.
- Alle actions er låst til commit-SHA. Dependabot (`.github/dependabot.yml`) oppdaterer dem.
- Web-konfigurasjonen for produksjon ligger i `apps/web/.env.production`, men API-nøkkelen committes aldri. CI setter
  `VITE_FIREBASE_API_KEY` fra repo-variabelen `FIREBASE_WEB_API_KEY`. Nøkkelen er begrenset til våre domener og til
  Auth, Firestore, Storage og Installations. Lokalt prod-bygg: legg den i `apps/web/.env.production.local`.
- Jobber med tilgang til Google Cloud kjører ikke prosjektkode. `firebase-tools` installeres fra lockfilen i
  `tools/firebase-cli` med `npm ci --ignore-scripts`.
