# 🌳 The Family Tree — Setup Guide

**Zero cost. No server. No domain needed.**

---

## First-time setup (15 minutes)

### Step 1 — Install Node.js (one time only)
Download from https://nodejs.org → install → restart terminal.

### Step 2 — Install dependencies
```bash
cd family-tree
npm install
```

### Step 3 — Add your family data
Edit `data/family.json` — replace the sample Sharma family with yours.
Or use the CSV import: fill `data/sample-import.csv` and run:
```bash
node scripts/csv-import.js data/sample-import.csv
node scripts/validate.js
```

### Step 4 — Set up family member logins
For each family member:
```bash
node scripts/setup-auth.js "Full Name" "DDMMYYYY" --role viewer --branch sharma
```
This generates their identity hash + TOTP QR code (for admins/contributors).

### Step 5 — Push to GitHub
```bash
git init
git add .
git commit -m "Initial family tree"
git remote add origin https://github.com/YOUR_USERNAME/family-tree.git
git push -u origin main
```

### Step 6 — Enable GitHub Pages
GitHub → Settings → Pages → Source: GitHub Actions

### Step 7 — Add family password as GitHub Secret
GitHub → Settings → Secrets → Actions → New secret:
- Name: `FAMILY_PASSWORD`
- Value: your chosen family password (e.g. `Sharma2025`)

### Step 8 — Set up Cloudflare R2 for photos (optional but recommended)
1. Create free Cloudflare account at cloudflare.com
2. R2 → Create bucket → name it `family-tree`
3. Settings → Public access → Enable
4. Copy the public URL into `data/config.json` → `media.r2PublicUrl`

---

## Adding a new family member

**Option A — Web form (easiest)**
Open the deployed site → Admin panel → Add member form.

**Option B — CSV bulk import**
1. Download template from Admin panel
2. Fill in Excel or Google Sheets
3. Upload CSV in Admin panel → Preview → Confirm

**Option C — Command line**
```bash
node scripts/csv-import.js your-file.csv
node scripts/validate.js
git add data/family.json && git commit -m "Add new members" && git push
```

---

## Setting up a family member's login (TOTP)

1. Run: `node scripts/setup-auth.js "Vikram Sharma" "04111972" --role contributor`
2. Open the QR code URL in your browser
3. Screenshot the QR code
4. Send screenshot to Vikram on WhatsApp
5. Vikram opens Google Authenticator → + → Scan QR → done

Viewers (read-only) don't need TOTP — just name+DOB is enough for them.

---

## Changing the family password

```bash
FAMILY_PASSWORD=NewPassword node scripts/encrypt.js
git push  # GitHub Actions re-encrypts and redeploys automatically
```
Share the new password on your family WhatsApp group.

---

## Deploying to GitLab instead of GitHub

Replace `.github/workflows/deploy.yml` with the included `.gitlab-ci.yml`.
GitLab → Settings → Pages → Restrict access (built-in auth, no staticrypt needed).

---

## Zero cost breakdown

| What | Service | Free limit |
|---|---|---|
| Hosting | GitHub Pages | Unlimited |
| CI/CD | GitHub Actions | 2000 min/month |
| Photos | Cloudflare R2 | 10 GB free |
| Fonts | Google Fonts | Free |
| Maps | OpenStreetMap | Free |
| Search | FlexSearch | Free (MIT) |
| Tree layout | D3.js | Free (MIT) |
| Auth/TOTP | Browser math | Free |

**Total: ₹0 / $0 per month, forever.**

---

## Local Development

Start the development server:
```bash
./dev-server.sh
```
Open http://localhost:8000 in your browser.

The app is pure static HTML — no build step needed. The dev server serves the project root, matching exactly how GitHub Pages deploys it.

---

## Handing off to Claude Code (VS Code)

Open the folder in VS Code. Claude Code reads `CLAUDE.md` automatically.
Tell it: **"Read CLAUDE.md and continue from Phase X."**

Claude Code knows the entire plan, tech stack, design tokens, and all decisions.
You never have to re-explain the project.
