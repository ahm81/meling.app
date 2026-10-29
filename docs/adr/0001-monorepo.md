# 0001 – Monorepo for alle klienter og backend

**Status:** Akseptert (2026-10-29)

## Kontekst

meling.app består av en React-webapp, Apple-klienter (iOS, macOS, watchOS, tvOS) og Firebase
(prosjekt `meling-app`). Klientene deler samme datamodell i Firestore.

## Beslutning

- Ett repo med `apps/`, `packages/`, `firebase/` og `docs/`.
- pnpm workspaces og Turborepo for TypeScript-delen.
- Apple: ett XcodeGen-prosjekt (`project.yml`) med fire targets og en felles Swift-pakke
  (`MelingKit`). `.xcodeproj` genereres og sjekkes ikke inn.
- `MelingKit` er delt i `MelingCore` (ren Swift, alle plattformer) og `MelingFirebase`
  (Firebase SDK, iOS/macOS/tvOS). watchOS bruker kun `MelingCore`.
- Cloud Functions bundles med tsup slik at `@meling/shared` blir inlinet; den deployede
  `package.json` har derfor ingen `workspace:`-avhengigheter.
- Datamodellen dokumenteres i `docs/datamodel.md`; TS- og Swift-modeller holdes i takt manuelt
  inntil vedlikeholdet tilsier kodegenerering (JSON Schema → quicktype).

## Konsekvenser

- Én endring i datamodellen kan gjøres atomisk på tvers av alle klienter.
- Utviklere må ha XcodeGen installert (`brew install xcodegen`).
