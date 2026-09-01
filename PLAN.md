# The Family Tree — Recovery & Delivery Plan

Canonical status tracker. Derived from the Antigravity handover report (2026-08-28) plus a
direct audit of the repo. Update the **Status** column as work lands; keep task IDs stable.

**Status legend:** `TODO` · `WIP` · `DONE` · `BLOCKED` · `DEFER`

---

## Where the project actually is

The handover says "stopped in the middle of Phase 4." The audit says something more
specific: **the data pipeline is wired end to end but is silently corrupting what flows
through it.** Only 4 of 63 members are loaded, and those 4 already carry a wrong birthday,
a wrong gender, a duplicate login, and photo URLs still pointing at Google Drive.

So the sequencing is not "finish Phase 4." It is: fix the pipe, then fill it, then render it.

### The finding that reorders everything

`data/auth.json` holds two entries for Hitesh Sathawane:

| hash | role | preimage |
|---|---|---|
| `974447909d98…` | `admin` | `hiteshsathawane` + `29121985` ✅ |
| `b4893b68d0f5…` | `viewer` | `hiteshsathawane` + `28121985` ❌ |

Real DOB is 29-Dec-1985. `Family/Cropped/Family Details.csv` says `29-Dec-85`.
`data/family.json` says `1985-12-28`.

Cause: Apps Script `getValues()` returns date cells as JS `Date` objects. Serialised to JSON
from an IST (UTC+5:30) spreadsheet, `29-Dec-1985` becomes `1985-12-28T18:30:00.000Z`.
`scripts/pull-sheet.js:36-38` then does `d.split('T')[0]` and keeps **1985-12-28**.

Every date in the pipeline is one day early. Because the identity hash is
`SHA-256(name + DDMMYYYY)`, that also mints a second, wrong-role login per member. Loading
63 rows through this pipe produces 63 wrong birthdays and a pile of junk auth entries.

**Do not load the real dataset until M0 is green.**

> **Update 2026-08-29 — M0 is green and the pipeline is proven.** Swati Biradar was
> submitted through the live Google Form with both photos; `media:sync` rewrote them to
> R2 (HTTP 200, byte-identical to source). T-06 was a misdiagnosis: the R2 rewrite was
> never broken, nothing had ever reached it, because form photo uploads had never once
> worked (T-06a). Two things now gate the load — see M1a:
> 1. **Every row is one-shot.** The importer keeps the *first* row per person and drops
>    later ones, so a corrected resubmission is ignored (T-08).
> 2. **`fill-form.js` can only submit 11 of 64 rows** — it filters to rows that have a
>    local image. The other 53 have no mechanism at all (T-30).

> **Update 2026-08-30 — the opening paragraph above is now history, kept for the audit
> trail.** The load has happened: `family.json` holds 71 persons / 115 relationships and
> `validate.js` is green. M0, M1 (bar T-10a) and M2 are closed. What is actually left is
> **M3 (Phase 4 profile & timeline)**, the M4 hygiene items that are not this session's,
> and the two genuine M5 gaps — the calendar and the language toggle turned out to be
> already built, so M5 is no longer a wholesale `DEFER`.

---

## Milestones

Strictly ordered. Each milestone's exit criterion gates the next.

| # | Milestone | Why it is here | Exit criterion |
|---|---|---|---|
| **M0** | Pipeline correctness | Everything downstream inherits these bugs | ✅ One form submission round-trips with correct DOB, correct gender, and exactly one auth entry |
| **M0.5** | Render smoke test | 30 min that de-risks an hour+ of loading. M2/M3 have never been run at all — loading 64 rows into a broken renderer wastes the load | App boots, tree draws the 6 records, R2 photo renders, profile panel opens |
| **M1a** | Loader safety | Data needs refinement, and today every row is one-shot. Fixing this *after* the load means correcting 64 rows by hand | Resubmitting a corrected form row actually updates the member; photo-less rows can submit |
| **M1b** | Load the real 63 | The app has no real content to render or design against | 63 persons in `family.json`, every photo on an R2 URL, `validate.js` green |
| **M2** | Tree rendering | Known layout bug only manifests at real scale | Full 63-node tree renders, no crossed spouse lines, desktop + mobile |
| **M3** | Phase 4 — profile & timeline | The original in-flight phase, now on solid data | Click a member → panel with real timeline entries and photos |
| **M4** | Hygiene & hardening | Live rule violations and exposed secrets | `grep` returns 0, no config placeholders, secrets rotated, CLAUDE.md matches reality |
| **M5** | Phase 6 & 7 | Calendar, PWA, i18n, performance | Per CLAUDE.md phase definitions |

---

## M0 — Pipeline Correctness  `BLOCKER`

| ID | Task | Severity | Files | Status |
|---|---|---|---|---|
| T-01 | Fix IST date off-by-one. Return display values for date columns from Apps Script (`getDisplayValues()` or `Utilities.formatDate` with sheet TZ); harden `formatDate()` to reject a bare `split('T')` on a timestamp | Critical | Apps Script `Code.gs`, `scripts/pull-sheet.js:31-40` | DONE |
| T-02 | Delete the bogus `b4893b68…` viewer entry. Add dedupe so a `displayName` never gets a second auto-created entry, and auto-created entries never silently downgrade an existing admin | Critical | `data/auth.json`, `scripts/csv-import.js` | DONE |
| T-03 | Gender arrives as `X`. The sheet holds `Male` and `pull-sheet.js:134` maps `m*`→`M` correctly, so the value never reached the sheet — audit radio-button handling in `fill-form.js` | High | `scripts/fill-form.js` | DONE — verified live 2026-08-29. `clickRadio` throws instead of warn-and-continue; row loop aborts without marking progress. Confirmed against two real form runs: failures left the row pending rather than submitting a blank field. |
| T-04 | Harden spouse-gender inference: `const sGender = row.gender === 'M' ? 'F' : 'M'` flips a wife to `M` whenever the husband is `X`. This is the real cause of the "Swati Biradar gender bug" | High | `scripts/csv-import.js:325` | DONE |
| T-05 | Re-derive Hitesh end to end; assert DOB `1985-12-29`, gender `M`, Swati `F`, exactly one admin auth entry | High | verification | DONE — verified 2026-08-29 via hand-pasted Sheet row + `sheet:pull`; idempotent on re-sync |

**Exit:** submit one form → correct DOB, correct gender, one auth entry.

---

## M1 — Load the Real 63

| ID | Task | Severity | Files | Status |
|---|---|---|---|---|
| T-06 | `profilePhoto` still holds `drive.google.com/open?id=…` — the R2 rewrite is not landing. Verify `sync-media.js` uploads and rewrites | High | `scripts/sync-media.js`, `data/config.json` | DONE — proven end to end 2026-08-29. Swati submitted through the live Form → Drive URL landed in the sheet → `media:sync` rewrote both photos to `pub-51dbdc…r2.dev`, HTTP 200, byte-identical to source (487055 / 224497). The rewrite was never broken; nothing had ever reached it, because form uploads were silently failing (see T-06a). |
| T-06a | **Form photo upload never worked.** `uploadFile` looked for a page-level `input[type=file]`, then an OS filechooser — Forms has neither. Uploads live in a cross-origin Drive picker iframe whose `name` is regenerated per session, and **the file input does not exist until "Browse" is clicked** — the step every earlier attempt missed, which is why probing reported "no file inputs inside iframe". Also: Forms restores a saved draft, so a file left by a previous run rides into the next person's response | High | `scripts/fill-form.js` | DONE — 2026-08-29, selectors captured via `playwright codegen`. Finds the live picker by locating a *visible* Browse button (the spent picker lingers in the DOM and captured the second upload), claims the OS dialog as a Playwright filechooser, clears draft leftovers, waits for the file chip, and throws on failure so a photo-less row aborts instead of submitting. |
| T-31 | **The app does not render `data/family.json`.** It renders `tree-data.js`, a generated snapshot, and **nothing in the sync pipeline regenerated it** — so every sync updated the data while the UI kept showing a `2026-05-23` snapshot, junk `adsf`/`asdf` test rows and all. This masked the true state of M2/M3 completely | **Critical** | `scripts/pull-sheet.js`, `scripts/generate-tree-data.js` | DONE — 2026-08-29. `pull-sheet.js` now runs `generate-tree-data.js` after validation. Re-render dropped the junk (35 → 0 hits) and node count went 15 → 6, matching `family.json` exactly |
| T-07 | Spouse's parents (Bhimrao, Chaya) appear inside composite IDs but are never created as person nodes — in-law branches dangle | High | `scripts/csv-import.js:305-333` | DONE (verify at scale) — 2026-08-29 smoke test shows `BHIMRAO___BIRADAR` / `CHAYA___BIRADAR` as real nodes, rendered and labelled FATHER-IN-LAW / MOTHER-IN-LAW, with In-Laws = 2. The dangling-branch symptom was T-31's stale snapshot. Re-confirm once 63 rows are loaded |
| T-08 | Replace skip-on-duplicate with upsert/merge, so a corrected resubmission can actually fix a member. Today there is no way to correct data through the form | **Critical** | `scripts/csv-import.js` | DONE — 2026-08-29. Each person id now resolves to its **last** row, so resubmitting the form is the correction mechanism. Verified with a crafted duplicate: the corrected row won. Field-level merge still deferred |
| T-30 | `fill-form.js` only accepts rows with a local image — **11 of 64**. The remaining 53 rows have no submission path at all, so T-10 is not executable as written | **Critical** | `scripts/fill-form.js` | DONE — 2026-08-29. All 64 rows are eligible (62 pending); `--photos-only` restores the old 11-row behaviour for staging. Placeholder images were deliberately **not** used — they would write wrong faces into Drive, R2 and `family.json`. Photo-less path not yet exercised against the live form |
| T-09 | HEIC photos (`Gaurav.HEIC`, `Dhruv.heic`, `Arjun_bg.heic`) do not render in browsers — convert during media sync | Low *(was Medium)* | `scripts/sync-media.js` | DEFER for the load — `fill-form.js` already pre-converts HEIC via `sips` and all three files have `_converted.jpg` siblings. Still real for **production**: a family member uploading straight from an iPhone. Same bucket as the Form's **1 MB upload cap** (current max is 814 KB, so not blocking today) |
| T-10 | Load all 63 rows from `Family/Cropped/Family Details.csv`; run `validate.js`; spot-check 5 records against source | High | `data/family.json` | DONE — 2026-08-29, 13:07:36Z. All 64 rows submitted, `sheet:pull` + `media:sync` run. `validate.js` green (74 persons, 118 relationships); `verify:pipeline` green; `tree-data.js` regenerated with 0 persons missing and 0 junk rows; `auth.json` 11 entries, 0 duplicate displayNames, 1 admin. **Residue: T-10a** — Hitesh's photo never reached R2 |
| T-10a | **Hitesh's photo never reached R2.** `profilePhoto` is the local path `/Users/…/Downloads/Family/Cropped/Hitesh.png`, the only non-R2 photo in the tree — and it is the *root person*, so it fails to load on first paint. Cause: his `.form-progress.json` entry is stamped `2026-08-26` (the hand-pasted T-05 row), so `--all` counted him done and skipped him; under T-08 last-write-wins that stale Sheet row stays authoritative. Fix: drop his progress key, `form:one --name hitesh` with the real photo, re-pull | High | `.form-progress.json`, live Sheet | DONE — 2026-08-30, verified from the data rather than the note: the root person's `profilePhoto` is now `pub-51dbdc….r2.dev/profile_hitesh_jyoti_shankar_sathawane.png`. Across all 71 persons there are **0 non-https photo values** and 52 on R2, so the local-path residue is gone tree-wide, not just for the root |
| T-32 | **Gender / Status / Marital Status submit blank.** Not a headless timing race — reproduced headed and headless. Google Forms **restores the previous response as a draft**, so the option we want is often already selected on load, and a Forms radio **toggles**: clicking it then *deselects* it, removing the hidden `input[name="entry.N"]` that the POST actually carries. `aria-checked` tracks the toggle faithfully, so the old assert confirmed a value it had just cleared. Confirmed by intercepting the submit: `entry.416676068` was absent entirely, only its `_sentinel` present. The owner reproduced it by hand in `playwright codegen` — the recording shows `Married` clicked twice. Compounding it, the three questions were **not actually Required** in the Form (the `*` was only typed into the title), so Forms accepted every blank | Medium | `scripts/fill-form.js` | DONE — 2026-09-02. `clickRadio` now reads the hidden entry input (what Forms submits) and clicks **only when it is wrong**, re-asserting all three right before Submit; added `--capture`, which fills a real row, presses Submit, aborts the POST and prints the `entry.*` payload, so this class of bug is testable without writing to the Sheet. Verified on Jyoti: `Female` / `Deceased` / `Married` all present. Gender/Status/Marital Status set to Required on the live Form (Death Date deliberately left optional) |

**Exit:** 63 persons, validator green, and every photo *that exists* on an R2 https URL.
Note: only 11 of 64 source rows carry a photo, so "all photos on R2" was never reachable —
53 members have no image to upload. Placeholders were deliberately refused (T-30).
Separately, only 12 members have a usable DOB: 47 source rows leave Birth Date empty and
5 more are year-less (`19-Jan`, `16-May`), which `parseDate()` drops by design.

---

## M2 — Tree Rendering

| ID | Task | Severity | Files | Status |
|---|---|---|---|---|
| T-11 | Spouse cross-connection bug: for in-laws placed recursively *after* the primary node, `wParentX` is `null`, bypassing the swap check and crossing maternal lines | High | `tree-helpers.js:777-891` | DONE — span reservation (`reserveSpan`, `tree-helpers.js:777`) plus a `wParentX`-only swap branch (`:864-866`), so a wife whose parents are placed later still swaps instead of crossing |
| T-12 | Guest sees a blank canvas — render "Log in to see your family tree" in the SVG | Medium | `tree-app.js` | DONE — resolved by removing the tier rather than by drawing a message. There is no guest path: a failed identity hash refuses login outright, so the canvas is never reached unauthenticated. `grep -i guest` over `tree-app.js` / `index.html` returns 0 |
| T-13 | Apply branch colouring from `config.json` (Sathawane / Waghmare / Biradar) | Low | `tree-app.js:9-76` | DONE — with a deliberate deviation: colours are allocated per surname at render time (`buildBranchColorMap`) rather than read from a hand-kept `config.json` list, so a new surname colours itself. The root person's surname is pinned to leaf green; hashing keeps each surname's colour stable across reloads |
| T-14 | Layout sanity pass at 63 nodes, desktop and 768px mobile | Medium | verification | DONE — both breakpoints render the full tree |
| T-34 | **The root person exists twice, so his own children hang off the wrong node.** Spotted on the live site: Swati sits far from Hitesh and Dhruv/Arjun attach to her, not to him. Not a layout bug — the layout is correct for the data it is given. `csv-import.js` keys a person as `FIRST_MOTHER_FATHER_LAST`, so the same human gets a different id depending on which row created him: Hitesh's own row knows his parents → `HITESH_JYOTI_SHANKAR_SATHAWANE` (the `rootPersonId`, has the R2 photo); Swati's row names her spouse with no in-law parents → `HITESH___SATHAWANE`. The **stub owns both children** (`parent-child` → Dhruv, Arjun) and carries a **second, duplicate marriage** to Swati, while the root Hitesh has no children at all. Audit: **27 of 72** persons are `___` stubs; 1 is a confirmed duplicate of a fully-keyed person (Hitesh), 1 more shares a first name (`GAURAV___BHIRUD`). Fix belongs in the importer, not the data — resolve a spouse/parent stub against an existing person by name before minting a new composite id, and merge the relationships onto the winner. Until then a re-import recreates it | **Critical** | `scripts/csv-import.js`, `data/family.json` | TODO |

**Exit:** full tree renders, no crossed lines, both breakpoints.

---

## M3 — Phase 4: Profile & Timeline

| ID | Task | Severity | Files | Status |
|---|---|---|---|---|
| T-15 | Scrapbook form is undocumented (URL unknown) and has no photo or tag columns, while `pull-sheet.js:235-236` searches for both. Rebuild or extend the form, then re-point | High | Google Form, `scripts/pull-sheet.js` | **MOSTLY DONE** — 2026-08-30. Form found and it does **not** need rebuilding: `docs.google.com/forms/d/e/1FAIpQLScvHzdX53qHkiRd7p-_kiIr6l_oNiriMeW4TTieQONywiC3oA/viewform` (sign-in required, so not fetchable anonymously — read via the Apps Script instead). Its tab, `Timeline Scrap Book`, is already auto-detected by the `scrapbook`/`timeline`/`memories` name match, and it **does** have a photo column. Header mapping was resolving owner ✅, date ✅, photos ✅, caption ❌ (fixed, see T-15a), tags ❌ (missing question, T-15b). 0 rows submitted, so T-16 still has nothing to render |
| T-15a | Caption column mis-mapped. `findHeaderIdx` matched the loose word `memory` against **"Who is writing this memory?"** (idx 1) before **"The Story / Description"** (idx 7), so the submitter's name would have been written into every caption | High | `scripts/pull-sheet.js:349` | DONE — 2026-08-30. Two-pass match: unambiguous `story`/`caption`/`description` first, loose `details`/`memory`/`text` as fallback, both excluding the author- and subject-question wording. Verified against the live headers (→ "The Story / Description") and two alternative header shapes |
| T-15c | Scrapbook person dropdowns are generated by a **form-bound** Apps Script, `updateFormDropdowns()` (lives on the Form, not in `scripts/apps-script/`), which reads cols **E**/**G** of the members sheet. Checked live: all **63** dropdown options resolve cleanly to a person id, so owner matching is safe. But the dropdown is built from *sheet rows*, and `family.json` has **71** persons — the extra **19** are in-laws, spouses and elders created by `csv-import.js` (Bhimrao/Chaya Biradar, the Waghmare and Bisne elders, …). **No memory can ever be written about those 19.** Also: the script has no trigger, so it must be re-run by hand after every load or new members are unselectable | Medium | Form-bound Apps Script | TODO |
| T-15b | Scrapbook form has **no tag question**, so `tagsIdx` is `-1` and every entry imports with `tags: []` — the "who else is in this memory" link is silently always empty. Also, three answered columns are collected by the form but dropped by the importer: *What type of event is this?*, *Title of the Memory/Event*, *Location / City* — `family.scrapbook[id]` only stores `{date, caption, photos, tags}` | Medium | Google Form, `scripts/pull-sheet.js:404-412`, `scripts/generate-tree-data.js:500` | TODO |
| T-16 | Render the scrapbook timeline with live data — the UI is wired but has never been fed | High | `tree-app.js:822-831`, `index.html:3566-3571` | **DONE (code)** — 2026-08-30, proven in Chromium against a temporary seeded fixture (3 memories on the root + 1 on his wife, since removed). The rail renders dated entries, R2 photos, the auto-generated birth event, the "Unknown Date" fallback and the `WITH <name>` tag chips, with 0 console errors. Nothing was wrong with the renderer — it had simply never been fed. **Remaining is data, not code:** `family.json.scrapbook` is `{}` because 0 rows have been submitted to the Scrapbook Form |
| T-17 | Bio tab (birthplace, occupation, education, religion) and Family tab (spouse, parents, children, sibling chips) | Medium | `tree-app.js`, `index.html` | **DONE** — 2026-08-30. Both tabs were already built (`renderBioTab` `tree-app.js:836`, `renderFamilyTab` `:877`) and verified live: Bio renders the fact list + life story with a per-person empty state; Family renders spouse / parents / children / sibling chips that navigate. One real defect found and fixed — the spouse group printed its relation twice ("HUSBAND HUSBAND Hitesh") because the group heading and the chip label were both the relation; `personChipHtml` now omits an empty label and the spouse group passes one. Bio looks thin only because occupation/education/religion are 0/71 in the data (see T-33) |
| T-18 | Relationship calculator — "how are these two related?" | Medium | `tree-helpers.js` | **PARTIAL** — 2026-08-30. Verified live: the picker lists all 71 members, answers render with a hop chain, 0 errors. The kinship engine itself is strong (`labelFor` `tree-helpers.js:102` covers in-laws, Marathi terms — Kaka/Mama/Aatya/Maushi/Aaji — and `collateralLabel` `:282` does Nth-cousin-M-times-removed). **The gap is composition through marriage:** both resolvers key off a *shared blood ancestor*, so for anyone married into the tree (e.g. Swati, whose Biradar line shares no ancestor with the Sathawanes) every answer collapses to the fallback "Related by marriage" — 5 of 5 sampled. Sentence assembly also breaks on those fallbacks: "Aarti is Swati's Related by marriage." Fix in T-18a |
| T-18a | Compose relationship labels **through** the marriage hop instead of bailing out. When `labelFor`/`collateralLabel` find no blood link but a path exists, split the path at its first spouse hop and recurse: `label(a,b)` becomes "*&lt;spouse-term&gt;'s &lt;label(spouse, b)&gt;*" — e.g. Swati → Ajay resolves as "her husband's maternal cousin" rather than "Related by marriage". Also guard the sentence template so a non-noun-phrase label ("No known connection") gets its own sentence rather than being slotted into "X is Y's …" | Medium | `tree-helpers.js:322-347`, `tree-app.js:944-975` | TODO |
| T-19 | ~~Leaflet birthplace pin inside the profile panel~~ | — | — | **DROPPED** — 2026-08-30, owner's call. Maps are removed from the project (CLAUDE.md rule 8); no Leaflet anywhere, in the panel or otherwise. Birthplace stays plain text in the Bio tab (T-17) |

**Exit:** click a member → panel with real timeline entries and photos.

---

## M4 — Hygiene & Hardening

| ID | Task | Severity | Files | Status |
|---|---|---|---|---|
| T-20 | **Rotate exposed secrets.** The family password is committed in plaintext in `CLAUDE.md`, `RUN_AND_TEST.md`, `scripts/clear-data.js` and (until T-25) 4 `scratch/` files — violating CLAUDE.md's own rule 5. The Apps Script HMAC secret `MyFamilyTreeSecureToken2026` is in the handover doc | Critical | multiple | TODO — **owner's task, deliberately deferred.** Not touched by the 2026-08-30 hygiene pass. T-25 removed the 4 scratch copies, but the git history still holds every one of them, so rotation is still the only real fix |
| T-21 | Google Fonts CDN at `index.html:9` and `:12` violates rules 1 and 9 — `grep` returns **2**, must be **0**. `vendor/fonts.css` exists but `vendor/fonts/` does not. Self-host the faces | High | `index.html`, `vendor/fonts/` | DONE — 2026-08-30. `grep` returns **0**. Root cause was `download-vendors.js`: it fetched the css2 URL with no browser UA, so Google returned **ttf**, and its woff2-only regex then matched nothing — `vendor/fonts/` was never created and `fonts.css` kept `gstatic` URLs, i.e. the "local" vendor file was itself a CDN reference. Resolved the family mismatch in favour of **Cormorant Garamond + Inter** (what index.html's ~35 rules actually style with) over CLAUDE.md's Playfair/Lato tokens, which nothing referenced; CLAUDE.md:217,250-251 updated to match. Both are variable fonts, so the CSS now requests `wght@400..600` **ranges** — 6 files / 284 KB instead of 14 pinned instances / 1.3 MB, with true 500/600 rather than 3 identical copies. Verified in Chromium: 0 CDN requests, 0 failed requests, all 8 weight/style combos `loaded` | 
| T-22 | `config.json` placeholders never filled: `media.r2PublicUrl`, `media.uploadPresetUrl`, `github.owner` still read `REPLACE_WITH_…` | Medium | `data/config.json` | DONE — 2026-08-30. `r2PublicUrl` set to the real `pub-51dbdc….r2.dev` bucket (already public in this repo as `photoBaseUrl`, so no `.env` value was copied into a tracked file); `github.owner` set to `hiteshssathawane`; `uploadPresetUrl` **deleted** rather than filled — it belonged to the deprecated in-browser upload flow (Phase 5) and nothing reads it. Note: nothing reads `config.json` at runtime at all — it is deploy metadata, not a live config |
| T-23 | CLAUDE.md drift: claims `public/index.html` and "single file, never split", but reality is root `index.html` + `tree-app.js` + `tree-helpers.js` + `tree-data.js`, bundled at build time by `encrypt.js`. `media/` and `public/` do not exist | Medium | `CLAUDE.md` | DONE — 2026-08-30. Rule 6 reworded to "one deployed page, four source files, no fifth runtime file"; architecture tree redrawn against the real repo (root `index.html`, the three JS files, `dist/`, `worker/`, `scratch/`, the full `scripts/` list, no `media/` or `public/`); added how dev script-tags vs. the bundled `window.FAMILY_DATA` build differ; Dev Commands replaced with the actual `npm run` scripts; the stale "logout button may be missing" known bug retired (it is at `index.html:3609`) |
| T-24 | Drive auto-deletion is commented out — either re-authorise the Web App execution context or document it as a manual step | Low | `scripts/sync-media.js` | DONE — 2026-08-30, documented-as-manual branch taken. The commented-out calls are gone; deletion is now real code behind `DRIVE_CLEANUP=1`, off by default, with the reason (Web App published without Drive scope) at the top of the file and the manual chore plus the re-authorise-then-enable path written up in RUN_AND_TEST.md → "Google Drive cleanup (manual)". Behaviour with the flag unset is byte-identical to before |
| T-25 | Clean `scratch/` — keep the load-bearing cross-origin iframe upload workaround, drop the rest | Low | `scratch/` | DONE — 2026-08-30. 21 probe scripts, screenshots and scratch CSVs deleted; only `scratch/test-iframe-upload.js` survives. Nothing outside `scratch/` referenced any of them. Side effect: this removed the 4 scratch copies of the family password counted in T-20 |

| T-33 | **Only 11 of 63 members can log in.** `auth.json` holds 11 entries (1 admin, 10 viewers, 0 contributors) because the identity hash is `SHA-256(name + DDMMYYYY)` and only **12 of 71** persons have a `birthDate` — 47 source rows left Birth Date blank and 5 more are year-less. There is no guest tier (T-12), so a failed hash refuses login outright: **~52 family members currently cannot open the app at all.** This is not a code bug, it is the M1 data gap meeting the auth design, and it is the single thing standing between "the tree renders" and "the family can use it" | **Critical** | `data/family.json`, live Sheet, `data/auth.json` | TODO — decide between (a) chase the 52 missing DOBs through the Form, (b) add a non-DOB identity factor, or (c) accept a smaller launch audience |

**Exit:** grep returns 0, no placeholders, secrets rotated, CLAUDE.md matches reality.

---

## M5 — Phase 6 & 7

| ID | Task | Files | Status |
|---|---|---|---|
| T-26 | Family calendar, event filters, WhatsApp deep links, iCal feed | `tree-app.js` | DONE — already built, mis-tracked as DEFER. Occasion cards carry per-person WhatsApp wish links (`tree-app.js:1473,1491`), per-person `.ics` export (`:1506,1565`) and a whole-calendar `.ics` download (`:1594,1660`), all language-aware |
| T-27 | Language toggle en ↔ mr in localStorage | `tree-app.js`, `data/i18n/` | **WIP** — the toggle *and its persistence* are built; the translation layer is not. `index.html:3882-3895` reads and writes `localStorage['family_tree_lang']`, and `:4067-4068` re-applies it right after `initTreeApp()`, so the choice **does** survive a reload — the "resets to English every reload" note was stale. `window.updateLanguage` (`tree-app.js:129`) reskins node names, the lightbox name and the calendar. Real gaps: T-27a, T-27b |
| T-27a | `data/i18n/en.json` and `mr.json` are **dead code** — no `fetch`, no `<script>` tag, no bundling step touches them; the only reference anywhere in the repo is a file path listed in `.claude/settings.json`. Either wire them up as the string source (feeding T-27b) or delete them; do not leave translation files that translate nothing | `data/i18n/`, `index.html` | TODO — **decided 2026-08-30: wire, do not delete.** Inspected: these are real hand-written Marathi UI translations (111 en leaves / 88 mr, keyed `app.*`, `login.*`, `nav.*`, `tree.*`, `profile.*`, `calendar.*`, `admin.*`, `security.*`, `errors.*`, `loading.*`, `export.*`) — exactly the string source T-27b needs, not scaffolding. Gap to fill while wiring: 23 keys exist in `en.json` with no `mr.json` counterpart, all under `admin.*` (stats, addMember roles/branch/photo, bulkImport, totp, importExport) |
| T-27b | Translation coverage is node-deep only. `updateLanguage` swaps names in the tree, the lightbox and the calendar, but every static string in `index.html` — headings, tab labels, buttons, the login form — stays English in `MR`. This is the work the i18n JSONs were meant for | `index.html`, `tree-app.js` | TODO |
| T-28 | PWA offline app shell | `sw.js`, `manifest.json` | **DONE** — 2026-08-30, unblocked by T-21. The worker had *never* activated: `STATIC_CACHE` listed four `vendor/fonts/*.woff2` files that did not exist, and one missing entry rejects `addAll()`, which aborts install. Precache list now matches the 6 real font files; `activate` also compares against `CACHE_NAME` instead of the hardcoded `'family-tree-v8'` (bumped to v9) so version bumps clean up again. Verified in Chromium: SW reaches **`activated`**, all 12 entries cached, and an offline reload serves the login shell with both fonts intact. **Closed 2026-08-30 — the "still open" item was a misdiagnosis.** The `?cacheBust` loader at `index.html:4077-4093` is the **`else` branch of `if (window.BUNDLED_MODE)`**, i.e. local dev only. In the deployed build `encrypt.js:85-100` inlines `tree-helpers.js` and `tree-app.js` (and `family.json`/`auth.json`) into `index.html`, which the worker caches on every network-first fetch — so offline production already serves the authenticated tree. Precaching the three files would have *re-broken* install exactly as the fonts did: `encrypt.js:130` copies only `manifest.json`, `sw.js`, `robots.txt` plus `assets/` and `vendor/` into `dist/`, so `tree-*.js` do not exist in production and one missing entry rejects `addAll()`. No code change made, deliberately. Residual (minor, not tracked): `assets/` is copied to `dist/` but not precached, so silhouettes 404 on a cold offline load |
| T-29 | Performance: lazy-load photos, virtualise tree beyond 300 nodes | `tree-app.js` | DEFER |

---

## Carried over from the handover — accepted, no action

- **Plaintext `family.json` in a public repo** is a deliberate tradeoff for free GitHub Pages
  hosting. Security comes from StatiCrypt on the deployed output. Roles are client-side only.
- **Google Drive Picker in-browser** was abandoned — needs OAuth client IDs and would force
  family members to log into Google on the site. Google Forms native upload replaced it.
- **Cross-origin iframe upload workaround** in `scratch/test-iframe-upload.js` is
  load-bearing: Forms renders uploads in a `docs.google.com/picker` iframe, so the helper must
  use `frameLocator` rather than a page-level selector.

---

## Recommended order of attack

*(M0 steps 1–2 below are complete. Revised order as of 2026-08-29:)*

1. ~~**T-01**, then **T-02 → T-05**~~ — **DONE**, M0 closed and verified live.
2. **M0.5 render smoke test.** Cheapest available check that `tree-app.js` /
   `tree-helpers.js` work at all, using the 2 real people + 4 stubs already loaded.
   Do this *before* the load, not after: a broken renderer discovered post-load wastes
   the load.
3. **M1a — T-08 then T-30.** Both are small and both gate the load. T-08 especially:
   without last-write-wins, refinement of 64 rows means editing the Sheet by hand.
4. **M1b — T-10.** The irreversible step. Everything above exists to de-risk it.
5. ~~**M2 / M3** at real scale, then **M4**~~ — **M2 done**, M4 hygiene largely done.

*(Revised again 2026-08-30, with M2 and most of M4 closed:)*

6. **M3 — T-15 → T-18.** The only milestone still wholly open, and the one the app is
   visibly missing. T-15 (scrapbook form) gates T-16, so start there.
7. **T-10a**, whenever the Sheet is next touched — one row, one re-pull, and the root
   person's photo stops 404-ing on first paint.
8. **T-27a / T-27b** to finish the language toggle, then **T-28 / T-29**.
9. **T-20 (secret rotation)** — the owner's call, deliberately deferred. It was deferred
   *until the pipeline works*; the pipeline works, so it is overdue, and every leaked copy
   is in git history regardless of what the working tree now shows.
10. **T-32** last — a tooling annoyance on a path nothing currently depends on.

Run `node scripts/validate.js` after every change to `data/family.json`, and
`grep -c "unpkg\|cdnjs\|jsdelivr\|googleapis" index.html` after every change to `index.html`.
