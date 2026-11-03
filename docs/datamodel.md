# Datamodell (Firestore)

meling.app er kun for Meling-familien. Det finnes ingen åpen registrering: en innlogget bruker har
tilgang hvis og bare hvis `members/{uid}` finnes.

Dette er kontrakten alle klienter følger. Ved endringer oppdateres alle stedene i samme commit:

- `packages/shared/src/`: zod-skjemaer og stier (web, functions og admin-skript)
- `apps/apple/Packages/MelingKit/Sources/MelingCore/`: Swift `Codable`-modeller og stier
- `firebase/firestore.rules` + `firebase/tests/`: tilgangsregler og tester

## Samlinger

### `members/{uid}`

Familiemedlemmene. Legges til med `pnpm add-member`, aldri fra klientene.

| Felt          | Type   | Skrives av                         |
| ------------- | ------ | ---------------------------------- |
| `displayName` | string | admin-skriptet, eller medlemmet selv |
| `email`       | string | admin-skriptet                     |
| `role`        | `"adult"` eller `"child"` | admin-skriptet  |

## Tjenester

Hver tjeneste (for eksempel en julekalender) får sin egen samling på toppnivå og sin egen
`match`-blokk i `firestore.rules` som bruker `isMember()`. Alt som ikke er eksplisitt tillatt, er stengt.

### `julekalender/{calId}`

Julekalenderen for ett barn og ett år. Id er `{år}-{barnets uid}` (`calendarId(year, childUid)`). Bare voksne
(`role == "adult"`) har tilgang. Klienter kan aldri slette.

| Sti                                      | Les    | Skriv fra klient                                                                 |
| ---------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| `julekalender/{calId}`                   | voksne | opprett: nøyaktig feltene i `CalendarDoc`, `createdBy == uid`, `currentVersion == null`, `draft == "waiting"`, `draftError == null`. Oppdater: bare `wishes` og `childName` |
| `julekalender/{calId}/manuals/{id}`      | voksne | opprett med `status == "uploaded"`, nøyaktig feltene i `ManualDoc` og id av `[A-Za-z0-9_-]` (Firestore auto-id). Oppdater: bare `order` (heltall, minst 1). Slett: aldri (bruk `deleteManual`) |
| `julekalender/{calId}/pages/{manualId}_{side}` | voksne | aldri (bare functions)                                                     |
| `julekalender/{calId}/versions/{nr}`     | voksne | aldri (bare functions). Id er versjonsnummeret med 6 sifre (`000001`)            |

**Kalender** (`CalendarDoc`):

| Felt              | Type                                          | Skrives av |
| ----------------- | --------------------------------------------- | ---------- |
| `year`            | heltall (minst 2024)                          | klient ved opprettelse |
| `childUid`        | string                                        | klient ved opprettelse |
| `childName`       | string                                        | klient (kan endres) |
| `wishes`          | `{ balance: "bricks" \| "steps", text }` (text maks 1000 tegn) | klient (kan endres) |
| `currentVersion`  | heltall eller `null`                          | functions |
| `draft`           | `"waiting"`, `"running"`, `"done"` eller `"error"` | functions |
| `draftError`      | string eller `null`                           | functions |
| `createdBy`       | uid                                           | klient ved opprettelse |
| `draftUpdatedAt`  | timestamp (valgfri)                           | bare functions |

**Manual** (`ManualDoc`): `order` (heftenes rekkefølge, fra 1; voksne kan endre den), `fileName`, `storagePath` (PDF i Storage), `status`
(`uploaded` → `rendering` → `analyzing` → `done`, eller `error`), `pageCount`, `pagesAnalyzed`, `setNumber`, `error`
og `updatedAt` (valgfri, bare functions). Klienten oppretter dokumentet med `status: "uploaded"`; functions gjør resten.

**Side** (`PageDoc`): `manualId`, `page`, `imagePath` (PNG i Storage), `width`, `height` og `analysis`
(AI-ens tolkning: sidetype, trinn med nummer, område og deler, spoilere og delelister). Bare functions skriver.

**Versjon** (`VersionDoc`): `number`, `createdAt`, `author`, `summary` (maks 200 tegn), `plan` og `restoredFrom`.
Versjoner er uforanderlige og skrives bare av functions; hver endring av fordelingen er en ny versjon.

- `author` er `{ kind: "adult", uid }` eller `{ kind: "ai", requestedBy: uid | null }`.
- `plan` har `days` (nøyaktig 24, hver med `stepIds`) og `hidden` (skjulte områder: `id`, `manualId`, `page`, `bbox`
  eller `null` for hele siden, `label`, `source` `"ai"` eller `"adult"`). Trinn-id er `{manualId}:{side}:{indeks}`.
- `restoredFrom` er nummeret versjonen ble gjenopprettet fra, ellers `null`.

Felt som bare functions skriver (valgfrie i skjemaene, klienter kan aldri sette dem):

- `julekalender/{calId}.draftUpdatedAt` (timestamp): settes hver gang `draft` endres. Et utkast som har stått i
  `running` i mer enn 15 minutter, kan lages på nytt med `redraft`.
- `draftError` er feilmeldingen fra siste mislykkede utkast. Feiler `redraft` på en kalender med `draft == "done"`,
  forblir `draft` `"done"` (gjeldende versjon er uendret), men `draftError` får meldingen. Et vellykket utkast setter
  den til `null`.
- `julekalender/{calId}/manuals/{id}.updatedAt` (timestamp): settes ved hver status- og fremdriftsendring. En manual
  i `error`, eller i `rendering`/`analyzing` uten endring på mer enn 15 minutter, kan kjøres på nytt med `retryManual`.

Fordelingen lagrer ikke hvilke manualer den ble laget av. Admin utleder det fra planen: manualene er de som
trinn-id-ene (`{manualId}:…`) og de skjulte områdene viser til, og rekkefølgen er den trinnene først dukker opp i
dagene. Avviker dette fra manualene nå (ny, slettet eller flyttet manual), foreslår admin et nytt utkast.

Klienter leser Firestore-timestamps og gjør dem om til `Date` før de parser med zod-skjemaene.

**Callable functions** (`europe-west1`, krever `role == "adult"`) er den eneste veien til å endre fordelingen:

| Funksjon         | Gjør                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `editPlan`       | `{ calendarId, baseVersion, ops, summary }`: flytter trinn eller skjuler/viser områder og lager en ny versjon |
| `restoreVersion` | `{ calendarId, baseVersion, fromVersion }`: lager en ny versjon med planen til `fromVersion` og `restoredFrom` satt |
| `redraft`        | `{ calendarId, baseVersion }`: AI-en lager et nytt utkast som blir en ny versjon (kan ta flere minutter) |
| `renderCutouts`  | `{ calendarId, version }`: lager utklippene til pakkelisten i Storage                        |
| `retryManual`    | `{ calendarId, manualId }`: fortsetter rendering og analyse for en manual. Sider som allerede er analysert, og bildene deres, beholdes; bare de manglende sidene analyseres. Utklippene til manualen slettes |
| `deleteManual`   | `{ calendarId, manualId }`: sletter manualen med sider, sidebilder, utklipp og PDF. Ikke mens den leses (med mindre den har stått fast i mer enn 15 minutter). Versjonene endres ikke; venter kalenderen på førsteutkastet og alle gjenværende manualer er lest, lages det |

`baseVersion` må være `currentVersion`; ellers svarer funksjonen `failed-precondition` (noen andre har endret planen).

## Storage

Alt utenom `julekalender/` er lesbart og skrivbart for medlemmer, og stengt for alle andre.

- `julekalender/{calId}/manuals/{manualId}.pdf`: manualen. Voksne leser og skriver, bare `application/pdf` under 50 MB.
- `julekalender/{calId}/pages/{manualId}/{side}.png`: renderte sider (functions). `pagesDir` er mappen
  `pages/{manualId}/` som slettes når en manual fjernes.
- `julekalender/{calId}/cutouts/{stepId}/{maskKey}.webp`: utklipp til pakkelisten (functions). `cutoutsDir` er
  `cutouts/`.
- `julekalender/{calId}/**` utenom manualene: voksne leser, ingen skriver fra klient (bare functions).
- Stiene bygges av `storagePaths` i `packages/shared`. Storage-regler kan ikke kalle `isAdult()`; de leser
  `members/{uid}.role` via `firestore.get(...)`.

## Legge til et familiemedlem

Personen logger inn i appen én gang, slik at kontoen finnes i Firebase Auth. Deretter:

```bash
gcloud auth application-default login   # én gang
pnpm add-member --email ingjerd@example.com --name Ingjerd --role adult
```

Mot emulatorene (oppretter Auth-brukeren hvis den mangler):

```bash
pnpm add-member --email amund@example.com --name Amund --role adult --emulator
```
