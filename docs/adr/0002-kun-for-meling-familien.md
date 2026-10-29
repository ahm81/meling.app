# 0002 – Kun for Meling-familien

**Status:** Akseptert (2026-10-29)

## Kontekst

Første skjelett hadde en generell modell for flere familier (`families/{id}`, `createFamily`-callable,
invitasjoner senere). Appen skal bare brukes av Meling-familien, som en samling tjenester
dere lager for dere selv (for eksempel en julekalender).

## Beslutning

- Én familie og ingen åpen registrering. Tilgang styres av en tillatelsesliste i `members/{uid}`.
- Medlemmer legges til av en admin med `pnpm add-member` (firebase-admin), ikke fra klientene.
- Hver tjeneste får sin egen samling på toppnivå, beskyttet av `isMember()` i reglene.
- Cloud Functions brukes bare når en tjeneste trenger logikk på serveren.

## Konsekvenser

- Mye enklere regler og datamodell. Ingen flerfamilie- eller invitasjonslogikk.
- Hvis appen noen gang skal brukes av andre familier, må datamodellen bygges om.
