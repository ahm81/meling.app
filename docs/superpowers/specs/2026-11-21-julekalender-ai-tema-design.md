# Julekalender: AI-laget tema – design

Dato: 2026-11-21. Bygger på «Utseende»-fanen (PR 17: fire faste temaer og bilder per luke).

## Hensikt

Hvert barn skal få en kalender som føles laget for akkurat dem. Eksempel: Ida (5 år) bygger LEGO-julekalender i år,
og skal få et eget LEGO-juletema med 24 lukebilder i samme stil. Neste år, eller for Julian, kan temaet være noe helt
annet. I dag kan de voksne bare velge mellom fire fargetemaer og laste opp bilder selv. Det er mye arbeid, og det
blir sjelden helhetlig.

## Mål

- En voksen skriver noen få ord om barnet og temaet (for eksempel «LEGO-jul, Ida 5 år, liker katter og rosa») på
  «Utseende»-siden og trykker «Lag tema».
- AI lager et eget tema: fem farger (samme fem som CSS-temaene: bakgrunn, luke, åpnet luke, aksent, tekst) og 24
  separate lukebilder i én felles stil.
- Forhåndsvisningen fylles ut etter hvert som bildene blir ferdige. Barnet ser bare det som er lagret.
- Den voksne kan lage én luke på nytt, eller hele temaet på nytt.
- Fungerer like godt for Ingjerd som for Amund (i appen, ikke i et skript).

## Ikke-mål

- Bakgrunnsbilde bak lukene (kan komme senere). *Mitt valg: holder første versjon til farger og lukebilder.*
- Å redigere egne bilder av familien (for eksempel «gjør Ida om til en nisse»). Bilder av barna skal ikke sendes til
  Google.
- Temaer i Apple-appene. De viser ikke temaer i dag.
- Fri redigering av fargene for hånd.

## Anti-mål (feiler selv om det teknisk virker)

- Bilder med tekst, tall eller bokstaver. Lukenummeret legges oppå, og tekst i bildet blir rot.
- Bilder som ikke passer for en 5-åring, eller som er skumle.
- 24 bilder som ser ut til å komme fra hver sin kalender.
- At barnet ser et halvferdig tema, eller at en feil i genereringen ødelegger kalenderen barnet allerede har.

## Begrensninger

- AI kjører via Vertex AI med Application Default Credentials og uten nøkler, prosjekt `meling-app`, slik
  `gemini.ts` gjør i dag.
- Bildemodell: Nano Banana 2, modell-ID `gemini-3.1-flash-image` (Vertex). Den leses fra miljøet ved hvert kall,
  `GEMINI_IMAGE_MODEL` (standard `gemini-3.1-flash-image`), med samme lokasjon som `GEMINI_LOCATION`. Ikke en
  hemmelighet.
- Tekststeget bruker eksisterende `GEMINI_MODEL`.
- Endringer i datamodellen oppdateres samtidig i `packages/shared`, `MelingCore`, `firestore.rules`, regeltestene og
  `docs/datamodel.md` (CLAUDE.md).
- Bare voksne kan starte generering (samme sjekk som de andre callables).
- `MELING_FAKE_AI=1` skal også gi falske bilder i emulatoren, uten nettverk.
- Lukebildene er kvadratiske JPEG-er på inntil 640 px under `julekalender/{calId}/doors/`, som i dag. `sharp` finnes
  allerede i functions.
- Pris: Vertex prises per output-token for bilder. Må sjekkes mot den offisielle prislisten før deploy. Grovt anslag:
  noen titalls kroner per tema.
- Kostnadskontroll: ingen tak i appen. I stedet et budsjettvarsel i Google Cloud Billing for prosjektet, som sender
  e-post hvis forbruket løper løpsk. *Amunds valg.* Settes opp av en prosjekteier, enten i
  `scripts/setup-github-deploy.sh` eller som et dokumentert manuelt steg (builderens valg). Beløp og mottaker
  committes ikke (repoet er offentlig).

## Tilnærminger

Vurdert:

- **A. AI-tema i appen via en function (valgt).** Gemini planlegger stil, farger og 24 motiver. Nano Banana 2 lager
  ett stilreferansebilde og deretter 24 lukebilder med referansen som input. Status i Firestore, live
  forhåndsvisning. Mest arbeid, men det eneste som gir et personlig tema uten terminal.
- **B. Som A, uten planleggingssteg.** Fast liste med 24 motiver og fargene fra de fire temaene. Billigere og
  enklere, men mindre personlig, og det er det personlige som er poenget.
- **C. Lokalt admin-skript.** Nesten ikke noe UI, men bare Amund ved maskinen kan bruke det.

Amund valgte A. Han valgte også 24 separate bilder i samme stil, fremfor ett stort bilde delt i 24 luker, fordi
enkeltluker da kan lages på nytt.

## Slik virker det

### Flyt

1. Voksen skriver beskrivelse og trykker «Lag tema». Klienten kaller callable `generateTheme { calendarId, prompt }`.
2. Callable sjekker voksen og at ingen generering kjører (eller at den har stått fast i over 15 minutter, som
   `draft`), setter jobbstatus til `running` og starter arbeidet.
3. **Planlegging (Gemini tekst, JSON):** ut fra beskrivelsen og barnets navn/alder lager modellen
   - `style`: én stilbeskrivelse som brukes i alle bildekall (for eksempel «lyse, glade 3D-renderte byggeklosser,
     myk belysning, enkel bakgrunn»),
   - `colors`: fem hex-farger som passer stilen og gir god kontrast mot lukenummeret,
   - `motifs`: 24 korte motiver som henger sammen, men er forskjellige.
   Modellen skal unngå varemerkenavn i bildebeskrivelsene (for eksempel «byggeklosser og minifigurer» i stedet for
   «LEGO»), siden bildemodellen kan avvise dem. Testes med et prøveskript før vi låser formuleringen.
4. **Stilreferanse:** Nano Banana 2 lager ett bilde ut fra `style`. Det lagres og brukes som input-bilde i alle
   lukebildekall, slik at stilen holder seg lik.
5. **Lukebilder:** for hver luke lages et kvadratisk bilde med `style` + motiv + referansebildet + faste regler
   (ingen tekst/tall/bokstaver, barnevennlig, motivet midt i bildet, rolig bakgrunn). Begrenset parallellitet
   (for eksempel 4 om gangen). Hvert bilde skaleres til 640 px JPEG og lagres under kalenderens `doors/`.
   Fremdrift skrives til Firestore etter hvert bilde.
6. Når alle 24 er ferdige, eller etter en feil, settes status til `done` eller `error`.

`regenerateDoor { calendarId, door }` lager ett nytt bilde for én luke med samme stil, referanse og motiv (ny
variant). *Mitt valg: ingen egen tekst per luke i første versjon.*

### Utkast og barnets kalender

Genereringen skrives til et **utkast** (eget felt), ikke rett til `theme`/`doorImages`. Forhåndsvisningen viser
utkastet mens det lages. Når den voksne trykker «Bruk dette temaet», kopieres farger og bildestier til det barnet
ser. Da ødelegger aldri en feilet eller halvferdig generering kalenderen barnet har. *Mitt valg, ut fra anti-målet
over.*

Regler for utkastet (*mine valg*):

- Feiler planleggingen eller stilreferansen, blir utkastet `error` uten bilder, og den voksne lager det på nytt.
- Feiler enkeltluker etter retry (for eksempel avslag fra sikkerhetsfilteret), fortsetter resten. Utkastet ender som
  `done` med de feilede lukene merket per luke, og den voksne retter dem med «Ny variant».
- «Bruk dette temaet» krever farger og alle 24 bilder. Ellers er knappen deaktivert, og callable avviser.
- «Ny variant» endrer bare utkastet. For å få endringen ut til barnet trykker den voksne «Bruk dette temaet» igjen.
- Utkastet blir liggende etter at det er brukt, så den voksne kan justere og bruke det på nytt.
- Har noen luker bilder de voksne har lastet opp selv, spør appen før temaet tas i bruk: «Erstatt alle 24» eller
  «Behold de du har lastet opp selv». `applyThemeDraft` tar `{ calendarId, keepUploaded: boolean }`. Med `true`
  får bare lukene uten selvopplastet bilde AI-bildet. Har ingen luker selvopplastede bilder, spørres det ikke.
  *Amunds valg.* Appen må derfor kunne skille selvopplastede bilder fra AI-bilder i `doorImages`. Hvordan (for
  eksempel et merke i filnavnet eller et eget felt) er builderens valg.
- `applyThemeDraft` **kopierer** bildefilene til `doors/` med nye id-er. Utkast og barnets kalender deler aldri
  filer, så web-appens sletting av gamle lukebilder og oppryddingen av utkastbilder kan ikke ta noe fra hverandre.

### Datamodell (forslag, builderen finpusser navn)

- `THEMES` får verdien `"egen"`. Når `theme == "egen"`, kommer fargene fra `customTheme.colors`.
- `julekalender/{calId}.customTheme` (bare functions skriver): `{ prompt, colors: { bg, door, done, accent, text },
  styleImage }`, eller mangler.
- `julekalender/{calId}.themeDraft` (bare functions skriver): `{ status: "running" | "done" | "error", error,
  updatedAt, prompt, colors, styleImage, motifs: string[24], doorImages: { "1".."24": sti } }`.
- Å ta i bruk utkastet går via callable `applyThemeDraft { calendarId }`, som kopierer utkastet til `customTheme`,
  `doorImages` og `theme = "egen"` i én transaksjon. Klientene kan fortsatt sette `theme` til et av de fire faste
  temaene og laste opp egne lukebilder som før. `"egen"` kan bare settes når `customTheme` finnes.
- Storage: `julekalender/{calId}/doors/` som i dag for lukebilder. Stilreferansen ligger et sted bare functions
  skriver og voksne leser.

### Web

- «Utseende»: nytt felt «Lag eget tema» (tekstfelt + knapp), fremdrift («12 av 24 bilder»), forhåndsvisning av
  utkastet med knappene «Lag på nytt», «Ny variant» per luke og «Bruk dette temaet». Det egne temaet vises som et
  femte valg ved siden av Jul/Vinter/Skog/Natt når det finnes.
- `ChildFrame` setter de fem CSS-variablene som inline-stil når temaet er `"egen"`.

### Falsk AI

Med `MELING_FAKE_AI=1` gir planleggingen faste farger og motiver, og bildekallene gir ensfargede PNG-er med ulik
farge per luke. Da kan emulatoren og testene kjøres uten nettverk.

## Overlatt til builderen

- Om arbeidet kjører i callable (`timeoutSeconds: 540`) eller i en Firestore-trigger på `themeDraft`. Følg mønsteret
  fra `redraft`/`onManualCreated`.
- Retry og feilhåndtering (gjenbruk `isRetryable` og retry-oppsettet i `gemini.ts`), og hvordan et avslag fra
  sikkerhetsfilteret håndteres for én luke (for eksempel prøve igjen én gang med omskrevet motiv).
- Opprydding av gamle utkastbilder i Storage.
- Eksakte prompter, og et prøveskript à la `try-analysis` for å teste stil og varemerkeformulering.
