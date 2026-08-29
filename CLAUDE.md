# The Family Tree — हमारा परिवार
# Claude Code Master Instructions

---

## Project Identity
- **Name**: The Family Tree (हमारा परिवार)
- **Dedicated to**: Jyoti Sathawane (Baby) — beloved mother, remembered forever
- **Type**: Zero-cost, static HTML family genealogy web app
- **Hosting**: GitHub Pages (public repo, AES-256 encrypted) + Cloudflare R2 (photos)
- **Cost**: ₹0 / $0 forever — no backend, no database, no paid APIs
- **Stack**: Plain HTML + local vendor JS (no Vite, no npm required to run)
- **Repo**: github.com/hiteshssathawane/family-tree (single repo, single tree)

---

## How to Start Each Claude Code Session

```
Read CLAUDE.md. Family Tree project.
Current task: [one line description].
Fix it without breaking existing functionality.
```

---

## STRICT RULES — Never Violate

1. NO CDN URLs ever — all libraries must be in `vendor/` and referenced as `vendor/filename.js`
2. NO backend, NO server-side code — everything runs in the browser
3. NO paid services or APIs requiring keys
4. ALWAYS run `node scripts/validate.js` after changing `family.json`
5. NEVER commit passwords, phone numbers, or home addresses
6. The app ships as **one deployed page**. Source lives in four files at the repo root —
   `index.html` (markup, styles, auth/boot) plus `tree-helpers.js`, `tree-app.js` and the
   generated `tree-data.js` — and `scripts/encrypt.js` inlines them into a single
   `dist/index.html` at build time. Do not add a fifth runtime file, a bundler, or a module
   graph; anything new goes into one of the four
7. Use design tokens: `--family-green #1a3a2a`, `--family-gold #c8963e`, `--family-cream #faf6f0`, `--family-leaf #4a7c59`
8. Map view is REMOVED — no Leaflet, no map panel, no map nav button. Do not reintroduce it
9. After editing `index.html`, verify: `grep -c "unpkg\|cdnjs\|jsdelivr\|googleapis" index.html` → must return `0`
10. **Single connected tree** — All surnames (Sathawane, Waghmare, etc.) live in one `family.json`. Never split by family name. Maternal/paternal branches are nodes in the same graph.

---

## Architecture

```
family-tree/
├── CLAUDE.md
├── PLAN.md                       ← canonical status tracker (task IDs T-01…)
├── .claude/
│   ├── settings.json
│   ├── settings.local.json
│   └── hooks.toml
├── index.html                    ← markup, styles, auth + boot (root, not public/)
├── tree-helpers.js               ← layout engine (levels, spans, spouse placement)
├── tree-app.js                   ← rendering, profile panel, calendar, search
├── tree-data.js                  ← GENERATED snapshot — never hand-edit
├── manifest.json
├── sw.js
├── robots.txt
├── assets/                       ← app images (silhouettes, mother.png)
├── data/
│   ├── family.json               ← ALL family data (single connected tree)
│   ├── family.schema.json
│   ├── auth.json                 ← SHA-256 hashes + roles
│   ├── config.json               ← feature flags + deploy metadata (not read at runtime)
│   ├── form-responses.csv        ← last pull from the Google Sheet
│   └── i18n/                     ← en.json / mr.json — NOT loaded yet (see PLAN.md T-27)
├── vendor/                       ← ALL JS/CSS libraries (no CDN ever)
│   ├── d3.min.js
│   ├── flexsearch.bundle.js
│   ├── fonts.css
│   └── fonts/
├── scripts/
│   ├── pull-sheet.js             ← Google Sheet → family.json + auth.json
│   ├── sync-media.js             ← Drive photos → Cloudflare R2
│   ├── fill-form.js              ← Playwright bulk form filler
│   ├── generate-tree-data.js     ← family.json → tree-data.js
│   ├── csv-import.js             ← CSV rows → persons + relationships
│   ├── validate.js
│   ├── verify-pipeline.js
│   ├── setup-auth.js
│   ├── gedcom-import.js
│   ├── gedcom-export.js
│   ├── clear-data.js
│   ├── download-vendors.js
│   ├── encrypt.js                ← bundles the root files → dist/index.html
│   └── apps-script/              ← Code.gs for the Sheet Web App
├── worker/                       ← Cloudflare Worker (Phase 5, deprecated — kept for reference)
├── Family/Cropped/               ← source CSV + local photos for the bulk load
├── scratch/                      ← throwaway probes; only load-bearing files survive cleanup
├── backups/                      ← index.html backups before major edits
├── dist/                         ← BUILD OUTPUT, git-ignored — never commit
├── .github/
│   └── workflows/
│       ├── deploy.yml
│       └── sync-sheet.yml
├── package.json
└── README.md
```

**How the page gets its data.** In local dev `index.html` loads `tree-helpers.js` →
`tree-data.js` → `tree-app.js` as separate `<script>` tags. In the deployed build
`scripts/encrypt.js` inlines `tree-helpers.js` and `tree-app.js` and injects
`family.json` / `auth.json` as `window.FAMILY_DATA` / `window.AUTH_DATA`, sets
`window.BUNDLED_MODE = true`, then StatiCrypts the result to `dist/index.html`.

There is no `media/` directory and no `public/` directory. Photos live in Cloudflare R2 and
`family.json` holds absolute `https://pub-….r2.dev/…` URLs.

---

## Security Model (2 Layers — DO NOT CHANGE)

### Layer 1 — staticrypt AES-256
- Encrypts entire `index.html` before deploy
- Family password: `InLovingMemoryOfJyoti=Energy`
- Password NEVER committed to repo — set as GitHub Secret only
- GitHub Action runs staticrypt on every push to main

### Layer 2 — Name + DOB Identity Hash
- User enters name + DOB → browser computes `SHA-256(lowercase(name) + DDMMYYYY)`
- Compared against `data/auth.json`
- Match → role assigned → session stored in `sessionStorage`
- No match → login refused ("Identity verification failed"). There is no guest tier

### Screenshot Deterrence
- `@media print { body { display: none; } }`
- Page Visibility API → blur on tab switch
- Right-click disabled on photos

---

## Family Data

### Tree Structure (single connected graph — all branches in one family.json)
```
P001 Hitesh Sathawane          ← Root / Admin
P002 Shankar Sathawane         ← Father (Contributor)
P003 Jyoti Sathawane           ← Mother (née Waghmare, known as Baby) ★ Dedicated
P004 Gaurav Sathawane          ← Brother
P005 Swati Sathawane           ← Wife
P006 Dhruv Sathawane           ← Son
P007 Arjun Sathawane           ← Son

← Waghmare branch (P003's maternal family) to be added as tree expands
← All branches: same family.json, same tree, same app
```

### Auth — Hitesh (Admin)
```
Hash input : hiteshsathawane29121985
Role       : admin
```

---

## `data/auth.json` Schema

```json
{
  "entries": [
    {
      "hash": "sha256(lowercase(fullname)+DDMMYYYY)",
      "role": "admin",
      "totpRequired": false,
      "totpSecret": null,
      "displayName": "Hitesh Sathawane"
    }
  ],
  "familyPasswordHint": "Ask Hitesh on family WhatsApp"
}
```

> Note: No `branch` field — one tree, one family, no segmentation.

---

## `data/family.json` Schema

```json
{
  "meta": { "familyName", "version", "rootPersonId", "privacy" },
  "persons": [{ "id", "firstName", "lastName", "gender", "status",
                "birthDate", "birthPlace", "birthPlaceCoords",
                "deathDate", "deathPlace", "occupation", "religion",
                "education", "biography", "profilePhoto", "tags",
                "contactInfo", "private" }],
  "relationships": [{ "id", "type", "person1Id/person2Id OR parentId/childId",
                      "startDate", "endDate", "place" }],
  "events": [{ "id", "type", "personId", "date", "place", "title",
               "description", "media" }],
  "media": [{ "id", "type", "filename", "caption", "date",
               "linkedPersonIds", "linkedEventId" }]
}
```

**Relationship types**: `marriage` | `parent-child` | `adoption` | `step-parent`  
**Event types**: `birth` | `death` | `marriage` | `education` | `career` | `migration` | `medical` | `award` | `reunion` | `other`  
**Person status**: `living` | `deceased` | `unknown`  
**Roles**: `admin` | `contributor` | `viewer`

---

## Deployment

```
Repo   : hiteshssathawane/family-tree (public — safe, AES-256 encrypted)
Branch : main → auto-deploys via GitHub Actions to GitHub Pages
Secret : FAMILY_PASSWORD = InLovingMemoryOfJyoti=Energy
         (GitHub → Settings → Secrets → Actions)
```

To redeploy: Actions tab → Re-run failed jobs

---

## Contribution Flow (Phase 5 — Cloudflare Worker)

Non-technical members add data via Admin panel in the browser:
```
Admin panel (browser)
  → POST member data
  → Cloudflare Worker (free tier, holds GITHUB_TOKEN as env var)
  → GitHub API commits to main branch of family-tree repo
  → GitHub Pages rebuilds automatically
```

- One shared Cloudflare Worker for all operations
- `GITHUB_TOKEN` never touches the browser
- Non-technical members never touch Git, ever

---

## Local Libraries (vendor/ — No CDN)

| Library | File | Purpose |
|---|---|---|
| D3.js | vendor/d3.min.js | Tree layout |
| FlexSearch | vendor/flexsearch.bundle.js | Full-text search |
| Cormorant Garamond + Inter | vendor/fonts.css + vendor/fonts/ | Heritage fonts (self-hosted, offline) |

To add a library: `node scripts/download-vendors.js` or `curl` into `vendor/` — never use CDN.

---

## Dev Commands

```bash
npm run validate                                      # Validate family.json
npm run verify:pipeline                               # End-to-end pipeline assertions
npm run sheet:pull                                    # Google Sheet → family.json (+ regenerates tree-data.js)
npm run media:sync                                    # Drive photo URLs → Cloudflare R2
npm run form:status | form:next | form:all            # Playwright bulk form filler
npm run encrypt                                       # Bundle + StatiCrypt → dist/ (needs FAMILY_PASSWORD)
npm run csv:import members.csv                        # Bulk CSV import
npm run setup:auth "Hitesh Sathawane" "29121985"      # Generate hash for auth.json
npm run gedcom:in file.ged                            # Import GEDCOM
```

`sheet:pull` regenerates `tree-data.js` for you — never hand-edit that file, and never
edit `family.json` without running `npm run validate` afterwards.

---

## Known Bugs (Fix When Encountered)

Open defects are tracked in **PLAN.md** with stable IDs — check there first. The old
"logout button missing" note is resolved: the button is present at `index.html:3609`.

---

## Design Tokens

```css
--family-green:  #1a3a2a   /* Header, buttons, emblems */
--family-gold:   #c8963e   /* Accents, marriage lines, highlights */
--family-cream:  #faf6f0   /* Page background */
--family-bark:   #5c3d1e   /* Secondary text */
--family-leaf:   #4a7c59   /* Parent lines, active states */
--family-muted:  #9e9080   /* Tertiary text, hints */
--font-display:  'Cormorant Garamond', Georgia, serif
--font-body:     'Inter', system-ui, sans-serif
```

---

## Non-Technical Family Member Workflow

1. Browser → app URL → enter family password → login with name + DOB
2. Admin panel → Add member form (name, DOB, gender, relationship, photo)
3. Changes auto-commit to GitHub via Cloudflare Worker

---

## Token Efficiency Rules

- Start new chat per phase — don't extend across phases
- Run `/compact` in Claude Code every 3–4 prompts
- Reference files by path — never paste file contents into chat
- Report format: `"Fixed X — grep returned 0, commit abc1234"`
- Never paste full Claude Code output — one line summary only

---

## Responsibilities by Tool

| Tool | Responsibility |
|---|---|
| Claude Code | Edit index.html, scripts, data files |
| Antigravity | grep checks, git commit/push, backups, validate.js |
| Playwright MCP | Test at http://localhost:8000 |
| Claude in Chrome | GitHub UI tasks |

**Antigravity checklist after every edit:**
1. `grep -c "unpkg\|cdnjs\|jsdelivr\|googleapis" index.html` → must be `0`
2. `node scripts/validate.js` → must pass
3. Backup `index.html` to `backups/` before major edits
4. `git add -A && git commit && git push`
5. Verify all `vendor/` files exist and are non-zero size

---

## Build Phases

### ✅ Phase 1 — Done
Data schema, auth system, validation, GEDCOM/CSV import, GitHub Actions CI/CD, i18n (en + mr)

### ✅ Phase 2 — Done
D3 tree canvas, 5 view modes, pan/zoom, node cards, marriage/parent lines, sidebar, watermark, print layout

### ✅ Phase 3 — Done
Mobile layout (768px breakpoint), 3-node centred view, swipe navigation, bottom nav bar

### 🔲 Phase 4 — Member Profile + Timeline (CURRENT)
- Slide-in panel (desktop) / full screen (mobile)
- Scrollable vertical timeline with photos
- Tabs: Timeline | Bio | Family
- Bio: birthplace, occupation, education, religion
- Family tab: spouse, parents, children, sibling chips
- Relationship calculator: "How are these two related?"
- Birthplace shown as text in the Bio tab (map view removed — no Leaflet)

### ✅ Phase 5 — Deprecated / Removed
- *Replaced by Google Forms & Google Sheets sync pipeline.*
- The current automated form responses process (`data/form-responses.csv` pulled and merged into `family.json`) satisfies the contribution flow requirement. In-app editor and Cloudflare Worker commits are deprecated to maintain a zero-cost, zero-server architecture.


### 🔲 Phase 6 — Calendar + Events + Invitations
- Family calendar: occasions sorted by days-away
- Filter by branch name / event type
- WhatsApp deep link generator
- iCal feed (.ics) per family
- Event creator for any member

### 🔲 Phase 7 — Security + PWA + i18n + Polish
- Language toggle (en ↔ mr) in localStorage
- PWA: manifest + service worker (offline app shell)
- Performance: lazy-load photos, virtualise tree >300 nodes

---

## Zero Cost Confirmation

| Service | Use | Free Limit | Our Usage |
|---|---|---|---|
| GitHub Pages | Host app | Unlimited | Static files only |
| GitHub Actions | CI/CD | 2000 min/month | ~2 min/deploy |
| Cloudflare R2 | Photo storage | 10GB | ~1.2GB / 200 members |
| Cloudflare Workers | GitHub API proxy | 100k req/day | Occasional commits |
| staticrypt | Page encryption | Free, MIT | One CLI run per deploy |
| FlexSearch | Search | Free, MIT | Client-side only |

**Total: ₹0/month. Forever.**

---

*In loving memory of Jyoti Sathawane — Baby — whose warmth lives in every branch of this tree.*
