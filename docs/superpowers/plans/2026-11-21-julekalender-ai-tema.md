# Julekalender: AI-laget tema – implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En voksen skriver noen ord på «Utseende», og AI lager et eget tema (fem farger og 24 lukebilder i én stil) som et utkast. Den voksne kan se på det, lage luker på nytt og så ta det i bruk.

**Architecture:** En ny modul `firebase/functions/src/julekalender/theme/` har et utbyttbart `ThemeAi`-grensesnitt (Gemini tekst for planlegging, Nano Banana 2 for bilder, og en falsk variant), en jobb som skriver utkastet til `julekalender/{calId}.themeDraft` og `themeDraft/`-filer i Storage, og tre callables. Utkastet blir synlig for barnet først når `applyThemeDraft` kopierer det inn i `customTheme`, `theme = "egen"` og `doorImages`. Webappen følger fremdriften via `useCalendar`-snapshotet.

**Tech Stack:** TypeScript 7, zod 4, Firebase Functions v2 (`europe-west1`), `@google/genai` (Vertex AI, ADC), `sharp`, React 19, vitest, `@firebase/rules-unit-testing`.

**Spec:** `docs/superpowers/specs/2026-11-21-julekalender-ai-tema-design.md`

## Global Constraints

- Vertex AI via `@google/genai` med `vertexai: true`, `project: "meling-app"`, uten nøkler. Repoet er offentlig, så kjør `grep -rn AIza` før hver commit.
- Bildemodell fra `process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image"`, lest ved hvert kall. Lokasjon fra `geminiConfig().location` (`GEMINI_LOCATION`, standard `global`). Tekstmodell fra `geminiConfig().model`.
- `MELING_FAKE_AI=1` gir falsk tema-AI uten nettverk.
- Bare voksne kaller de nye callables (`requireAdult` fra `callables.ts`).
- Lukebilder er kvadratiske JPEG-er på inntil 640 px.
- Barnet ser aldri utkastet. Bare `applyThemeDraft` endrer `theme`, `customTheme` og `doorImages` på vegne av AI.
- Utkast og barnets kalender deler aldri filer. `applyThemeDraft` kopierer.
- AI-bilder i `doors/` heter `{day}_ai{id}.jpg`. Selvopplastede bilder fra webappen har id fra `newId()` (starter aldri med `ai`).
- Datamodellendringer oppdateres samtidig i `packages/shared`, `firebase/firestore.rules`, regeltestene og `docs/datamodel.md`. Julekalenderen har ingen Swift-modeller, så `MelingCore` endres ikke (som i del 1).
- UI-tekst på norsk (bokmål). Kode, identifikatorer og kommentarer på engelsk.
- Ingen beløp, e-postadresser eller nøkler committes (budsjettvarselet settes opp manuelt).
- Fortsatt «arbeid pågår»-vern: et utkast som har stått i `running` (eller en luke i `pending`) i mer enn 15 minutter (`STALE_MS` i `callables.ts`) kan startes på nytt.

## Review Focus

1. **Dobbeltklikk eller to voksne samtidig på «Lag tema».** Den andre forespørselen skal avvises med `failed-precondition` og en norsk melding, ikke starte en jobb til. Test: `generateTheme rejects while a draft is running` i Task 4.
2. **Function-timeout midt i jobben.** Utkastet står fast i `running`. Etter 15 minutter skal «Lag på nytt» virke. Test: `generateTheme may restart a stale running draft` i Task 4.
3. **Sikkerhetsfilteret avviser noen luker.** Resten av lukene blir ferdige, utkastet ender `done` med de avviste merket `error`, og «Bruk dette temaet» avvises til de er rettet. Test: `marks refused doors as error and finishes the rest` (Task 3) og `applyThemeDraft rejects a draft with failed doors` (Task 4).
4. **«Behold de du har lastet opp selv» med en blanding** av selvopplastede, AI-bilder og tomme luker. Bare selvopplastede beholdes. Test: `applyThemeDraft keepUploaded keeps only uploaded pictures` i Task 4.
5. **Den voksne lukker siden mens bildene lages.** Jobben fortsetter på serveren, og fremdriften vises når siden åpnes igjen. Sjekkes manuelt i Task 6, steg 6.

---

### Task 1: Datamodell, regler og stier

**Files:**
- Modify: `packages/shared/src/julekalender.ts`, `packages/shared/src/collections.ts`
- Test: `packages/shared/src/julekalender.test.ts`
- Modify: `firebase/firestore.rules`, `docs/datamodel.md`
- Test: `firebase/tests/firestore.rules.test.ts`, `firebase/tests/storage.rules.test.ts`

**Interfaces:**
- Produces (in `@meling/shared`):
  - `THEMES = ["jul", "vinter", "skog", "natt", "egen"] as const`. `FIXED_THEMES = ["jul", "vinter", "skog", "natt"] as const`.
  - `ThemeColors = z.object({ bg, door, done, accent, text })`, each `z.string().regex(/^#[0-9a-fA-F]{6}$/)`.
  - `CustomTheme = z.object({ prompt: z.string().min(1).max(500), colors: ThemeColors })`.
  - `DraftDoor = z.object({ status: z.enum(["pending", "done", "error"]), path: z.string().nullable(), error: z.string().nullable() })`.
  - `ThemeDraft = z.object({ status: z.enum(["running", "done", "error"]), error: z.string().nullable(), updatedAt: z.date(), prompt: z.string(), colors: ThemeColors.nullable(), motifs: z.array(z.string()), styleImage: z.string().nullable(), doors: z.record(DoorKey, DraftDoor) })`, where `DoorKey` is the existing `"1"`–`"24"` regex (pull it out of `DoorImages`).
  - `CalendarDoc` gets `customTheme: CustomTheme.optional()` and `themeDraft: ThemeDraft.optional()` (functions only).
  - `storagePaths.aiDoorImage(calId, day, id)` → `julekalender/${calId}/doors/${day}_ai${id}.jpg`. `storagePaths.themeDraftStyle(calId, id)` → `.../themeDraft/style_${id}.png`. `storagePaths.themeDraftDoor(calId, day, id)` → `.../themeDraft/${day}_${id}.jpg`. `storagePaths.themeDraftDir(calId)` → `.../themeDraft/`.
  - `isAiDoorImage(path: string): boolean`, true for `/\/doors\/\d{1,2}_ai[A-Za-z0-9]+\.jpg$/`.

- [ ] **Step 1: Write failing tests in `julekalender.test.ts`**
  - `CalendarDoc.parse` accepts a calendar with `theme: "egen"`, `customTheme: { prompt: "LEGO-jul", colors: {…five "#a3262a"…} }` and a `themeDraft` with `status: "done"`, 24 done doors.
  - `ThemeColors` rejects `"red"` and `"#abc"`.
  - `CustomTheme` rejects an empty prompt and a 501-character prompt.
  - `isAiDoorImage(storagePaths.aiDoorImage("2026-ida", 3, "x1"))` is `true`. `isAiDoorImage(storagePaths.doorImage("2026-ida", 3, "mi8k2a"))` is `false`.
- [ ] **Step 2: Run** `pnpm --filter @meling/shared test`. Expected: FAIL (missing exports).
- [ ] **Step 3: Implement the schemas and paths above.** Update the comment on `THEMES`: the colours of the fixed themes live in CSS, and `"egen"` takes them from `customTheme.colors`.
- [ ] **Step 4: Run** `pnpm --filter @meling/shared test`. Expected: PASS.
- [ ] **Step 5: Write failing rule tests in `firestore.rules.test.ts`**
  - `adults may choose the custom theme when it exists`: seed the calendar with `customTheme` (via `withSecurityRulesDisabled`), then `updateDoc(ref, { theme: "egen" })` succeeds.
  - `denies the custom theme without customTheme`: `updateDoc(ref, { theme: "egen" })` fails on a calendar without `customTheme`.
  - `clients cannot write customTheme or themeDraft`: `updateDoc` with `customTheme: {...}` fails, and so does `updateDoc` with `themeDraft: {...}`.
  - `adults may put an AI door picture path on a door`: `updateDoc(ref, { "doorImages.4": storagePaths.aiDoorImage("2026-ida", 4, "z9") })` succeeds (the existing regex already allows it).
- [ ] **Step 6: Write a failing test in `storage.rules.test.ts`**: `adults read but cannot write theme drafts`. An adult can read `storagePaths.themeDraftDoor("2026-ida", 1, "a")`, and uploading there fails.
- [ ] **Step 7: Run** `pnpm test:rules`. Expected: the custom-theme tests FAIL. The storage test may already pass, because the catch-all covers it. Keep it as a guard.
- [ ] **Step 8: Change `validTheme` in `firestore.rules`**: `!('theme' in d) || d.theme in ['jul','vinter','skog','natt'] || (d.theme == 'egen' && 'customTheme' in d)`. `affectedKeys().hasOnly([...])` already keeps `customTheme` and `themeDraft` out of client writes. Say so in the comment above the block.
- [ ] **Step 9: Run** `pnpm test:rules`. Expected: PASS.
- [ ] **Step 10: Update `docs/datamodel.md`**: `theme` gets `"egen"`, plus new sections for `customTheme`, `themeDraft` (written only by functions), the `_ai` naming in `doors/` and the `themeDraft/` folder in Storage (adults read, only functions write).
- [ ] **Step 11: Run** `pnpm typecheck && pnpm test`. Expected: PASS. Fix web type errors from `Theme` now including `"egen"`: `THEME_LABELS` gets `egen: "Eget"`, and `AppearancePage` lists `FIXED_THEMES` for now.
- [ ] **Step 12: Commit** `git commit -m "Add the custom theme and theme draft to the data model"`

### Task 2: `ThemeAi`, planning and image generation

**Files:**
- Modify: `firebase/functions/src/julekalender/gemini.ts` (export retry helper)
- Create: `firebase/functions/src/julekalender/theme/themeAi.ts`
- Test: `firebase/functions/src/julekalender/theme/themeAi.test.ts`

**Interfaces:**
- Consumes: `ThemeColors` (Task 1), `geminiConfig`, `isRetryable`, `parseGeminiResponse`, `GenerateClient`, `RetryOptions` from `gemini.ts`.
- Produces:
  - `export async function withRetry<T>(fn: () => Promise<T>, retryable: (e: unknown) => boolean, opts?: RetryOptions): Promise<T>` in `gemini.ts`. `vertexAi` uses it internally, and existing `gemini.test.ts` must still pass unchanged.
  - `export const ThemePlan = z.object({ style: z.string().min(1), colors: ThemeColors, motifs: z.array(z.string().min(1)).length(24) })`. `type ThemePlan`.
  - `export class ImageRefusedError extends Error {}`: the model gave no image (safety stop, `finishReason` other than `STOP`, or no `inlineData` part). Not retried.
  - `export interface ThemeAi { planTheme(prompt: string, childName: string): Promise<ThemePlan>; styleImage(style: string): Promise<Buffer>; doorImage(style: string, motif: string, reference: Buffer): Promise<Buffer>; }`. Images come back as the model's raw bytes (PNG/JPEG).
  - `export function vertexThemeAi(client?: GenerateClient, retry?: RetryOptions): ThemeAi`, `export function fakeThemeAi(opts?: { refuse?: Set<string> }): ThemeAi`, `export const themeAiFromEnv = (): ThemeAi`.
  - `export const IMAGE_MODEL = "gemini-3.1-flash-image"`, `export function imageModel(): string`.

- [ ] **Step 1: Write failing tests in `themeAi.test.ts`**, using a fake `GenerateClient` that records requests:
  - `planTheme parses the plan and sends the prompt and child name`: the client returns `{ text: JSON.stringify(plan24), candidates: [{ finishReason: "STOP" }] }`. Expect the result to equal `plan24`, and the request text to contain `"LEGO-jul"` and `"Ida"`.
  - `planTheme rejects a plan without 24 motifs`: 23 motifs throws.
  - `doorImage sends the reference image and returns the image bytes`: the client returns `candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: "image/png", data: <base64 of "png"> } }] } }]`. Expect `Buffer.from("png")`. The request has `model === "gemini-3.1-flash-image"`, `config.responseModalities` includes `"IMAGE"`, `config.imageConfig.aspectRatio === "1:1"`, and the first part is `inlineData` of the reference.
  - `doorImage uses GEMINI_IMAGE_MODEL`: with the env set to `"x-image"`, `request.model === "x-image"`.
  - `doorImage throws ImageRefusedError without retrying on a safety stop`: `finishReason: "IMAGE_SAFETY"`, no parts. The client is called once.
  - `doorImage retries a 429`: the first call throws `{ status: 429 }`, the second returns an image. Two calls, using `retry: { sleep: async () => {} }`.
  - `fakeThemeAi refuses chosen motifs`: `fakeThemeAi({ refuse: new Set(["m3"]) }).doorImage("s", "m3", buf)` rejects with `ImageRefusedError`.
- [ ] **Step 2: Run** `pnpm --filter @meling/functions test themeAi`. Expected: FAIL.
- [ ] **Step 3: Extract `withRetry` in `gemini.ts`** from the loop in `vertexAi` (same delays, jitter and `attempts`), and let `vertexAi` use it.
- [ ] **Step 4: Run** `pnpm --filter @meling/functions test gemini`. Expected: PASS (unchanged behaviour).
- [ ] **Step 5: Implement `themeAi.ts`.** Fixed rules for the prompts (Norwegian, like `PAGE_PROMPT`):
  - **Planning** (JSON schema `ThemePlan`): one style that holds for all pictures. Five colours, where `door` and `done` must give good contrast against `text` (the door number is drawn on top in `text` colour). 24 different motifs that belong together, simple enough for a 5-year-old. No trademark names in `style` or `motifs` ("byggeklosser og minifigurer", not "LEGO").
  - **Every image call:** square, no text, letters or numbers, child-friendly and not scary, the subject in the middle, a calm background. Door images send the reference first with the instruction "same style as the reference picture".
  - **Fakes:** `planTheme` returns a fixed plan (`motifs` `"m1"`–`"m24"`, the colours of «jul»). Images are 64×64 single-colour PNGs made with `sharp`, a different colour per motif.
- [ ] **Step 6: Run** `pnpm --filter @meling/functions test`. Expected: PASS.
- [ ] **Step 7: Commit** `git commit -m "Add the theme AI: planning with Gemini and pictures with Nano Banana 2"`

### Task 3: The theme job

**Files:**
- Create: `firebase/functions/src/julekalender/theme/themeJob.ts`
- Test: `firebase/functions/src/julekalender/theme/themeJob.emulator.test.ts`

**Interfaces:**
- Consumes: `ThemeAi`, `ImageRefusedError` (Task 2). `ThemeDraft`, `storagePaths.themeDraft*` (Task 1).
- Produces:
  - `export type ThemeDeps = { db: Firestore; bucket: Bucket; themeAi: ThemeAi }`.
  - `export const MAX_CONCURRENT_IMAGES = 4`.
  - `export async function toDoorJpeg(image: Buffer): Promise<Buffer>`: the middle square, at most 640 px, JPEG quality 85 (`sharp`).
  - `export async function runThemeGeneration(deps: ThemeDeps, calId: string, prompt: string, childName: string): Promise<void>`. It expects the caller to have already written `themeDraft = { status: "running", prompt, …, doors: {} }`. It never throws for AI errors, but writes them to the draft.
  - `export async function regenerateDraftDoor(deps: ThemeDeps, calId: string, day: number): Promise<void>`. It expects the caller to have set `themeDraft.doors.{day}.status = "pending"`.

Behaviour of `runThemeGeneration`:
1. `planTheme`, then write `colors`, `motifs` and all 24 doors as `{ status: "pending", path: null, error: null }`.
2. `styleImage`, save to `themeDraftStyle` (PNG), write `styleImage`.
3. 24 `doorImage` calls with at most `MAX_CONCURRENT_IMAGES` in parallel. Each one goes through `toDoorJpeg`, is saved to `themeDraftDoor`, and writes `doors.{d} = { status: "done", path, error: null }` and `updatedAt`. On an error: `{ status: "error", path: null, error: <Norwegian message> }` ("Bildet ble avvist av AI-en. Prøv «Ny variant»." for `ImageRefusedError`, otherwise "Kunne ikke lage bildet.").
4. If planning or the style picture fails: `status: "error"`, `error` in Norwegian, and the rest stops. Otherwise `status: "done"` once all doors are `done` or `error`.
5. Old files under `themeDraftDir` that the draft no longer points to are deleted at the end (errors only logged).

- [ ] **Step 1: Write failing emulator tests** (same setup as `versions.emulator.test.ts`):
  - `makes a full draft`: with `fakeThemeAi()`, the draft is `done`, has 24 `done` doors, every `path` exists in the bucket and is a JPEG of ≤640 px (`sharp(...).metadata()`), and `styleImage` exists.
  - `marks refused doors as error and finishes the rest`: with `fakeThemeAi({ refuse: new Set(["m3", "m7"]) })`, the status is `done`, doors 3 and 7 are `error` with a message, and the other 22 are `done`.
  - `records an error when planning fails`: with a ThemeAi whose `planTheme` throws, the status is `error`, `error` is a non-empty string, and no door files exist.
  - `regenerateDraftDoor replaces one door`: after a full draft, door 5 is set to `pending` and `regenerateDraftDoor` runs. Door 5 is `done` with a new path, the old file is gone, and door 6 is unchanged.
  - `never touches theme, customTheme or doorImages`: the calendar's `theme`, `doorImages` and `customTheme` are the same before and after.
- [ ] **Step 2: Run** `pnpm test:functions`. Expected: FAIL.
- [ ] **Step 3: Implement `themeJob.ts`** as described above.
- [ ] **Step 4: Run** `pnpm test:functions`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Generate a theme draft in the background"`

### Task 4: Callables

**Files:**
- Create: `firebase/functions/src/julekalender/theme/themeCallables.ts`
- Modify: `firebase/functions/src/index.ts`
- Test: `firebase/functions/src/julekalender/theme/themeCallables.emulator.test.ts`

**Interfaces:**
- Consumes: `requireAdult`, `CallRequest`, `STALE_MS` and `Id` (export both from `callables.ts`), `runThemeGeneration`, `regenerateDraftDoor`, `ThemeDeps` (Task 3), `isAiDoorImage`, `storagePaths.aiDoorImage` (Task 1).
- Produces:
  - `generateThemeHandler(deps, request): Promise<{ ok: true }>` with input `{ calendarId: Id, prompt: string (trimmed, 1–500) }`. In a transaction it rejects with `failed-precondition` "Et tema lages allerede. Prøv igjen om litt." if `themeDraft.status == "running"` or any door is `pending` and `updatedAt` is fresher than `STALE_MS`. Otherwise it writes a new `themeDraft` (`status: "running"`, `colors: null`, `motifs: []`, `styleImage: null`, `doors: {}`, `updatedAt` now) and then awaits `runThemeGeneration`.
  - `regenerateDoorHandler(deps, request): Promise<{ ok: true }>` with input `{ calendarId, day: 1–24 }`. It rejects if there is no draft, if the draft has no `motifs`/`styleImage`, if the draft is `running`, or if the door is already `pending` (fresh), all as `failed-precondition` with Norwegian messages. Otherwise it sets the door to `pending` and the draft's `updatedAt`, then runs `regenerateDraftDoor`.
  - `applyThemeDraftHandler(deps, request): Promise<{ replaced: number; kept: number }>` with input `{ calendarId, keepUploaded: boolean }`. It requires `status == "done"`, `colors` set and all 24 doors `done`. Otherwise `failed-precondition` "Alle 24 bildene må være ferdige før temaet kan brukes.". For each door, skip it if `keepUploaded && current path && !isAiDoorImage(current)`. Otherwise copy the draft file (`bucket.file(...).copy`) to `aiDoorImage(calId, day, id)`, where `id = randomUUID().replaceAll("-", "")`. Then one transaction: `theme: "egen"`, `customTheme: { prompt, colors }`, `doorImages.{day}` for the copied doors. After the commit, delete the old `doors/` files that were replaced (errors only logged). If the transaction fails, delete the new copies.
  - Exports: `generateTheme` and `regenerateDoor` as `onCall({ timeoutSeconds: 540, memory: "1GiB" })`, `applyThemeDraft` as `onCall({ timeoutSeconds: 120 })`, with `deps = { db, bucket, themeAi: themeAiFromEnv() }`. Add them to `index.ts`.

- [ ] **Step 1: Write failing emulator tests** (fake AI, an adult and a child seeded in `members`):
  - `only adults may generate a theme`: a child gets `permission-denied`.
  - `generateTheme validates the prompt`: `""`, `"   "` and 501 characters give `invalid-argument`.
  - `generateTheme rejects while a draft is running`: seed `themeDraft.status = "running"` with a fresh `updatedAt`. Expect `failed-precondition`.
  - `generateTheme may restart a stale running draft`: the same, but `updatedAt` is 16 minutes old. Expect a `done` draft.
  - `regenerateDoor rejects without a finished plan`: without a draft, `failed-precondition`.
  - `applyThemeDraft rejects a draft with failed doors`: a draft where door 3 is `error` gives `failed-precondition`, and the calendar is unchanged.
  - `applyThemeDraft replaces all doors`: the calendar has an uploaded picture on door 1 and nothing on the rest. With `keepUploaded: false`, all 24 `doorImages` are `_ai` paths that exist and differ from the draft paths, `theme == "egen"`, `customTheme.colors` equals the draft's colours, the old picture on door 1 is deleted, and the result is `{ replaced: 24, kept: 0 }`.
  - `applyThemeDraft keepUploaded keeps only uploaded pictures`: door 1 is uploaded, door 2 has an earlier `_ai` picture, and door 3 is empty. With `keepUploaded: true`, door 1 is unchanged, doors 2 and 3 get new `_ai` paths, the old `_ai` file on door 2 is deleted, and the result is `{ replaced: 23, kept: 1 }`.
  - `applying twice keeps the draft`: after `applyThemeDraft`, the draft is still `done` and can be applied again.
- [ ] **Step 2: Run** `pnpm test:functions`. Expected: FAIL.
- [ ] **Step 3: Implement `themeCallables.ts`** and the exports in `index.ts`.
- [ ] **Step 4: Run** `pnpm test:functions && pnpm --filter @meling/functions build && pnpm --filter @meling/functions check:load`. Expected: PASS, and `lib/index.js` loads.
- [ ] **Step 5: Commit** `git commit -m "Add callables to generate, adjust and apply an AI theme"`

### Task 5: Trial script, configuration and budget alert

**Files:**
- Create: `firebase/functions/scripts/try-theme.ts`
- Modify: `firebase/functions/package.json` (script `try-theme`, same pattern as `try-analysis`), `CLAUDE.md`

**Interfaces:**
- Consumes: `vertexThemeAi`, `toDoorJpeg`, `imageModel`.

- [ ] **Step 1: Write `try-theme.ts`**: `pnpm --filter @meling/functions try-theme "<prompt>" [childName] [antall=4]`. It runs `planTheme`, `styleImage` and the first *n* door pictures against real Vertex, writes them to `firebase/functions/.try-theme/` (add it to `.gitignore`), and prints the model, plan, time per image and any refusals. Header comment like in `try-analysis.ts` (ADC, `roles/aiplatform.user`).
- [ ] **Step 2: Run it** with `"LEGO-jul, Ida 5 år"` and with `"byggeklosser og minifigurer i julestemning"`. Look at the pictures. If the planning step still lets "LEGO" through to the image prompt and that gives refusals or poor pictures, tighten the planning prompt in `themeAi.ts` and update its test. Write down the time per image.
- [ ] **Step 3: Check the price** on the official Vertex AI pricing page for the image model and write per-image and per-theme cost (25 images + 1 planning call) in a comment at the top of `themeAi.ts`.
- [ ] **Step 4: Update `CLAUDE.md`**: `GEMINI_IMAGE_MODEL` (standard `gemini-3.1-flash-image`) next to `GEMINI_MODEL`. `try-theme` under Kommandoer. Under CI/CD: "A project owner sets up a budget alert in Cloud Billing for `meling-app` (Billing → Budgets & alerts) before the AI theme is put into use. Amount and recipient are not committed."
- [ ] **Step 5: Run** `pnpm typecheck && grep -rn AIza . --exclude-dir=node_modules`. Expected: no errors, no hits.
- [ ] **Step 6: Commit** `git commit -m "Add a trial script for the AI theme and document its configuration"`

### Task 6: Web

**Files:**
- Modify: `apps/web/src/julekalender/admin/Doors.tsx`, `AppearancePage.tsx`, `PreviewPage.tsx`, `api.ts`, `apps/web/src/index.css`
- Create: `apps/web/src/julekalender/admin/AiThemeCard.tsx`

**Interfaces:**
- Consumes: `generateTheme`, `regenerateDoor`, `applyThemeDraft` (Task 4), `CalendarDoc.customTheme`/`themeDraft`, `FIXED_THEMES`, `isAiDoorImage`, `ThemeColors` (Task 1), `useConfirm`, `useDownloadUrls`.
- Produces:
  - `api.ts`: `generateTheme` and `regenerateDoor` with the `long` timeout, `applyThemeDraft` with `standard`. Types match Task 4.
  - `ChildFrame({ theme, colors, children })`. When `theme === "egen"` and `colors` is set, the five CSS variables (`--c-bg`, `--c-door`, `--c-done`, `--c-accent`, `--c-text`) are set as inline style. Otherwise as today.
  - `AiThemeCard({ calId, calendar }: { calId: string; calendar: CalendarDoc })`.

- [ ] **Step 1: `ChildFrame` and `PreviewPage`**: pass `calendar.customTheme?.colors`. `THEME_LABELS.egen = "Eget"`.
- [ ] **Step 2: Theme choices on `AppearancePage`**: list `FIXED_THEMES`, plus «Eget» with a swatch in `customTheme.colors` when `customTheme` exists.
- [ ] **Step 3: `AiThemeCard`** above «Bilder på lukene», with the heading «Lag eget tema med AI»:
  - A text field (max 500, placeholder «For eksempel: LEGO-jul for Ida, 5 år, som liker katter og rosa») and the button «Lag tema» («Lag på nytt» when there is a draft). The call is fire-and-forget. Progress comes from the snapshot, but show the error if the call fails with something other than a timeout.
  - While `running`: «Lager tema … {n} av 24 bilder» (count `done` doors), and the button is disabled.
  - The draft is shown in its own `ChildFrame theme="egen" colors={draft.colors}` with the draft pictures (`useDownloadUrls`). Every door has «Ny variant». A door that is `pending` shows «Lager …», and an `error` door shows its message.
  - «Bruk dette temaet» is active only when all 24 are `done`. On a click: if some `doorImages` are uploaded (`!isAiDoorImage`), ask «{n} luker har bilder du har lastet opp selv. Vil du erstatte dem med AI-bildene?» with three buttons: «Erstatt alle 24» → `keepUploaded: false`, «Behold mine» → `keepUploaded: true`, «Avbryt» → nothing. Add `useChoice<T>()` next to `useConfirm` in `useConfirm.tsx`: `choose(message: string, options: { label: string; value: T }[]): Promise<T | null>`, with the same `<dialog>` approach, where `null` means cancelled. If no doors have uploaded pictures, call `applyThemeDraft({ keepUploaded: false })` without asking. Afterwards show the status «Temaet er tatt i bruk.»
  - Draft status `error`: show `draft.error` and «Lag på nytt».
- [ ] **Step 4: Run** `pnpm typecheck && pnpm --filter @meling/web build`. Expected: PASS.
- [ ] **Step 5: Verify in the browser** with emulators (`MELING_FAKE_AI=1` in `firebase/functions/.env.local`, `pnpm emulators`, `pnpm --filter @meling/web dev`). Generate a theme, see progress and the draft, «Ny variant» on one door, apply with and without «Behold mine» after uploading one picture yourself. Check that the preview tab shows the custom colours. Screenshot as evidence.
- [ ] **Step 6: Close the tab while it is generating**, open «Utseende» again, and check that the progress continues and the draft finishes.
- [ ] **Step 7: Commit** `git commit -m "Let adults make, adjust and apply an AI theme on «Utseende»"`
