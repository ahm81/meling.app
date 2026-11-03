# Julekalender del 1: admin, AI-analyse, fordeling og pakkeliste – implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De voksne kan opprette en julekalender per barn, laste opp Lego-manualer, få et AI-laget førsteutkast til fordeling på 24 dager, justere den direkte, se historikk og gjenopprette, og skrive ut pakkeliste per dag.

**Architecture:** All forretningslogikk som kan testes uten nettverk (trinnrekkefølge, fordeling, operasjoner, pakkeliste, utklippsstier) er rene funksjoner i `firebase/functions/src/julekalender/` med vitest. Cloud Functions (Firestore-triggere og callables i `europe-west1`) rendrer PDF-sider med `mupdf`, analyserer dem med Gemini (Vertex AI, `@google/genai`) bak et utbyttbart grensesnitt, og skriver alle endringer i fordelingen som nye versjoner. Webappen (React) har admin-sider som leser Firestore direkte og kaller callables for endringer.

**Tech Stack:** pnpm/Turborepo, TypeScript 7, zod 4, Firebase (Auth, Firestore `eur3`, Storage, Functions v2), `@google/genai` (Vertex AI), `mupdf` (WASM), `sharp`, React 19 + `react-router` 7, vitest 5, `@firebase/rules-unit-testing`.

**Spec:** `docs/superpowers/specs/2026-11-03-julekalender-design.md`

**Omfang:** Dette er del 1 av 3, og den skal være ferdig rundt 22. november. Del 2 tar AI-samtalen, godkjenning/publisering, barnevisningen, profilbytte, PWA og Apple-innlogging. Del 3 tar tema, lukebilder og låser. Del 1 må ikke bygge noe av det, men datamodellen her må tåle det: versjonene får et `theme`-felt i del 3, og godkjenning legger `publishedVersion` på kalenderen i del 2.

## Global Constraints

- Firebase-prosjekt `meling-app`. Functions-region `europe-west1`, Node 22, ESM, bundles med tsup. `@meling/shared` importeres via tsconfig-`paths` og må ikke bli en npm-avhengighet i functions.
- Gemini: Vertex AI via `@google/genai` med `vertexai: true`, `project: "meling-app"`, `location: "global"` (tillatt av Amund når modellen ikke finnes i EU). Ingen API-nøkler. Repoet er offentlig, så kjør `grep -rn AIza` før hver commit.
- Alltid 24 luker. Luke *n* = *n*. desember, tidssone Europe/Oslo.
- Admin er bare for voksne (`members/{uid}.role == "adult"`). Barn har ingen tilgang til noe i denne planen.
- Fordelingen endres aldri av AI uten at en voksen har bedt om det. Unntaket er det automatiske førsteutkastet (versjon 1). Alle endringer blir en ny versjon. Gjenoppretting kopierer en gammel versjon inn som en ny versjon.
- Endringer i datamodellen oppdateres samtidig i `packages/shared`, `firebase/firestore.rules`, regeltestene og `docs/datamodel.md` (CLAUDE.md). Swift-modeller (`MelingCore`) trengs ikke for julekalenderen i år.
- UI-tekst er på norsk (bokmål). Kode, identifikatorer og kodekommentarer er på engelsk, som i resten av repoet.
- Avgrensningsbokser lagres normalisert som `{ x, y, w, h }` i intervallet 0–1 relativt til sidebildet. Gemini returnerer `box_2d: [ymin, xmin, ymax, xmax]` i 0–1000, og det konverteres ved innlesing.

## Review Focus

1. **Trinn uten brikkeboks.** Monteringstrinn som slår sammen delbygg (f.eks. trinn 88 og 103 i 60192) har ingen brikkeboks. De skal analyseres som trinn med `parts: []`, telle 0 brikker og likevel fordeles. Test: `distribute` med nullbrikke-trinn i Task 4, og `toPageAnalysis` med tom `parts` i Task 6.
2. **Trinnummer som starter på nytt.** Hefte 1 av 60192 starter på trinn 1 flere ganger (delbygg), og hefte 2 fortsetter på 44. Global rekkefølge må komme fra heftenes rekkefølge, sidenummer og plassering på siden, ikke fra trykt nummer. Test: `orderSteps` i Task 4.
3. **Færre enn 24 trinn eller en ødelagt PDF.** Skal gi tydelig status `error` med norsk melding på manualen eller kalenderen, ikke et krasj eller en evig «leser …». Test: `distribute` kaster `TooFewStepsError` (Task 4), og pipeline setter `status: "error"` (Task 7).
4. **Amund og Ingjerd redigerer samtidig.** En endring basert på en utdatert versjon skal avvises med beskjed om å laste på nytt, ikke overskrive den andres. Test: `applyPlanEdit` med feil `baseVersion` i Task 8.
5. **Flytt som bryter rekkefølgen.** En dag skal alltid være en sammenhengende rekke trinn i global rekkefølge. Å flytte et trinn fra midten av en dag, eller til en dag som ikke er nabo, skal avvises med forklaring. Test: `applyOps` i Task 5.

---

## Filstruktur

```
packages/shared/src/
  models.ts                         # + role på MemberDoc
  collections.ts                    # + julekalender-stier
  julekalender.ts                   # NY: zod-skjemaer for kalender, manual, side, trinn, plan, versjon, operasjoner
  julekalender.test.ts              # NY
  julekalender-order.ts (+ .test)   # NY: global trinnrekkefølge (brukes av functions og web)
  julekalender-packing.ts (+ .test) # NY: pakkeliste og avstemming mot deleliste (functions og web)
firebase/
  firestore.rules                   # + isAdult(), julekalender-blokk
  storage.rules                     # strammes inn: julekalender/ bare for voksne
  tests/firestore.rules.test.ts     # + rolle- og julekalendertester
  tests/storage.rules.test.ts       # NY
  admin/add-member.ts               # + --role
  functions/src/
    index.ts                        # eksporterer julekalender-funksjonene
    julekalender/
      distribute.ts, distribute.test.ts
      ops.ts, ops.test.ts           # applyOps (ren)
      cutouts.ts, cutouts.test.ts   # utklippsstier og masker (ren) + render med sharp
      gemini.ts                     # AI-klient bak grensesnitt, med fake
      analysis.ts, analysis.test.ts # Gemini-svar -> PageAnalysis, ønsker -> begrensninger
      pdf.ts                        # mupdf: PDF -> PNG-sider
      pipeline.ts                   # trigger: manual opprettet -> render, analyse, førsteutkast
      versions.ts, versions.emulator.test.ts # skrive versjon i transaksjon, baseVersion-sjekk
      callables.ts                  # editPlan, restoreVersion, redraft
apps/web/src/
  main.tsx, App.tsx                 # router og innlogging/rollesjekk
  julekalender/admin/
    Overview.tsx, ManualsPage.tsx, PlanPage.tsx, DayDetail.tsx,
    RegionPicker.tsx, PackingListPrint.tsx, HistoryPage.tsx, useCalendar.ts, api.ts
scripts/setup-github-deploy.sh      # + Vertex AI-API og aiplatform.user for runtime-kontoen
docs/datamodel.md, CLAUDE.md
```

---

### Task 1: Roller på medlemmer

**Files:**
- Modify: `packages/shared/src/models.ts`, `packages/shared/src/models.test.ts`
- Modify: `firebase/admin/add-member.ts`
- Modify: `firebase/firestore.rules`, `firebase/tests/firestore.rules.test.ts`
- Modify: `docs/datamodel.md`

**Interfaces:**
- Produces: `MemberRole = z.enum(["adult", "child"])`. `MemberDoc` får `role: MemberRole`. Firestore-regelfunksjonen `isAdult()`. Kommandoen `pnpm add-member --email <e> --name <n> --role adult|child [--emulator]`.

- [ ] **Step 1: Skriv feilende tester**

I `models.test.ts`: `MemberDoc.parse({displayName:"Ida", email:"ida@example.com", role:"child"})` lykkes, og `role:"admin"` kaster.

I `firestore.rules.test.ts`: seed `amund` med `role:"adult"` og `ida` med `role:"child"`. Testen `"denies a member changing their own role"`: `ida` gjør `updateDoc(... {role:"adult"})` → `assertFails`.

- [ ] **Step 2: Kjør og se at de feiler**

Kjør: `pnpm --filter @meling/shared test && pnpm test:rules`
Forventet: modelltesten feiler på `role`. Regeltesten for rolle kan allerede passere, fordi dagens regel bare tillater `displayName`. Det er greit.

- [ ] **Step 3: Implementer**

- Legg til `role` i `MemberDoc` og eksporter `MemberRole`.
- `add-member.ts`: nytt påkrevd argument `--role` (`adult` eller `child`), som skrives på dokumentet. Oppdater brukskommentaren øverst.
- `firestore.rules`: `function isAdult() { return isMember() && get(/databases/$(database)/documents/members/$(request.auth.uid)).data.role == "adult"; }`.
- `docs/datamodel.md`: `role` i tabellen og `--role` i eksemplene.

- [ ] **Step 4: Kjør testene**

Kjør: `pnpm --filter @meling/shared test && pnpm test:rules`
Forventet: PASS.

- [ ] **Step 5: Commit**

`git commit -m "Add adult/child roles to members"`

Merk for utrulling (ikke kode): eksisterende `members/loq3DiMBpAXv7p2KY4titOrTcxv2` (Amund) mangler `role`. Etter deploy kjøres `pnpm add-member --email <amunds e-post> --name Amund --role adult` på nytt. Dette er en produksjonsendring, så spør brukeren før den kjøres.

---

### Task 2: Delte skjemaer og stier for julekalenderen

**Files:**
- Create: `packages/shared/src/julekalender.ts`, `packages/shared/src/julekalender.test.ts`
- Modify: `packages/shared/src/collections.ts`, `packages/shared/src/index.ts`

**Interfaces:**
- Produces (alle eksportert fra `@meling/shared`):
  - `DOOR_COUNT = 24`
  - `Bbox = z.object({ x, y, w, h })`. Alle er tall i [0,1], og `x+w <= 1` og `y+h <= 1` (`refine`).
  - `Part = z.object({ qty: z.int().min(1), name: z.string().min(1), color: z.string() })`
  - `PageKind = z.enum(["cover", "instructions", "inventory", "other"])`
  - `PageAnalysis = z.object({ kind: PageKind, steps: z.array(z.object({ printedNumber: z.int().min(1), bbox: Bbox, parts: z.array(Part) })), spoilers: z.array(z.object({ bbox: Bbox, label: z.string() })), inventory: z.array(Part) })`
  - `Step = z.object({ id: z.string(), manualId: z.string(), manualOrder: z.int(), page: z.int().min(1), index: z.int().min(0), printedNumber: z.int(), bbox: Bbox, parts: z.array(Part), brickCount: z.int().min(0) })`. Id-formatet er `${manualId}:${page}:${index}` (`stepId(manualId, page, index)`).
  - `Hidden = z.object({ id: z.string(), manualId: z.string(), page: z.int(), bbox: Bbox.nullable(), label: z.string(), source: z.enum(["ai", "adult"]) })`. `bbox: null` betyr hele siden.
  - `Plan = z.object({ days: z.array(z.object({ stepIds: z.array(z.string()) })).length(DOOR_COUNT), hidden: z.array(Hidden) })`
  - `PlanOp = z.discriminatedUnion("type", [ {type:"moveStep", stepId, toDay: z.int().min(1).max(24)}, {type:"hide", hidden: Hidden}, {type:"show", hiddenId: z.string()} ])`
  - `VersionAuthor = z.discriminatedUnion("kind", [ {kind:"adult", uid}, {kind:"ai", requestedBy: z.string().nullable()} ])`
  - `VersionDoc = z.object({ number: z.int().min(1), createdAt: z.date(), author: VersionAuthor, summary: z.string().max(200), plan: Plan, restoredFrom: z.int().nullable() })`
  - `Wishes = z.object({ balance: z.enum(["bricks", "steps"]), text: z.string().max(1000) })`
  - `CalendarDoc = z.object({ year: z.int().min(2024), childUid: z.string(), childName: z.string(), wishes: Wishes, currentVersion: z.int().nullable(), draft: z.enum(["waiting", "running", "done", "error"]), draftError: z.string().nullable(), createdBy: z.string() })`
  - `ManualDoc = z.object({ order: z.int().min(1), fileName: z.string(), storagePath: z.string(), status: z.enum(["uploaded", "rendering", "analyzing", "done", "error"]), pageCount: z.int().nullable(), pagesAnalyzed: z.int(), setNumber: z.string().nullable(), error: z.string().nullable() })`
  - `PageDoc = z.object({ manualId, page, imagePath: z.string(), width: z.int(), height: z.int(), analysis: PageAnalysis.nullable() })`
  - Stier i `collections.ts` (`Collections.julekalender = "julekalender"`):
    - `paths.calendar(calId)` → `julekalender/${calId}`
    - `paths.manual(calId, manualId)` → `julekalender/${calId}/manuals/${manualId}`
    - `paths.page(calId, manualId, page)` → `julekalender/${calId}/pages/${manualId}_${page}`
    - `paths.version(calId, n)` → `julekalender/${calId}/versions/${String(n).padStart(6,"0")}`
  - Storage-stier i `storagePaths` (ny eksport):
    - `manualPdf(calId, manualId)` → `julekalender/${calId}/manuals/${manualId}.pdf`
    - `pageImage(calId, manualId, page)` → `julekalender/${calId}/pages/${manualId}/${page}.png`
    - `cutout(calId, stepId, maskKey)` → `julekalender/${calId}/cutouts/${stepId}/${maskKey}.webp`
  - Kalender-id: `${year}-${childUid}` (`calendarId(year, childUid)`).

- [ ] **Step 1: Skriv feilende tester** i `julekalender.test.ts`:
  - `"Plan requires exactly 24 days"`: 23 dager → kaster.
  - `"Bbox rejects boxes outside the page"`: `{x:0.9,y:0,w:0.2,h:0.1}` → kaster.
  - `"paths.version pads the number so versions sort"`: `paths.version("c",7) === "julekalender/c/versions/000007"`.
  - `"stepId and calendarId formats"`: `stepId("m1",3,0) === "m1:3:0"` og `calendarId(2026,"u1") === "2026-u1"`.
- [ ] **Step 2: Kjør** `pnpm --filter @meling/shared test`. Forventet: FAIL (moduler finnes ikke).
- [ ] **Step 3: Implementer** skjemaene og stiene over. Eksporter fra `index.ts`.
- [ ] **Step 4: Kjør** `pnpm --filter @meling/shared test && pnpm typecheck`. Forventet: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add shared julekalender schemas and paths"`

---

### Task 3: Tilgangsregler for julekalenderens admin-data

**Files:**
- Modify: `firebase/firestore.rules`, `firebase/storage.rules`
- Modify: `firebase/tests/firestore.rules.test.ts`
- Create: `firebase/tests/storage.rules.test.ts`
- Modify: `docs/datamodel.md` (seksjonene Julekalender og Storage)

**Interfaces:**
- Consumes: `isAdult()` (Task 1), stiene fra Task 2.
- Produces regler:
  - `julekalender/{calId}`: les for voksne. Opprett for voksne bare når `request.resource.data.currentVersion == null` og `draft == "waiting"`. Oppdater for voksne bare feltene `wishes` og `childName`. Slett: aldri.
  - `julekalender/{calId}/manuals/{manualId}`: les for voksne. Opprett for voksne med `status == "uploaded"`. Oppdater og slett: aldri fra klient.
  - `julekalender/{calId}/pages/{id}` og `versions/{id}`: les for voksne. Skriv: aldri fra klient (bare functions).
  - Storage `julekalender/{calId}/manuals/{file}`: skriv for voksne når `contentType == "application/pdf"` og størrelsen er under 50 MB. Les for voksne.
  - Storage `julekalender/{calId}/{rest=**}`: les for voksne. Skriv: ingen.
  - Storage, alt annet: som før (medlemmer).
  - Storage-regler kan ikke kalle `isAdult()` fra Firestore-reglene. Bruk `firestore.get(/databases/(default)/documents/members/$(request.auth.uid)).data.role == "adult"`.

- [ ] **Step 1: Skriv feilende tester**

`firestore.rules.test.ts`, ny `describe("julekalender")` med seed: `amund` er adult, `ida` er child, og kalenderen `2026-ida` finnes.
- `"adults read calendars"`: amund → succeeds.
- `"children cannot read calendars"`: ida → fails.
- `"adults create a calendar in waiting state"`: amund oppretter `2026-julian` med `currentVersion:null, draft:"waiting"` → succeeds.
- `"adults cannot write versions"`: amund `setDoc` på `paths.version("2026-ida",1)` → fails.
- `"adults may only change wishes and childName"`: amund oppdaterer `currentVersion:5` → fails.
- `"adults create manuals only as uploaded"`: `status:"done"` → fails, `status:"uploaded"` → succeeds.

`storage.rules.test.ts`, med `initializeTestEnvironment({ storage: { rules }, firestore: { rules } })` og samme seed:
- `"adults upload a PDF manual"`: amund `uploadBytes` til `storagePaths.manualPdf(...)` med `contentType:"application/pdf"` → succeeds.
- `"rejects non-PDF manuals"`: `image/png` → fails.
- `"children cannot read page images"`: ida `getBytes(pageImage)` → fails.
- `"members still use other paths"`: ida skriver `other/x.txt` → succeeds.

- [ ] **Step 2: Kjør** `pnpm test:rules`. Forventet: de nye testene feiler.
- [ ] **Step 3: Implementer** reglene. Legg storage-testfilen til i vitest-`include` (mønsteret `*.test.ts` dekker den allerede).
- [ ] **Step 4: Kjør** `pnpm test:rules`. Forventet: PASS (alle, også de gamle).
- [ ] **Step 5: Commit** `git commit -m "Restrict julekalender data to adults"`

---

### Task 4: Trinnrekkefølge, fordeling og pakkeliste (ren logikk)

**Files:**
- Create: `packages/shared/src/julekalender-order.ts`, `packages/shared/src/julekalender-packing.ts` med tester (eksporteres fra `index.ts`; web trenger dem i Task 11)
- Modify: `firebase/functions/package.json`: legg til `vitest` i devDependencies og `"test": "vitest run"`.
- Create: `firebase/functions/src/julekalender/distribute.ts`, `distribute.test.ts`

**Interfaces:**
- Consumes: `Step`, `Plan`, `Part`, `PageAnalysis`, `DOOR_COUNT`, `stepId` fra `@meling/shared`.
- Produces:
  - `orderSteps(pages: { manualId: string; manualOrder: number; page: number; analysis: PageAnalysis }[]): Step[]`. Rekkefølgen er etter `manualOrder`, så `page`, så leserekkefølge på siden: venstre kolonne før høyre når boksene ikke overlapper horisontalt, ellers topp før bunn. `brickCount` er summen av `qty`. `index` er posisjonen i leserekkefølgen på siden.
  - `class TooFewStepsError extends Error` med melding `"Manualene har bare ${n} byggetrinn. Det trengs minst 24."`
  - `type Constraint = { kind: "stepOnDay"; stepId: string; day: number } | { kind: "stepLast"; stepId: string }`
  - `distribute(steps: Step[], opts: { balance: "bricks" | "steps"; constraints: Constraint[] }): Plan["days"]`
  - `packingList(steps: Step[], stepIds: string[]): { name: string; color: string; qty: number }[]`. Slår sammen på `(name, color)` og sorterer etter farge, så navn.
  - `reconcile(steps: Step[], inventory: Part[]): { name: string; color: string; expected: number; distributed: number }[]`. Returnerer bare linjene der tallene avviker.

- [ ] **Step 1: Skriv feilende tester**
  - `julekalender-order.test.ts` (shared), `"orders by manual, page, then left-to-right columns"`: hefte 2 (`manualOrder:2`) side 1 og hefte 1 side 5 med to trinn, venstre `{x:0.05,...}` og høyre `{x:0.55,...}`. Forventet id-rekkefølge: `["m1:5:0","m1:5:1","m2:1:0"]`, uavhengig av `printedNumber` (bruk trykte tall `44, 1, 2` for å bevise det).
  - `julekalender-order.test.ts` (shared), `"counts bricks and allows steps without parts"`: et trinn med `parts: []` → `brickCount: 0`.
  - `distribute.test.ts`, `"balances bricks over 24 contiguous days"`: 48 trinn med 3 brikker hver → hver dag får 2 trinn, og alle trinn er brukt nøyaktig én gang i rekkefølge.
  - `distribute.test.ts`, `"keeps zero-brick steps with a neighbour"`: 30 trinn der trinn 10 har 0 brikker → ingen dag består bare av nullbrikke-trinn.
  - `distribute.test.ts`, `"avoids splitting a page when the cost is equal"`: 26 trinn der trinn 5 og 6 står på samme side og det er like dyrt å dele før trinn 5 som mellom 5 og 6 → 5 og 6 havner på samme dag.
  - `distribute.test.ts`, `"honours stepOnDay"`: begrensningen `stepOnDay` for trinn 1 på dag 1 er alltid oppfylt. `stepOnDay` for trinn 40 av 48 på dag 24 → trinn 40–48 havner på dag 24.
  - `distribute.test.ts`, `"throws TooFewStepsError below 24 steps"`.
  - `julekalender-packing.test.ts` (shared), `"merges equal parts"`: to trinn med `{qty:2,name:"Plate 2x4",color:"mørkeblå"}` → én linje med `qty:4`.
  - `julekalender-packing.test.ts` (shared), `"reconcile reports only differences"`: delelisten sier 6, fordelingen har 5 → én linje `{expected:6, distributed:5}`.
- [ ] **Step 2: Kjør** `pnpm test`. Forventet: FAIL.
- [ ] **Step 3: Implementer.** For `distribute`: dynamisk programmering over grensene mellom 24 sammenhengende grupper. Målet er å minimere summen av `(vekt(dag) − snitt)²`, der vekt er brikker eller trinn etter `balance`. Legg til en fast straff (`PAGE_SPLIT_PENALTY = 0.25 * snitt²`) for hver grense som deler en side. En dag med vekt 0 er ugyldig. Begrensninger håndheves ved å bare tillate grenser som oppfyller dem. Hvis det ikke finnes noen gyldig fordeling, kastes `Error("Ønskene kan ikke oppfylles samtidig.")`.
- [ ] **Step 4: Kjør** `pnpm test`. Forventet: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add step ordering, distribution and packing list"`

---

### Task 5: Operasjoner på fordelingen og utklippsmasker (ren logikk)

**Files:**
- Create: `firebase/functions/src/julekalender/ops.ts`, `ops.test.ts`, `cutouts.ts` (bare de rene delene i denne tasken), `cutouts.test.ts`

**Interfaces:**
- Consumes: `Plan`, `PlanOp`, `Step`, `Hidden`, `storagePaths.cutout`.
- Produces:
  - `class InvalidOpError extends Error` (norsk melding).
  - `applyOps(plan: Plan, steps: Step[], ops: PlanOp[]): Plan`. `moveStep` er bare lov for første trinn på en dag (til dagen før) eller siste trinn (til dagen etter). Dagen som trinnet flyttes fra, kan ikke bli tom. `hide` legger til (id-en må være ny). `show` fjerner (id-en må finnes). Funksjonen er ren og endrer ikke input.
  - `maskFor(step: Step, hidden: Hidden[]): Bbox[]`. Gir de skjulte boksene (eller hele siden) som overlapper trinnets boks, i koordinater relativt til trinnets boks.
  - `maskKey(masks: Bbox[]): string`. Gir `"none"` hvis tom, ellers de første 12 hex-tegnene av sha256 over avrundede koordinater (3 desimaler).

- [ ] **Step 1: Skriv feilende tester**
  - `"moves the last step of a day to the next day"`: dag 5 `[a,b,c]`, dag 6 `[d]`. Flytt `c` til 6 → dag 5 `[a,b]`, dag 6 `[c,d]`.
  - `"rejects moving a middle step"`: flytt `b` → `InvalidOpError` med melding som inneholder `"bare første eller siste trinn"`.
  - `"rejects emptying a day"`: dag 6 `[d]`, flytt `d` til 5 → `InvalidOpError`.
  - `"rejects moving to a non-adjacent day"`.
  - `"hide then show round-trips"`.
  - `"maskFor converts a page box into step-relative coordinates"`: trinnets boks er `{x:0.5,y:0,w:0.5,h:0.5}`, skjult boks `{x:0.5,y:0,w:0.25,h:0.25}` → `[{x:0,y:0,w:0.5,h:0.5}]`.
  - `"maskKey is stable and none for no masks"`.
- [ ] **Step 2: Kjør** `pnpm --filter @meling/functions test`. Forventet: FAIL.
- [ ] **Step 3: Implementer** funksjonene over.
- [ ] **Step 4: Kjør**. Forventet: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add plan operations and cutout masks"`

---

### Task 6: Gemini-klient og tolkning av sider og ønsker

**Files:**
- Modify: `firebase/functions/package.json`: legg til `@google/genai`.
- Create: `firebase/functions/src/julekalender/gemini.ts`, `analysis.ts`, `analysis.test.ts`

**Interfaces:**
- Produces:
  - `interface Ai { analyzePage(png: Buffer): Promise<unknown>; interpretWishes(text: string, steps: { id: string; printedNumber: number; manualOrder: number; page: number; parts: Part[] }[]): Promise<unknown> }`
  - `vertexAi(): Ai`. Bruker `new GoogleGenAI({ vertexai: true, project: "meling-app", location: "global" })`, `responseMimeType: "application/json"` og `responseJsonSchema` laget med `z.toJSONSchema` av råskjemaene under. Modellnavnet ligger i én konstant, `GEMINI_MODEL`, i `gemini.ts`.
  - `fakeAi(pages: Record<number, unknown>): Ai`. Brukes i tester og når `process.env.MELING_FAKE_AI === "1"` (emulator).
  - `RawPageAnalysis` (zod): `{ kind, steps: [{ printed_number, box_2d: [ymin,xmin,ymax,xmax] (0–1000), parts: [{qty,name,color}] }], spoilers: [{ box_2d, label }], inventory: [{qty,name,color}], set_number: string|null }`
  - `toPageAnalysis(raw: unknown): { analysis: PageAnalysis; setNumber: string | null }`. Validerer, konverterer `box_2d` til `Bbox`, klemmer verdier til [0,1] og dropper bokser med areal 0.
  - `toConstraints(raw: unknown, knownStepIds: Set<string>): Constraint[]`. Dropper ukjente id-er i stedet for å feile.
  - Prompt-tekstene ligger som konstanter i `gemini.ts`. Side-prompten ber om: sidetype, hvert nummererte byggetrinn med boks som omslutter både tegningen og brikkeboksen, brikker fra brikkeboksen (tomt hvis ingen), og områder som viser ferdig modell eller forhåndsvisning av et delbygg som spoilere. Den ber også om settnummer hvis det står på forsiden.
- [ ] **Step 1: Skriv feilende tester** i `analysis.test.ts`:
  - `"converts box_2d to normalized bbox"`: `[100,200,600,700]` → `{x:0.2,y:0.1,w:0.5,h:0.5}`.
  - `"accepts steps without parts"`.
  - `"drops zero-area boxes and clamps out-of-range values"`.
  - `"rejects malformed AI output"`: `kind:"banana"` → kaster.
  - `"toConstraints ignores unknown step ids"`.
- [ ] **Step 2: Kjør**. Forventet: FAIL.
- [ ] **Step 3: Implementer** `analysis.ts` og `gemini.ts`. `gemini.ts` får ingen enhetstest, siden det bare er nettverk. Det verifiseres i Task 7 mot ekte PDF.
- [ ] **Step 4: Kjør** `pnpm --filter @meling/functions test && pnpm typecheck`. Forventet: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add Gemini client and analysis parsing"`

---

### Task 7: Pipeline for manualer: render, analyse og førsteutkast

**Files:**
- Modify: `firebase/functions/package.json`: legg til `mupdf`.
- Create: `firebase/functions/src/julekalender/pdf.ts`, `pipeline.ts`, `versions.ts`, `versions.emulator.test.ts`, `firebase/functions/vitest.emulator.config.ts` (inkluderer bare `**/*.emulator.test.ts`; `vitest.config.ts` ekskluderer dem)
- Modify: `firebase/functions/src/index.ts`
- Modify: rot-`package.json`: `"test:functions": "firebase emulators:exec --only firestore,storage \"pnpm --filter @meling/functions test:emulator\""`, og functions-pakken får `"test:emulator": "vitest run -c vitest.emulator.config.ts"`. Legg `pnpm test:functions` til i `.github/workflows/js.yml` etter `pnpm test:rules`.
- Modify: `scripts/setup-github-deploy.sh`: slå på `aiplatform.googleapis.com` og gi `roles/aiplatform.user` til `247508425974-compute@developer.gserviceaccount.com`.

**Interfaces:**
- Consumes: Task 2, 4, 5 og 6.
- Produces:
  - `renderPdf(pdf: Buffer, scale = 2): AsyncGenerator<{ page: number; png: Buffer; width: number; height: number }>`. Kaster `Error("Filen kunne ikke leses som PDF.")` ved feil.
  - `writeVersion(db, calId, input: { baseVersion: number | null; author: VersionAuthor; summary: string; plan: Plan; restoredFrom?: number }): Promise<number>`. Kjører i en transaksjon, sjekker at `calendar.currentVersion === baseVersion` (ellers `StaleVersionError` med `"Kalenderen er endret av noen andre. Last siden på nytt."`), skriver `versions/{n+1}` og setter `currentVersion`.
  - Trigger `onManualCreated`: `onDocumentCreated({ document: "julekalender/{calId}/manuals/{manualId}", timeoutSeconds: 540, memory: "2GiB" })`. Den gjør:
    1. status `rendering`, lagre sidebilder i Storage og `pages/`-dokumenter, sett `pageCount`
    2. status `analyzing`, analyser sidene med maks 6 samtidige kall og oppdater `pagesAnalyzed` fortløpende
    3. sett `setNumber` fra første side som har det, og status `done`
    4. hvis alle manualene for kalenderen er `done` og `calendar.draft == "waiting"`: lag førsteutkast
  - Ved feil i et steg: `status: "error"` og `error` med norsk melding. Kast ikke videre (ingen retry).
  - `makeFirstDraft(db, ai, calId)`:
    - sett `draft: "running"` i en transaksjon (gjør ingenting hvis den ikke er `waiting`)
    - kjør `orderSteps`, `toConstraints(await ai.interpretWishes(...))`, `distribute`, og `hidden` = alle spoilere pluss hele sider av typen `cover`, `inventory` og `other` (med `source:"ai"`)
    - `writeVersion` med `author:{kind:"ai", requestedBy:null}`, `summary:"Førsteutkast fra AI"`
    - sett `draft: "done"`. Ved `TooFewStepsError` eller andre feil: `draft: "error"` og `draftError`.
  - `exports.onManualCreated` fra `index.ts`.
- [ ] **Step 1: Skriv feilende tester** i `versions.emulator.test.ts`. Kjøres mot emulatoren med `firebase-admin` via `pnpm test:functions`.
  - `"writes version 1 when currentVersion is null"`.
  - `"rejects a stale baseVersion"`: `currentVersion = 2`, `baseVersion: 1` → `StaleVersionError`.
  - `"makeFirstDraft runs once"`: to samtidige kall med `fakeAi` → nøyaktig én versjon.
  - `"makeFirstDraft records a Norwegian error for too few steps"`: `fakeAi` med 10 trinn → `draft:"error"`, og `draftError` inneholder `"minst 24"`.
- [ ] **Step 2: Kjør** dem. Forventet: FAIL.
- [ ] **Step 3: Implementer** `pdf.ts`, `versions.ts` og `pipeline.ts`. Bruk `mupdf` (`Document.openDocument(buf, "application/pdf")`, `page.toPixmap(Matrix.scale(s,s), ColorSpace.DeviceRGB, false, true).asPNG()`). AI-klienten velges med `process.env.MELING_FAKE_AI === "1" ? fakeAi(...) : vertexAi()`.
- [ ] **Step 4: Kjør** testene. Forventet: PASS.
- [ ] **Step 5: Manuell verifisering mot ekte data.**
  - Krever at `aiplatform.user` er gitt i prosjektet. Det er en produksjonsendring, så spør brukeren før `setup-github-deploy.sh` kjøres.
  - Kjør et lite skript (`firebase/functions/scripts/try-analysis.ts`, ikke en del av deploy) som rendrer `~/Downloads/6242006.pdf` og analyserer side 4–8 med `vertexAi()`.
  - Sjekk at trinn 1–7 kommer ut med fornuftige bokser og brikker.
  - Juster prompten om nødvendig.
  - Skriptet commites, men ikke PDF-ene, som er Legos innhold.
- [ ] **Step 6: Commit** `git commit -m "Add manual pipeline and first draft"`

---

### Task 8: Callables for endringer, gjenoppretting, nytt utkast og utklipp

**Files:**
- Modify: `firebase/functions/package.json`: legg til `sharp`. Modify `pnpm-workspace.yaml`: `allowBuilds: sharp: true`.
- Create: `firebase/functions/src/julekalender/callables.ts`
- Modify: `firebase/functions/src/julekalender/cutouts.ts` (render-del), `firebase/functions/src/julekalender/versions.emulator.test.ts`, `firebase/functions/src/index.ts`

**Interfaces:**
- Consumes: `applyOps`, `writeVersion`, `maskFor`, `maskKey`, `storagePaths.cutout`.
- Produces (alle `onCall` med `europe-west1`). Hver sjekker `request.auth`, og at `members/{uid}.role == "adult"`, ellers `HttpsError("permission-denied")`:
  - `editPlan({ calendarId, baseVersion, ops: PlanOp[], summary }) → { version: number }`. Lager ny versjon med `author:{kind:"adult", uid}`. `InvalidOpError` → `HttpsError("invalid-argument", melding)`. `StaleVersionError` → `HttpsError("failed-precondition", melding)`.
  - `restoreVersion({ calendarId, baseVersion, fromVersion }) → { version: number }`. Kopierer planen, med `summary: "Gjenopprettet versjon ${fromVersion}"` og `restoredFrom`.
  - `redraft({ calendarId, baseVersion }) → { version: number }`. Kjører fordelingen på nytt med nåværende `wishes` og skriver den som en ny versjon (`author:{kind:"ai", requestedBy:uid}`).
  - `renderCutouts({ calendarId, version }) → { cutouts: Record<stepId, string> }`. Lager manglende utklipp for alle trinn i versjonen: beskjær sidebildet til trinnets boks, legg grå rektangler (`#C2C8CC`) over maskene og lagre WebP på `storagePaths.cutout(calId, stepId, maskKey)`. Hopper over utklipp som finnes. Returnerer Storage-stiene.
- [ ] **Step 1: Skriv feilende tester** i `versions.emulator.test.ts`:
  - `"editPlan rejects children"`: kall handleren med `auth.uid = "ida"` (child) → `permission-denied`.
  - `"editPlan applies ops and bumps the version"`.
  - `"restoreVersion copies the old plan as a new version"`: v1 → v2 (endret) → restore 1 gir v3 med v1-planen, og `restoredFrom: 1`.
  - Kall handlerne direkte, for eksempel via `firebase-functions-test` `wrap()`, eller ved å eksportere den rene handleren ved siden av `onCall`.
- [ ] **Step 2: Kjør**. Forventet: FAIL.
- [ ] **Step 3: Implementer** callables og sharp-rendering.
- [ ] **Step 4: Kjør** `pnpm test && pnpm test:functions`. Forventet: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add plan edit, restore, redraft and cutout callables"`

---

### Task 9: Web – ruting, admin-skall og oversikt

**Files:**
- Modify: `apps/web/package.json`: legg til `react-router`.
- Modify: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`
- Create: `apps/web/src/julekalender/admin/Overview.tsx`, `useCalendar.ts`, `api.ts`
- Modify: `apps/web/src/firebase.ts`: legg til `functions = getFunctions(app, "europe-west1")` og emulatoren på port 5001.

**Interfaces:**
- Consumes: `CalendarDoc`, `ManualDoc`, `VersionDoc`, `MemberDoc`, `paths`, `calendarId`.
- Produces:
  - Ruter: `/` (dagens forside), `/julekalender/admin` (Oversikt), `/julekalender/admin/:calId/manualer`, `/julekalender/admin/:calId/fordeling`, `/julekalender/admin/:calId/historikk`, `/julekalender/admin/:calId/pakkeliste`. Admin-rutene vises bare når medlemmet er `adult`. Ellers vises «Denne siden er bare for voksne.»
  - `useCalendar(calId)` → `{ calendar, manuals, currentVersion: VersionDoc | null, loading }` med `onSnapshot`.
  - `api.ts`: `editPlan`, `restoreVersion`, `redraft`, `renderCutouts` som typed `httpsCallable` med de samme signaturene som i Task 8 og `timeout: 120_000`.
  - Oversikt:
    - årsvelger (år som har kalendere, pluss inneværende år)
    - kort per barnekalender med barnets navn, settnummer, status (`draft` og manualstatus) og lenker til Manualer, Fordeling, Pakkeliste og Historikk
    - knappen «Ny julekalender» velger et barn blant `members` med `role == "child"` og oppretter `julekalender/{calendarId(year, childUid)}` med `wishes: {balance:"bricks", text:""}`, `currentVersion:null` og `draft:"waiting"`
    - Krever at voksne kan lese `members` (det kan de allerede).
- [ ] **Step 1: Verifiser utgangspunktet.** `pnpm --filter @meling/web typecheck` er grønn.
- [ ] **Step 2: Implementer** ruting, skall og Oversikt etter skissen «Admin – år og kalendere». Legg til lenken «Julekalender» på forsiden for voksne.
- [ ] **Step 3: Verifiser mot emulatorene.**
  - Start `pnpm emulators` og `pnpm --filter @meling/web dev` med `VITE_USE_EMULATORS=true`.
  - Legg til `amund` (adult) og `julian` (child) med `pnpm add-member ... --emulator`.
  - Logg inn som amund, opprett kalender for Julian 2026 og se kortet med status «Venter på manualer».
  - Logg inn som julian og se at `/julekalender/admin` viser «Denne siden er bare for voksne.»
- [ ] **Step 4: Kjør** `pnpm typecheck && pnpm build`. Forventet: grønt.
- [ ] **Step 5: Commit** `git commit -m "Add julekalender admin overview"`

---

### Task 10: Web – manualer og opplasting

**Files:**
- Create: `apps/web/src/julekalender/admin/ManualsPage.tsx`

**Interfaces:**
- Consumes: `useCalendar`, `storagePaths.manualPdf`, `paths.manual`, `ManualDoc`.
- Produces skjermen fra skissen «Admin – last opp manualer»:
  - stegviser (Last opp → AI leser manualene → Forslag → Godkjenn, der Godkjenn er grå i del 1)
  - slippområde og filvelger for PDF. For hver fil: last opp med `uploadBytesResumable` (vis prosent), og opprett deretter `manuals/{auto-id}` med `order` = neste nummer, `status:"uploaded"`, `pagesAnalyzed:0`, `pageCount:null`, `setNumber:null` og `error:null`
  - liste over manualer med fremdrift: «AI leser side X av Y», «Lest», eller feilmelding i rødt
  - «Ønsker til fordelingen»: `balance` (select) og fritekst. Lagres på kalenderen.
  - «Dette har AI-en funnet» (antall trinn og sider med to trinn) og «Skjules for barnet» (liste over spoilere fra sidene), skrivebeskyttet her
  - banner når `draft` er `running`, `done` (lenke til fordelingen) eller `error` (vis `draftError`)
  - Hvis `currentVersion != null`, er opplasting av flere manualer skjult. Da vises teksten «Fordelingen er laget. Last opp på nytt ved å lage en ny kalender.» (del 1 støtter ikke å bytte manualer).
- [ ] **Step 1: Implementer** siden.
- [ ] **Step 2: Verifiser mot emulatorene** med `MELING_FAKE_AI=1` satt for functions-emulatoren (eksporter i `.env.local` for functions, som er gitignorert). Last opp `6242006.pdf` og `6242011.pdf` og se fremdriften gå til «Lest» og banneret «Førsteutkast klart».
- [ ] **Step 3: Kjør** `pnpm typecheck && pnpm build`. Forventet: grønt.
- [ ] **Step 4: Commit** `git commit -m "Add julekalender manuals page"`

---

### Task 11: Web – fordeling, skjul område og pakkeliste

**Files:**
- Create: `apps/web/src/julekalender/admin/PlanPage.tsx`, `DayDetail.tsx`, `RegionPicker.tsx`, `PackingListPrint.tsx`

**Interfaces:**
- Consumes: `useCalendar`, `api.editPlan`, `api.renderCutouts`, `api.redraft`, `packingList`, `reconcile`, `orderSteps` fra `@meling/shared`. `Step`-listen bygges i klienten med `orderSteps` fra `pages`-dokumentene.
- Produces skjermen fra skissen «Admin – AI-fordeling av trinn»:
  - Dagliste 1–24 med trinnområde (trykte nummer «Trinn 9–11», globalt nummer i tooltip), brikketall og varsel-etiketter: «midt på side» når første trinn deler side med forrige dag, og «få brikker» når dagen har under 50 % av snittet.
  - Dagdetalj: sidebildene for dagens trinn med dagens trinn uthevet, andre dagers trinn grået ut og skjulte områder skravert. Utklippene fra `renderCutouts` vises som «Slik ser barnet det» (forhåndsvisning).
  - Knapper: «Flytt siste trinn til neste dag», «Flytt første trinn til forrige dag» og «Skjul et område …». Sistnevnte åpner `RegionPicker`, der du drar et rektangel på sidebildet og gir det et navn. Hver handling sender `editPlan` med `baseVersion = calendar.currentVersion` og en summary («Flyttet trinn 11 fra dag 5 til dag 6»). Ved `failed-precondition` vises meldingen med knappen «Last på nytt».
  - «Skjult fra barnet»: liste med «Vis likevel», som sender en `show`-operasjon.
  - Pakkeliste for valgt dag og avvikslisten fra `reconcile` («Delelisten sier 6, fordelt 5»).
  - Knappen «Lag nytt AI-forslag» kaller `redraft` etter bekreftelsen «Dette lager en ny versjon. Den gamle kan gjenopprettes fra historikken.»
  - `/pakkeliste`: utskriftsvennlig side (`@media print`) med én seksjon per dag: «Pose N» og brikkene med antall og farge. Ingen bilder av ferdig modell.
- [ ] **Step 1: Implementer** sidene.
- [ ] **Step 2: Verifiser mot emulatorene** med førsteutkastet fra Task 10:
  - flytt et trinn
  - prøv å flytte et midtre trinn (knappen finnes ikke, men test via konsollen at `editPlan` gir norsk feilmelding)
  - skjul et område og se at utklippet blir grått
  - åpne to faner og gjør en endring i hver for å se meldingen om endring fra noen andre
  - skriv ut pakkelisten (forhåndsvisning)
- [ ] **Step 3: Kjør** `pnpm typecheck && pnpm test && pnpm build`. Forventet: grønt.
- [ ] **Step 4: Commit** `git commit -m "Add julekalender plan page and packing list"`

---

### Task 12: Web – historikk, og dokumentasjon

**Files:**
- Create: `apps/web/src/julekalender/admin/HistoryPage.tsx`
- Modify: `docs/datamodel.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `versions`-samlingen (sortert synkende), `api.restoreVersion`.
- Produces:
  - Skjermen fra skissen «Admin – endringshistorikk». Hver versjon har forfatter («Amund», eller «AI, bestilt av Amund» / «AI» for førsteutkastet), tidspunkt, summary, merket «Gjeldende» på den nyeste og «Gjenopprett» på de andre.
  - «Se endringen» viser hvilke dager som har andre trinn enn versjonen før, og hvilke skjulte områder som er lagt til eller fjernet (beregnet i klienten).
  - `docs/datamodel.md` beskriver samlingene, feltene og Storage-stiene fra Task 2–3, og at versjoner bare skrives av functions.
  - `CLAUDE.md` nevner `firebase/functions/src/julekalender/`, `MELING_FAKE_AI` og at Vertex AI brukes uten nøkler.
- [ ] **Step 1: Implementer** siden og dokumentasjonen.
- [ ] **Step 2: Verifiser** i emulatoren: gjenopprett v1 og se at den blir v3, med «Gjenopprettet versjon 1».
- [ ] **Step 3: Kjør** `pnpm typecheck && pnpm test && pnpm build && pnpm test:rules && pnpm test:functions`. Forventet: grønt.
- [ ] **Step 4: Commit** `git commit -m "Add julekalender history and docs"`

---

## Etter del 1 (ikke en del av denne planen)

- Deploy og produksjonsoppsett krever brukerens ja, steg for steg:
  - kjør `setup-github-deploy.sh` (Vertex AI-tilgang)
  - kjør `add-member --role` for Amund, Ingjerd og barna
  - merge til main
- Del 2 og del 3 planlegges når del 1 er i bruk.
