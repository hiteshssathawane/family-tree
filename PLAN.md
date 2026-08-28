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

---

## Milestones

Strictly ordered. Each milestone's exit criterion gates the next.

| # | Milestone | Why it is here | Exit criterion |
|---|---|---|---|
| **M0** | Pipeline correctness | Everything downstream inherits these bugs | One form submission round-trips with correct DOB, correct gender, and exactly one auth entry |
| **M1** | Load the real 63 | The app has no real content to render or design against | 63 persons in `family.json`, every photo on an R2 URL, `validate.js` green |
| **M2** | Tree rendering | Known layout bug only manifests at real scale | Full 63-node tree renders, no crossed spouse lines, desktop + mobile |
| **M3** | Phase 4 — profile & timeline | The original in-flight phase, now on solid data | Click a member → panel with real timeline entries and photos |
| **M4** | Hygiene & hardening | Live rule violations and exposed secrets | `grep` returns 0, no config placeholders, secrets rotated, CLAUDE.md matches reality |
| **M5** | Phase 6 & 7 | Calendar, PWA, i18n, performance | Per CLAUDE.md phase definitions |

---

## M0 — Pipeline Correctness  `BLOCKER`

| ID | Task | Severity | Files | Status |
|---|---|---|---|---|
| T-01 | Fix IST date off-by-one. Return display values for date columns from Apps Script (`getDisplayValues()` or `Utilities.formatDate` with sheet TZ); harden `formatDate()` to reject a bare `split('T')` on a timestamp | Critical | Apps Script `Code.gs`, `scripts/pull-sheet.js:31-40` | TODO |
| T-02 | Delete the bogus `b4893b68…` viewer entry. Add dedupe so a `displayName` never gets a second auto-created entry, and auto-created entries never silently downgrade an existing admin | Critical | `data/auth.json`, `scripts/csv-import.js` | TODO |
| T-03 | Gender arrives as `X`. The sheet holds `Male` and `pull-sheet.js:134` maps `m*`→`M` correctly, so the value never reached the sheet — audit radio-button handling in `fill-form.js` | High | `scripts/fill-form.js` | TODO |
| T-04 | Harden spouse-gender inference: `const sGender = row.gender === 'M' ? 'F' : 'M'` flips a wife to `M` whenever the husband is `X`. This is the real cause of the "Swati Biradar gender bug" | High | `scripts/csv-import.js:325` | TODO |
| T-05 | Re-derive Hitesh end to end; assert DOB `1985-12-29`, gender `M`, Swati `F`, exactly one admin auth entry | High | verification | TODO |

**Exit:** submit one form → correct DOB, correct gender, one auth entry.

---

## M1 — Load the Real 63

| ID | Task | Severity | Files | Status |
|---|---|---|---|---|
| T-06 | `profilePhoto` still holds `drive.google.com/open?id=…` — the R2 rewrite is not landing. Verify `sync-media.js` uploads and rewrites | High | `scripts/sync-media.js`, `data/config.json` | TODO |
| T-07 | Spouse's parents (Bhimrao, Chaya) appear inside composite IDs but are never created as person nodes — in-law branches dangle | High | `scripts/csv-import.js:305-333` | TODO |
| T-08 | Replace skip-on-duplicate with upsert/merge, so a corrected resubmission can actually fix a member. Today there is no way to correct data through the form | High | `scripts/csv-import.js` | TODO |
| T-09 | HEIC photos (`Gaurav.HEIC`, `Dhruv.heic`, `Arjun_bg.heic`) do not render in browsers — convert during media sync | Medium | `scripts/sync-media.js` | TODO |
| T-10 | Load all 63 rows from `Family/Cropped/Family Details.csv`; run `validate.js`; spot-check 5 records against source | High | `data/family.json` | TODO |

**Exit:** 63 persons, all photos on R2 https URLs, validator green.

---

## M2 — Tree Rendering

| ID | Task | Severity | Files | Status |
|---|---|---|---|---|
| T-11 | Spouse cross-connection bug: for in-laws placed recursively *after* the primary node, `wParentX` is `null`, bypassing the swap check and crossing maternal lines | High | `tree-helpers.js:694-725` | TODO |
| T-12 | Guest sees a blank canvas — render "Log in to see your family tree" in the SVG | Medium | `tree-app.js` | TODO |
| T-13 | Apply branch colouring from `config.json` (Sathawane / Waghmare / Biradar) | Low | `tree-app.js` | TODO |
| T-14 | Layout sanity pass at 63 nodes, desktop and 768px mobile | Medium | verification | TODO |

**Exit:** full tree renders, no crossed lines, both breakpoints.

---

## M3 — Phase 4: Profile & Timeline

| ID | Task | Severity | Files | Status |
|---|---|---|---|---|
| T-15 | Scrapbook form is undocumented (URL unknown) and has no photo or tag columns, while `pull-sheet.js:235-236` searches for both. Rebuild or extend the form, then re-point | High | Google Form, `scripts/pull-sheet.js` | TODO |
| T-16 | Render the scrapbook timeline with live data — the UI is wired but has never been fed | High | `tree-app.js:822-831`, `index.html:3566-3571` | TODO |
| T-17 | Bio tab (birthplace, occupation, education, religion) and Family tab (spouse, parents, children, sibling chips) | Medium | `tree-app.js`, `index.html` | TODO |
| T-18 | Relationship calculator — "how are these two related?" | Medium | `tree-helpers.js` | TODO |
| T-19 | Leaflet birthplace pin **inside the profile panel only**; nav button stays hidden per rule 8 | Low | `tree-app.js` | TODO |

**Exit:** click a member → panel with real timeline entries and photos.

---

## M4 — Hygiene & Hardening

| ID | Task | Severity | Files | Status |
|---|---|---|---|---|
| T-20 | **Rotate exposed secrets.** The family password is committed in plaintext in `CLAUDE.md:95`, `CLAUDE.md:188`, `RUN_AND_TEST.md:56`, `scripts/clear-data.js:215` and 4 `scratch/` files — violating CLAUDE.md's own rule 5. The Apps Script HMAC secret `MyFamilyTreeSecureToken2026` is in the handover doc | Critical | multiple | TODO |
| T-21 | Google Fonts CDN at `index.html:9` and `:12` violates rules 1 and 9 — `grep` returns **2**, must be **0**. `vendor/fonts.css` exists but `vendor/fonts/` does not. Self-host the faces | High | `index.html`, `vendor/fonts/` | TODO |
| T-22 | `config.json` placeholders never filled: `media.r2PublicUrl`, `media.uploadPresetUrl`, `github.owner` still read `REPLACE_WITH_…` | Medium | `data/config.json` | TODO |
| T-23 | CLAUDE.md drift: claims `public/index.html` and "single file, never split", but reality is root `index.html` + `tree-app.js` + `tree-helpers.js` + `tree-data.js`, bundled at build time by `encrypt.js`. `media/` and `public/` do not exist | Medium | `CLAUDE.md` | TODO |
| T-24 | Drive auto-deletion is commented out — either re-authorise the Web App execution context or document it as a manual step | Low | `scripts/sync-media.js:172-173,215-216` | TODO |
| T-25 | Clean `scratch/` — keep the load-bearing cross-origin iframe upload workaround, drop the rest | Low | `scratch/` | TODO |

**Exit:** grep returns 0, no placeholders, secrets rotated, CLAUDE.md matches reality.

---

## M5 — Phase 6 & 7

| ID | Task | Files | Status |
|---|---|---|---|
| T-26 | Family calendar, event filters, WhatsApp deep links, iCal feed | `tree-app.js` | DEFER |
| T-27 | Language toggle en ↔ mr in localStorage | `tree-app.js`, `data/i18n/` | DEFER |
| T-28 | PWA offline app shell | `sw.js`, `manifest.json` | DEFER |
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

1. **T-01** first, alone. It is a small change, it is the root cause of T-02 and of every
   future bad birthday, and it is cheap to verify against one known record.
2. **T-02 → T-05**, closing out M0 with one clean round-trip through the real pipeline.
3. Only then **M1**. Loading 63 rows before M0 is green means importing 63 defects and
   redoing the work.

Run `node scripts/validate.js` after every change to `data/family.json`, and
`grep -c "unpkg\|cdnjs\|jsdelivr\|googleapis" index.html` after every change to `index.html`.
