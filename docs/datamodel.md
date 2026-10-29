# Datamodell (Firestore)

Dette er kontrakten alle klienter følger. Ved endringer oppdateres alle tre steder i samme commit:

- `packages/shared/src/` – zod-skjemaer og stier (web + functions)
- `apps/apple/Packages/MelingKit/Sources/MelingCore/` – Swift `Codable`-modeller og stier
- `firebase/firestore.rules` + `firebase/tests/` – tilgangsregler og tester

## Samlinger

### `users/{uid}`

| Felt          | Type       | Skrives av                       |
| ------------- | ---------- | -------------------------------- |
| `displayName` | string     | brukeren                         |
| `email`       | string?    | brukeren                         |
| `familyIds`   | string[]   | kun Cloud Functions              |

### `families/{familyId}`

| Felt        | Type      | Skrives av                        |
| ----------- | --------- | --------------------------------- |
| `name`      | string    | medlemmer (kun dette feltet)      |
| `ownerId`   | string    | Cloud Functions                   |
| `memberIds` | string[]  | Cloud Functions                   |
| `createdAt` | timestamp | Cloud Functions                   |

`memberIds` brukes av sikkerhetsreglene for å avgjøre tilgang til familien og alt under den.

### `families/{familyId}/members/{uid}`

| Felt          | Type                   | Skrives av                    |
| ------------- | ---------------------- | ----------------------------- |
| `displayName` | string                 | medlemmet selv                |
| `role`        | `"parent" \| "child"`  | Cloud Functions               |
| `joinedAt`    | timestamp              | Cloud Functions               |

## Callable functions (region `europe-west1`)

| Navn           | Request                         | Response         |
| -------------- | ------------------------------- | ---------------- |
| `createFamily` | `{ name, displayName }`         | `{ familyId }`   |

## Storage

`families/{familyId}/**` er lesbart og skrivbart for medlemmer av familien. Alt annet er stengt.
