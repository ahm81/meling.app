# Julekalender – design

Dato: 2026-11-03 · Status: utkast til godkjenning · Skisser: https://claude.ai/artifact/UtbTs19L3FaWauZuUWLAk6

## Hensikt

Hver desember lager de voksne (Amund og Ingjerd) en Lego-julekalender til barna (Ida og Julian). De kjøper
et Lego-sett per barn, laster ned byggeinstruksjonene som PDF fra lego.com, deler byggetrinnene på 24 dager,
pakker brikkene for hver dag i 24 poser og lar barnet åpne én luke om dagen med dagens byggetrinn.

Før ble dette gjort for hånd: PDF-ene ble splittet manuelt og lastet opp som 24 filer per barn (se repoene
`ahm81/Julekalender2022` og `ahm81/Julekalender`). Det var tungvint. Lenkene var åpne, kalenderen var skrevet
rett inn i koden, og det fantes ingen admin.

Julekalenderen blir den første tjenesten i meling.app. Målet er at de voksne laster opp manualene, lar AI
gjøre grovarbeidet og justerer resultatet i en samtale med AI-en. Barna får en kalender som ikke røper noe
om hva de bygger.

## Mål

1. De voksne kan lage en ny julekalender hvert år, med én kalender per barn. Tidligere år blir liggende.
2. Opplastede Lego-manualer (én eller flere PDF-er per sett) analyseres av AI. AI-en finner byggetrinn og
   brikker per trinn, foreslår en fordeling på 24 dager og finner sider eller områder som avslører det ferdige
   settet.
3. AI-en lager **automatisk et førsteutkast** til fordeling når alle heftene er lest.
4. De voksne justerer fordelingen i en **samtale med AI-en**. AI-en svarer med forslag som må godtas
   («Bruk endringene») eller forkastes. Fordelingen kan også endres direkte med knapper (flytt trinn,
   skjul område).
5. Fordelingen kan dele en side mellom to dager, for eksempel venstre trinn på dag 5 og høyre trinn på dag 6.
6. **Pakkeliste per dag**, slik at de voksne vet hvilke brikker som skal i hver pose. Den kan skrives ut.
7. AI lager et **tema** (navn, farger) og **24 lukebilder** per kalender. Hvert lukebilde kan byttes mot en ny
   AI-variant eller et eget opplastet bilde. En **lås** på luken hindrer at bildet endres (se Låser).
8. **Endringshistorikk** per kalender: hver lagret endring blir en versjon med hvem, når og hva. Enhver versjon
   kan gjenopprettes, og gjenopprettingen blir selv en ny versjon.
9. Barna logger inn med egen Google- eller Apple-konto på egen mobil og ser bare sin egen kalender.
10. De voksne kan **bytte profil** som på Netflix og bruke kalenderen som barnet. Det de gjør der, teller som
    om barnet gjorde det.
11. **Godkjenning før barnet ser noe.** Barnet ser alltid den sist *godkjente* versjonen. Endringer etter
    godkjenning, også på luker barnet allerede har åpnet (for eksempel når instruksene ikke stemmer med
    brikkene), blir først synlige for barnet når en voksen godkjenner på nytt.

## Ikke-mål (i år)

- Apple-appene (iOS, macOS, watchOS, tvOS). Bare web i år, som PWA som kan legges på hjemskjermen.
- Import av kalenderne fra 2022 og 2025.
- Varsler (push eller e-post) til barna.
- Andre typer innhold enn Lego-manualer (for eksempel sjokolade eller gåter).
- Kalendere for andre enn Meling-familien.

## Anti-mål: det som gjør dette til en fiasko selv om det virker

- **Barnet får vite hva som bygges før det skal.** Barnevisningen viser aldri settnavn, settnummer, tema-navn,
  historie, trinnummer, heftenummer, sidenummer, pakkenummer eller antall brikker. Den viser ikke bilder av
  ferdig modell, forhåndsvisninger av delbygg, delelister eller reklame. Lukebildene og temaet skal heller ikke
  hinte om settet (se AI-regler). Og ingenting for en fremtidig dag kan lastes ned før dagen er kommet, selv av
  et barn som kan bruke utviklerverktøy.
- **AI-en endrer ting uten at en voksen har godtatt det.** Fordelingen endres bare av et menneske, enten direkte
  eller ved «Bruk endringene». Unntaket er førsteutkastet. Alle endringer kan rulles tilbake.
- **Det tar lengre tid enn å gjøre det for hånd.** Flyten fra opplasting til godkjent kalender skal ta minutter,
  ikke en kveld.

## Rammer

- **Frist:** første luke er 1. desember 2026. De voksne trenger pakkelistene noen dager før for å pakke. Admin
  (opplasting, fordeling, pakkeliste) må derfor fungere senest rundt 22. november. Tema, lukebilder og
  barnevisningen må være klare før 1. desember. Det er omtrent fire uker fra i dag.
- **Plattform:** eksisterende monorepo og stack: React 19 + Vite i `apps/web`, Firebase (Auth, Firestore `eur3`,
  Storage EU, Cloud Functions v2 i `europe-west1`), `packages/shared` for zod-skjemaer. Følg reglene i
  `CLAUDE.md`: egen samling på toppnivå, egen `match`-blokk, regeltester, `docs/datamodel.md` oppdateres
  samtidig. Det Apple-appene ikke trenger i år, trenger ikke `MelingCore`-modeller i år.
- **AI:** Gemini via Vertex AI, kalt fra Cloud Functions med prosjektets tjenestekonto. Ingen API-nøkler.
  Lesing av PDF-sider, fordeling, samtale og bildegenerering går hit. Bruk EU-region der modellen finnes der,
  ellers `global`-endepunktet (godkjent av Amund). Det som sendes, er Lego-sider, de voksnes ønsker og barnas
  fornavn. Byggeren velger modellversjon.
- **Repoet er offentlig.** Ingen nøkler eller hemmeligheter i koden.
- **Tidssone:** Europe/Oslo. Luke *n* åpner kl. 00.00 norsk tid den *n*. desember. Etter 24. desember er alle
  luker åpne, og kalenderen blir liggende som arkiv.
- **Datamengde:** 1–3 PDF-er per sett, 40–80 sider hver, 2 barn per år. Kostnaden til AI er liten.

## Brukere og roller

- **Voksen** (Amund, Ingjerd): full admin på alle kalendere, og kan bytte til barneprofilene.
- **Barn** (Ida, Julian): ser bare sin egen kalender i barnevisningen, og har ingen tilgang til admin.

Rollen lagres på `members/{uid}` (nytt felt `role: "adult" | "child"`), og settes av `add-member` (nytt
argument `--role`). Barna trenger egne Firebase Auth-kontoer. De logger inn én gang og legges så til som i dag.

**Innlogging med Apple på web** legges til ved siden av Google: Firebase Auth Apple-provider, med Services ID og
nøkkel fra Apple Developer-kontoen (Amund har en). Konfigurasjonen gjøres i Apple- og Firebase-konsollen, ikke i
repoet.

## Skjermene

Skissene i lenken øverst viser alle skjermene. Kort beskrevet:

### Barnevisning (mobil, PWA)

- **Kalenderen:** «God jul, Ida!» og et rutenett med 24 luker. Hver luke har sitt lukebilde og nummer. Ingen
  temanavn og ingen beskrivelse av innholdet. Lukene vises som åpnet, «dagens» eller låst. Utseendet (farger)
  kommer fra temaet.
- **Trykk på en låst fremtidig luke:** en kort, morsom animasjon der julenissen viser at det ikke er lov ennå.
  Ingen feilmelding og ingen avsløring av innhold.
- **Åpne en luke:** lukedøren med tallet øverst, og under den bare **dagens byggebilder** (utklippene). Ingen
  tekst om trinn, hefte, side, pakke eller brikketall. Knappen «Ferdig bygget!» nederst.
- **Ta igjen tapte dager:** etter «Ferdig bygget!» vises «Neste luke» så lenge det finnes eldre uåpnede eller
  ikke ferdige luker frem til i dag. Den går til den eldste av dem. Når barnet har tatt igjen dagens dato, går
  den tilbake til kalenderen.
- **Profilvelger** (bare for voksne): bytt mellom egen admin-visning og hvert barns kalender. Valgt profil
  huskes på enheten.

### Admin (voksne, desktop og mobil)

- **Oversikt:** velg år og «Ny julekalender». Ett kort per barn med sett, status, antall trinn, brikker per dag,
  og lenker til manualer, fordeling, tema og bilder, pakkeliste og historikk.
- **Manualer:** last opp en eller flere PDF-er og velg rekkefølgen på heftene. Hvert hefte har en fremdriftslinje
  mens AI-en leser. AI-en kjenner igjen settnummeret. Under «Ønsker til fordelingen» velger du antall luker
  (standard 24), om dagene skal ha likt antall brikker eller likt antall trinn, og skriver eventuelle ønsker i
  fritekst («Minifiguren dag 1»). Til høyre vises det AI-en har funnet: antall trinn og listen «Skjules for
  barnet», der hvert punkt har en hake. Når alle heftene er lest, lages førsteutkastet automatisk.
  Antall luker er alltid 24 (luke *n* = *n*. desember). Feltet «Antall luker» i skissen utgår.
- **Fordeling:** dag 1–24 med trinn, brikketall og varsler («midt på side», «få brikker»). For valgt dag vises
  sidene med utsnittene som tilhører dagen, mens deler som hører til andre dager eller er skjult, er grået ut.
  Knappene er «Flytt trinn til neste/forrige dag» og «Skjul et område…» (tegn et rektangel på siden). Her finnes
  også pakkelisten for dagen, listen over det som er skjult for barnet, kontrollen av at alle brikkene i
  delelisten er fordelt, og knappen «Godkjenn» (se Godkjenning). Status viser om det finnes endringer som
  barnet ikke ser ennå.
- **Juster med AI (samtale):** fordelingen til venstre, der dager som berøres av forslaget er markert med før og
  etter. Samtalen er til høyre. AI-en svarer med tekst og et forslagskort, og ingenting endres før en voksen
  trykker «Bruk endringene». Samtalen gjelder én kalender (ett barn) og lagres.
- **Tema og lukebilder:** temanavn (kun for voksne), farger og et felt for ønsker til AI-en. Under er et rutenett
  med 24 lukebilder. Hver luke har en lås øverst til høyre, og for valgt luke finnes «Ny AI-variant» og «Last opp
  eget bilde». Knappen «Lag alle bilder som ikke er låst på nytt».
- **Historikk:** en liste over versjoner med hvem (eller «AI, bestilt av …»), når, hva, og knappene «Se
  endringen» og «Gjenopprett».

## Hvordan det virker

### Manualer og sider

1. PDF-ene lastes opp til Storage under en sti bare voksne kan lese.
2. En Cloud Function rendrer hver side til et bilde (PNG eller WebP, høy nok oppløsning til å lese brikkebokser).
3. Hver side sendes til Gemini med et JSON-skjema (strukturert output) som beskriver:
   - sidetype (forside, instruksjon, deleliste, reklame, annet)
   - byggetrinn på siden: trinnummer, avgrensningsboks og brikkene i trinnets brikkeboks (antall og beskrivelse,
     farge)
   - områder som avslører settet (forhåndsvisning av ferdig modell eller delbygg) med avgrensningsboks
4. Svarene valideres med zod og lagres. Fremdriften vises i admin.

Trinnummereringen starter på nytt i noen hefter (delbygg). Byggeren lager derfor en global rekkefølge ut fra
heftenummer, side og posisjon, ikke ut fra det trykte tallet alene.

### Fordeling

- **Førsteutkastet** lages av kode, ikke av AI alene. Trinnene ligger i global rekkefølge og deles i 24
  sammenhengende grupper som balanserer brikketall (eller trinntall, etter valget), med straff for å dele en
  side midt i. Fritekst-ønskene sendes til Gemini, som oversetter dem til begrensninger (for eksempel «trinn X
  på dag 1»). Koden respekterer så begrensningene.
- **Samtalen:** Gemini får fordelingen, trinnlisten og meldingen, og svarer med tekst pluss en liste av
  strukturerte operasjoner, for eksempel `moveStep`, `hideRegion`, `showRegion` og `setDayBoundary`. Koden
  validerer operasjonene og viser resultatet som et forslag. Først ved «Bruk endringene» blir de en ny versjon.
- **Utklipp for barnet:** for hver dag lages ferdige bilder i Storage: ett per utsnitt, der skjulte områder er
  dekket over. Barnet laster bare disse, aldri PDF-en eller hele sider. Admin trenger forhåndsvisning av
  utklippene før godkjenning. De publiserte utklippene for barnet skrives ved godkjenning. Lego-ens eget trinnummer i bildet får stå (det er en del av bildet).
- **Pakkeliste:** summen av brikkene i trinnene for dagen. AI-ens brikketall sammenlignes med delelisten bakerst i
  heftet, og avvik vises som varsel i admin.

### Tema og lukebilder

- Gemini lager temaet: navn, farger og en stil-beskrivelse. Det skjer ut fra de voksnes ønsker og barnets navn,
  **uten noe innhold fra manualene** (ingen settnavn, bilder eller sider). Det sikrer at temaet ikke røper settet.
- Lukebildene lages med Geminis bildemodell i EU, ett per luke, i temaets stil og uten tekst. Eget bilde kan
  lastes opp i stedet.
- Bildene lagres uforanderlig (ny fil per variant), slik at gamle versjoner fortsatt viser riktige bilder.

### Låser

Låsen gjelder bare **lukebildet**. En låst luke får ikke nytt bilde, verken fra «Ny AI-variant», «Lag alle
bilder som ikke er låst på nytt» eller et nytt tema. Innholdet bak luken (trinn og utsnitt) er ikke låst og kan
flyttes som vanlig. Et opplastet eget bilde låses automatisk (byggerens valg, kan slås av).

### Versjoner og historikk

- Kalenderens redigerbare tilstand (fordeling, skjulte områder, tema, lukebilder og låser) lagres som
  versjoner. Hver versjon har nummer, forfatter (voksen eller «AI, bestilt av»), tidspunkt og en kort
  beskrivelse.
- Gjeldende versjon er den nyeste. «Gjenopprett» kopierer en gammel versjon inn som en ny versjon.
- Barnets fremdrift (åpnet, ferdig bygget) er **ikke** en del av versjonene og rulles aldri tilbake.

### Godkjenning (publisering)

- «Godkjenn» gjør gjeldende versjon til den **publiserte** versjonen for barnet. Først da lages og skrives
  utklippene og barnedataene som barnet kan lese. Alt det voksne og AI-en gjør etterpå, ligger i versjonene til
  neste godkjenning.
- Alle dager kan endres når som helst, også dager barnet har åpnet, for å rette opp instrukser som ikke stemmer
  med brikkene. Etter ny godkjenning ser barnet den rettede luken. Fremdriften (åpnet, ferdig) beholdes.
- Gjenoppretting av en gammel versjon følger samme regel: den blir gjeldende versjon, men barnet ser den først
  etter godkjenning.
- Admin viser om publisert versjon er eldre enn gjeldende («Endringer ikke godkjent»).
- Kravet om godkjenning gjelder tema og lukebilder også: barnet ser bare godkjente bilder og farger.

### Barnets fremdrift og profilbytte

- Per luke lagres `openedAt` og `completedAt`, sammen med hvem som faktisk gjorde det (`actorUid`). Når en voksen
  bruker barnets profil, skrives fremdriften som barnets, med den voksne som `actorUid`.
- «Neste luke» bruker fremdriften. «Dagens» og låst bestemmes av datoen.

### Tilgang og sikkerhet

- **Firestore:** julekalenderen får egen samling på toppnivå. Bare voksne kan lese og skrive admin-data
  (manualer, analyse, versjoner, samtale). Barnet kan lese sin egen kalenders barnedata: tema-farger,
  lukebilder, og per dag bare listen over utklipp for dager som er åpnet etter dato. Barnet kan skrive bare sin
  egen fremdrift.
- **Storage:** dagens regel («alt for alle medlemmer») strammes inn. Manualer og sidebilder er bare for voksne.
  Utklippene for dag *n* kan bare leses av barnet (og voksne) når `request.time` er etter 00.00 Oslo-tid den
  *n*. desember. Lukebildene kan barnet alltid lese.
- Datogrensen håndheves i reglene, ikke bare i klienten. Regeltester dekker: barn ser ikke admin-data, barn ser
  ikke fremtidige utklipp, barn ser ikke det andre barnets kalender, og voksne ser alt.
- Gemini kalles bare fra Cloud Functions, som sjekker at kalleren er voksen.

### PWA

`apps/web` får web-app-manifest og ikoner, slik at siden kan legges på hjemskjermen på iOS og Android.
Offline-støtte er ikke et krav.

## Avgjort av Claude (kan overstyres)

- Alltid 24 luker, ingen valgfri størrelse.
- Barna kan se sine egne kalendere fra tidligere år, med alle lukene åpne. I barnevisningen trengs ingen
  årsvelger før det finnes mer enn én kalender per barn.
- Et opplastet eget lukebilde låses automatisk.
- Lego-ens trykte trinnummer i utklippet får stå.
- Førsteutkastet lages av kode med AI-tolkede ønsker som begrensninger, ikke av AI alene.

## Overlates til byggeren

- Nøyaktig Firestore-struktur og feltnavn. De skal dokumenteres i `docs/datamodel.md` og `packages/shared`.
- Rendring av PDF i Cloud Functions (bibliotek), bildeformat og oppløsning.
- Valg av Gemini-modeller og prompt, så lenge strukturert output og EU-region brukes.
- Algoritmen for førsteutkastet, så lenge den oppfyller kravene over.
- Nissens animasjon (CSS, Lottie eller lignende) og visuell finish innenfor skissene.
- Oppdeling i leveranser mot fristen (admin og pakkeliste først, deretter tema, bilder og barnevisning).
