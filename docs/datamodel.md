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

## Tjenester

Hver tjeneste (for eksempel en julekalender) får sin egen samling på toppnivå og sin egen
`match`-blokk i `firestore.rules` som bruker `isMember()`. Alt som ikke er eksplisitt tillatt, er stengt.

## Storage

Alt er lesbart og skrivbart for medlemmer, og stengt for alle andre.

## Legge til et familiemedlem

Personen logger inn i appen én gang, slik at kontoen finnes i Firebase Auth. Deretter:

```bash
gcloud auth application-default login   # én gang
pnpm add-member --email ingjerd@example.com --name Ingjerd
```

Mot emulatorene (oppretter Auth-brukeren hvis den mangler):

```bash
pnpm add-member --email amund@example.com --name Amund --emulator
```
