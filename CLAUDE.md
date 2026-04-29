# The Family Tree — Claude Code Master Instructions

## Project Identity
- **Name**: The Family Tree (हमारा परिवार)
- **Type**: Zero-cost, static HTML family genealogy web app
- **Hosting**: GitHub Pages (public repo) + Cloudflare R2 (photos)
- **Cost**: ₹0 / $0 forever — no backend, no database, no paid APIs
- **Stack**: Plain HTML + CDN JS (no Vite, no npm required to run)

---

## Architecture — Non-negotiable Rules

1. **Zero backend** — every feature runs in the browser. No server-side code ever.
2. **Public repo is safe** — the HTML is AES-256 encrypted by staticrypt. Raw repo = useless gibberish.
3. **Data source of truth** — `data/family.json` only. Never hardcode member data in JS.
4. **Privacy by design** — living persons' contact info is NEVER rendered for Guest/Viewer roles.
5. **No API keys in code** — Leaflet+OSM for maps, FlexSearch for search, no paid services.
6. **GEDCOM compatible** — every new field in `family.json` must have a GEDCOM mapping.
7. **Validate before commit** — always run `node scripts/validate.js` after changing `family.json`.
8. **Mobile-first for profiles/calendar** — desktop-first only for the tree canvas.
9. **Dynamic watermark** — injected client-side post-login. Tiled diagonal, 7% opacity, name+date.

---

## Repository Structure

```
family-tree/
├── CLAUDE.md                         ← You are here (read this first, always)
├── .claude/
│   ├── settings.json                 ← Claude Code project config
│   └── hooks.toml                    ← Pre-commit validation hooks
├── data/
│   ├── family.json                   ← ALL family data (persons, events, relationships, media)
│   ├── family.schema.json            ← JSON Schema — validate before every commit
│   ├── auth.json                     ← SHA-256 hashed credentials + TOTP secrets + roles
│   ├── config.json                   ← App config (family name, branches, feature flags)
│   └── i18n/
│       ├── en.json                   ← English UI strings
│       └── mr.json                   ← Marathi UI strings
├── media/                            ← Profile photos (Git, <1GB) OR Cloudflare R2 URLs
│   └── {person-id}/
│       └── profile.jpg
├── scripts/
│   ├── validate.js                   ← CLI: validate family.json schema + business logic
│   ├── setup-auth.js                 ← CLI: generate SHA-256 hash + TOTP QR for a member
│   ├── gedcom-import.js              ← CLI: import .ged → family.json
│   ├── gedcom-export.js              ← CLI: family.json → .ged
│   ├── csv-import.js                 ← CLI: bulk CSV → family.json
│   └── encrypt.js                    ← CLI: run staticrypt on dist/index.html
├── public/
│   ├── index.html                    ← THE ENTIRE APP (single file, all phases)
│   ├── manifest.json                 ← PWA manifest
│   ├── sw.js                         ← Service worker (offline PWA)
│   └── icons/                        ← PWA icons
├── .github/
│   └── workflows/
│       ├── validate.yml              ← Validate schema on every push/PR
│       └── deploy.yml                ← Build + encrypt + deploy to GitHub Pages
├── .gitignore
├── package.json                      ← Dev scripts only (validate, setup-auth, etc.)
└── README.md                         ← Non-technical setup guide for family admin
```

---

## Security Model (3 Layers — DO NOT CHANGE)

### Layer 1 — staticrypt AES-256 (whole page)
- Run: `npx staticrypt public/index.html FAMILY_PASSWORD -o dist/index.html`
- Family password shared on WhatsApp — NEVER committed to repo
- GitHub Action runs staticrypt on every deploy using a GitHub Secret

### Layer 2 — Name + DOB identity (SHA-256 hash)
- User enters name + DOB → browser computes `SHA-256(lowercase(name) + DDMMYYYY)`
- Hash compared against `data/auth.json` entries
- Match → role assigned (admin/contributor/viewer) → session stored in sessionStorage
- No match → Guest role (deceased ancestors only)

### Layer 3 — TOTP (Google Authenticator)
- Required only for Admin and Contributor roles
- TOTP secret stored in `data/auth.json` as base32 string
- Browser computes TOTP using `otpauth` library (CDN) — zero server needed
- Admin generates QR codes using `scripts/setup-auth.js`, sends via WhatsApp

### Watermark (post-login)
- After login, inject tiled diagonal watermark: `[FirstName LastName · DD Mon YYYY]`
- CSS: `position:fixed; inset:0; pointer-events:none; opacity:0.07; z-index:9999`
- Covers full viewport, survives scrolling
- Guest gets: `Guest · DD Mon YYYY`

### Screenshot deterrence
- `@media print { body { display: none; } }` — blank page on Ctrl+P
- Page Visibility API → blur content on tab switch
- PrintScreen keydown → full-screen flash overlay warning
- Right-click disabled on photos
- Data minimisation: guests never see content worth screenshotting

---

## Data Model — `data/family.json`

### Key schema (do not break these field names):
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

### Relationship types: `marriage` | `parent-child` | `adoption` | `step-parent`
### Event types: `birth` | `death` | `marriage` | `education` | `career` | `migration` | `medical` | `award` | `reunion` | `other`
### Person status: `living` | `deceased` | `unknown`
### Roles: `admin` | `contributor` | `viewer` | `guest`

---

## `data/auth.json` Schema

```json
{
  "entries": [
    {
      "hash": "sha256(lowercase(name)+DDMMYYYY)",
      "role": "admin",
      "branch": "sharma",
      "totpRequired": true,
      "totpSecret": "BASE32SECRETHERE",
      "displayName": "Vikram Sharma"
    }
  ],
  "familyPasswordHint": "Ask the family WhatsApp group admin"
}
```

---

## Dev Commands

```bash
node scripts/validate.js                    # Validate family.json
node scripts/setup-auth.js "Vikram Sharma" "04111972"   # Generate hash + QR
node scripts/gedcom-import.js file.ged      # Import GEDCOM
node scripts/csv-import.js members.csv      # Bulk CSV import
node scripts/encrypt.js                     # Encrypt with staticrypt (needs FAMILY_PASSWORD env)
```

No `npm install` needed to run the app — it uses CDN scripts.
`npm install` only needed for the dev scripts above (validate, setup-auth, etc.)

---

## Local Libraries (No CDN Dependencies)

All libraries are stored locally in vendor/. 
NEVER use CDN URLs in index.html. 
To add a new library: download it to vendor/ using 
node scripts/download-vendors.js or curl, then reference 
it as vendor/filename.js in index.html.

| Library | Local File | Purpose |
|---|---|---|
| D3.js | vendor/d3.min.js | Tree layout math |
| FlexSearch | vendor/flexsearch.bundle.js | Full-text search |
| Leaflet.js | vendor/leaflet.js, vendor/leaflet.css | Maps (no API key) |
| Playfair Display + Lato | vendor/fonts.css, vendor/fonts/ | Heritage fonts (offline) |

---

## Build Phases (Claude Code picks up at Phase 2)

### Phase 1 — DONE (in this repo)
- Data schema + sample data (9 members, 4 generations)
- Auth system (hash + TOTP + roles)
- Validation script
- GEDCOM import script
- CSV import script
- GitHub Actions CI/CD
- i18n string files (en + mr)
- CLAUDE.md (this file)

### Phase 2 — Tree Canvas (START HERE)
- D3-hierarchy layout engine
- 5 view modes: full, ancestor, descendant, hourglass, compact
- Pan, zoom, click-to-select node
- Node cards: avatar + name + years + occupation
- Marriage lines (gold dashed), parent lines (green)
- Sidebar: view mode buttons + scrollable member list
- Watermark injection post-login
- Print tree (A3 layout, @media print)

### Phase 3 — Mobile Tree
- Breakpoint: 768px → switch to mobile layout
- 3-node centred view: parents above, selected centre, children below
- Swipe left/right to navigate generations
- Bottom nav bar: Tree / Calendar / Search / Profile

### Phase 4 — Member Profile + Timeline
- Slide-in panel (desktop) / full screen (mobile)
- Scrollable vertical timeline with photos
- Tabs: Timeline | Bio | Family
- Bio: info rows (birthplace, occupation, education, religion)
- Family tab: spouse chips, parent chips, children chips, sibling chips
- Relationship calculator: "How are these two related?"
- Leaflet.js map pin for birthplace

### Phase 5 — Contribution Flow (non-technical)
- Add member form: mandatory fields only (name, DOB, gender, relationship)
- Photo upload → Cloudflare R2 (shared upload preset URL in config.json)
- CSV bulk import: paste CSV → preview table → confirm → merge into family.json
- GitHub API: auto-create Pull Request from browser
- Admin approves PR from phone → site redeploys in <3 mins

### Phase 6 — Calendar + Events + Invitations
- Family calendar view: occasions sorted by days-away
- Filter chips: by branch name, by event type
- WhatsApp deep link generator: `wa.me/?text=...` pre-filled with event details
- iCal feed: one .ics URL per branch (subscribe in Google/Apple Calendar)
- Event creator: any member creates custom event, selects recipients

### Phase 7 — Security + PWA + i18n + Polish
- staticrypt integration + encrypt.js script
- TOTP login flow (3 screens)
- Dynamic watermark (tiled diagonal, post-login)
- Blur on Page Visibility change
- @media print → blank page
- Language toggle (en ↔ mr) stored in localStorage
- PWA: manifest + service worker (offline cache app shell)
- GEDCOM export
- Performance: lazy-load photos, virtualise tree >300 nodes

---

## Design Tokens (match the approved mockups)

```css
--family-green:  #1a3a2a   /* Header, buttons, emblems */
--family-gold:   #c8963e   /* Accents, marriage lines, highlights */
--family-cream:  #faf6f0   /* Page background */
--family-bark:   #5c3d1e   /* Secondary text */
--family-leaf:   #4a7c59   /* Parent lines, active states, success */
--family-muted:  #9e9080   /* Tertiary text, hints */
--font-display:  'Playfair Display', Georgia, serif
--font-body:     'Lato', 'Helvetica Neue', sans-serif
```

---

## Zero Cost Confirmation

| Service | What we use | Free limit | Our usage |
|---|---|---|---|
| GitHub Pages | Hosting HTML | Unlimited | Static files only |
| GitHub Actions | CI/CD | 2000 min/month | ~2 min per deploy |
| Cloudflare R2 | Photo storage | 10GB free | ~1.2GB for 200 members |
| staticrypt | Page encryption | Free, MIT | One-time CLI run |
| Google Fonts | Typography | Free | 2 font families |
| CDN libraries | D3, Leaflet, etc. | Free | Read-only CDN |
| TOTP | Authentication | Free (math) | Client-side only |
| FlexSearch | Search | Free, MIT | Client-side only |
| WhatsApp links | Notifications | Free | URL generation only |
| iCal | Calendar subscription | Free | Static .ics file |

**Total: ₹0/month. Forever. For any number of family members.**

---

## What to Tell Claude Code at the Start of Each Session

"Read CLAUDE.md first. We are building The Family Tree — a zero-cost static genealogy app. All decisions are locked in CLAUDE.md. Pick up at [Phase N]. The data is in data/family.json. Run node scripts/validate.js before and after any data changes."
