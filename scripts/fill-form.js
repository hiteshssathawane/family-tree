#!/usr/bin/env node
/**
 * Playwright script: auto-fill Google Form from Family Details.csv
 * Only processes rows that have profile images available in Family/Cropped/
 * Progress is saved in .form-progress.json so each run resumes where it left off.
 *
 * Usage:
 *   node scripts/fill-form.js             # submit the NEXT unsubmitted row (default)
 *   node scripts/fill-form.js --all       # submit ALL remaining unsubmitted rows
 *   node scripts/fill-form.js --dry-run   # print what would be submitted (no browser)
 *   node scripts/fill-form.js --status    # show which rows are done / pending
 *   node scripts/fill-form.js --name Hitesh   # (re)submit a specific person by name
 *   node scripts/fill-form.js --index 2       # (re)submit a specific row by 0-based index
 *   node scripts/fill-form.js --reset         # clear all progress and start over
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const ROOT        = join(__dirname, '..');
const CROPPED_DIR = join(ROOT, 'Family', 'Cropped');
const CSV_PATH    = join(CROPPED_DIR, 'Family Details.csv');
const PROGRESS    = join(ROOT, '.form-progress.json');
const SESSION_DIR = join(ROOT, '.playwright-session'); // Google login saved here
const FORM_URL    = 'https://docs.google.com/forms/d/e/1FAIpQLSfLHIhyFathvheAnw5Lo41fu77KifAhi8XNuzBlgn8NtibvYw/viewform';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const STATUS_ONLY = args.includes('--status');
const RUN_ALL     = args.includes('--all');
const RESET       = args.includes('--reset');
const HEADLESS    = args.includes('--headless');
const PHOTOS_ONLY = args.includes('--photos-only');
const TARGET_IDX  = args.includes('--index') ? parseInt(args[args.indexOf('--index') + 1]) : null;
const TARGET_NAME = args.includes('--name')  ? args[args.indexOf('--name')  + 1].toLowerCase() : null;

// ── Progress state ────────────────────────────────────────────────────────────
function loadProgress() {
  if (RESET) { saveProgress({}); return {}; }
  if (!existsSync(PROGRESS)) return {};
  try { return JSON.parse(readFileSync(PROGRESS, 'utf8')); }
  catch { return {}; }
}
function saveProgress(state) {
  writeFileSync(PROGRESS, JSON.stringify(state, null, 2));
}
// Key per row: "FirstName LastName" (stable enough for this dataset)
function rowKey(row) {
  return `${row['First Name (English) *']} ${row['Last Name (English) *']}`.trim();
}

// ── CSV parsing ───────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const headers = splitCSVLine(lines[0]);
  return lines.slice(1)
    .filter(l => l.trim())
    .map(l => {
      const vals = splitCSVLine(l);
      return Object.fromEntries(headers.map((h, i) => [h.trim(), (vals[i] || '').trim()]));
    });
}
function splitCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { result.push(cur); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

// ── Image resolution ──────────────────────────────────────────────────────────
function resolveImage(csvPath) {
  if (!csvPath) return null;
  const name = basename(csvPath);
  if (!name) return null;
  const local = join(CROPPED_DIR, name);
  if (!existsSync(local)) return null;
  if (local.match(/\.heic$/i)) return convertHeic(local);
  return local;
}
function convertHeic(heicPath) {
  const dest = heicPath.replace(/\.heic$/i, '_converted.jpg');
  if (!existsSync(dest)) {
    console.log(`  🔄  Converting HEIC → JPEG: ${basename(heicPath)}`);
    execSync(`sips -s format jpeg "${heicPath}" --out "${dest}"`, { stdio: 'pipe' });
  }
  return dest;
}

// ── Date parsing ──────────────────────────────────────────────────────────────
const MON = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function parseDate(s) {
  if (!s) return null;
  s = s.trim();
  let m;
  // "29-Dec-85"
  m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (m) {
    const yr = parseInt(m[3]);
    return new Date(yr > 30 ? 1900 + yr : 2000 + yr, MON[m[2].toLowerCase()], parseInt(m[1]));
  }
  // "23-May-2017"
  m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) return new Date(parseInt(m[3]), MON[m[2].toLowerCase()], parseInt(m[1]));
  // "9/4/87"  → DD/MM/YY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const yr = parseInt(m[3]);
    return new Date(yr > 30 ? 1900 + yr : 2000 + yr, parseInt(m[2]) - 1, parseInt(m[1]));
  }
  // "16-May" (no year) → skip
  if (s.match(/^\d{1,2}-[A-Za-z]{3}$/)) return null;
  return null;
}
function fmtDate(d) {
  if (!d) return null;
  return {
    month: String(d.getMonth() + 1).padStart(2, '0'),
    day:   String(d.getDate()).padStart(2, '0'),
    year:  String(d.getFullYear()),
  };
}

// ── Build eligible row list ───────────────────────────────────────────────────
const rows = parseCSV(readFileSync(CSV_PATH, 'utf8'));
const eligible = rows
  .map((row, idx) => {
    const profile = resolveImage(row['Profile Picture']);
    const bg      = resolveImage(row['Background Picture']);
    return { row, idx, profile, bg, key: rowKey(row) };
  })
  // T-30: only 11 of 64 rows have a local image, and requiring one left the other 53 with
  // no submission path at all. Uploads below are already conditional, so a photo-less row
  // simply submits without one — far better than inventing placeholder images, which
  // would write wrong faces into Drive, R2 and family.json.
  // --photos-only restores the old behaviour for staging a photo-first run.
  .filter(r => (r.row['First Name (English) *'] || '').trim())
  .filter(r => PHOTOS_ONLY ? (r.profile || r.bg) : true);

// ── Progress state ────────────────────────────────────────────────────────────
if (RESET) {
  console.log('🔄  Progress reset. All rows marked as pending.\n');
}
const progress = loadProgress();

// ── --status ──────────────────────────────────────────────────────────────────
if (STATUS_ONLY) {
  const withImages = eligible.filter(e => e.profile || e.bg).length;
  console.log(`\n📋  Form submission status (${eligible.length} rows, ${withImages} with images):\n`);
  eligible.forEach((e, i) => {
    const done = progress[e.key];
    const icon = done ? '✅' : '⏳';
    const when = done ? `  submitted ${done}` : '';
    console.log(`  ${icon}  [${i}] ${e.key}${when}`);
  });
  const pending = eligible.filter(e => !progress[e.key]).length;
  console.log(`\n  Done: ${eligible.length - pending}  |  Pending: ${pending}\n`);
  process.exit(0);
}

// ── Select which rows to process this run ─────────────────────────────────────
let toProcess;

if (TARGET_IDX !== null) {
  toProcess = eligible.filter((_, i) => i === TARGET_IDX);
} else if (TARGET_NAME !== null) {
  toProcess = eligible.filter(e =>
    e.row['First Name (English) *'].toLowerCase() === TARGET_NAME
  );
} else if (RUN_ALL) {
  // "submit ALL remaining unsubmitted rows" — it used to include completed ones, which
  // re-submitted every finished member and re-uploaded their photos on each run.
  toProcess = eligible.filter(e => !progress[e.key]);
} else if (DRY_RUN) {
  toProcess = eligible;
} else {
  // Default: ONE row — the next unsubmitted one
  const next = eligible.find(e => !progress[e.key]);
  toProcess = next ? [next] : [];
}

if (toProcess.length === 0) {
  const allDone = eligible.every(e => progress[e.key]);
  if (allDone) {
    console.log('🎉  All rows have already been submitted!');
    console.log('    Run with --reset to clear progress and start over.\n');
  } else {
    console.error('❌  No rows match the given filter.');
  }
  process.exit(0);
}

// ── Print summary ─────────────────────────────────────────────────────────────
const pending = eligible.filter(e => !progress[e.key]);
console.log(`\n🖼️   ${eligible.length} rows have images  |  ${pending.length} still pending`);

if (!DRY_RUN && !TARGET_IDX && !TARGET_NAME) {
  const nextIdx = eligible.indexOf(toProcess[0]);
  const remaining = pending.length - 1;
  console.log(`▶   This run: [${nextIdx}] ${toProcess[0].key}`);
  if (remaining > 0)
    console.log(`    After this: ${remaining} more row(s) pending — run again to continue\n`);
  else
    console.log(`    This is the last pending row\n`);
}

// ── Dry run ───────────────────────────────────────────────────────────────────
function printRow({ row: R, profile, bg }) {
  console.log(`  Name           : ${R['First Name (English) *']} (${R['First Name (Marathi - पहिले नाव) *']}) ${R['Last Name (English) *']} (${R['Last Name (Marathi - आडनाव) *']})`);
  console.log(`  Mobile         : ${R['Mobile Number']}`);
  console.log(`  Gender/Status  : ${R['Gender *']} / ${R['Status *']} / ${R['Marital Status *']}`);
  console.log(`  Father/Mother  : ${R['Father Name (English) *']} / ${R['Mother Name (English) *']}`);
  console.log(`  Spouse         : ${R['Spouse First Name (Mandatory if Married)']} ${R['Spouse Last Name']}`);
  const bd = parseDate(R['Birth Date *']);
  console.log(`  Birth          : ${R['Birth Date *']} → ${bd ? JSON.stringify(fmtDate(bd)) : 'SKIP (no year)'}  @ ${R['Birth Place *']}`);
  const dd = parseDate(R['Death Date (If applicable, only if Status is Deceased)']);
  if (dd) console.log(`  Death          : ${R['Death Date (If applicable, only if Status is Deceased)']} → ${JSON.stringify(fmtDate(dd))}`);
  console.log(`  Profile image  : ${profile || 'none'}`);
  console.log(`  Background img : ${bg || 'none'}`);
  console.log(`  Already done?  : ${progress[rowKey(R)] ? '✅ YES — will resubmit' : '⏳ no'}`);
}

if (DRY_RUN) {
  console.log('\n=== DRY RUN — would submit these rows: ===\n');
  toProcess.forEach(e => {
    console.log(`--- [${e.idx}] ${e.key} ---`);
    printRow(e);
    console.log('');
  });
  process.exit(0);
}

// ── Google Forms helpers ──────────────────────────────────────────────────────
async function findQuestion(page, pattern) {
  const re = new RegExp(pattern, 'i');
  for (const sel of ['.Qr7Oae', '[data-params]', '.freebirdFormviewerViewItemsItemItem']) {
    const items = page.locator(sel);
    const n = await items.count();
    for (let i = 0; i < n; i++) {
      const item = items.nth(i);
      const text = await item.textContent().catch(() => '');
      if (re.test(text)) return item;
    }
  }
  return null;
}

async function fillText(page, pattern, value) {
  if (!value) return;
  const q = await findQuestion(page, pattern);
  if (!q) { console.log(`  ⚠️  Not found: ${pattern}`); return; }
  const inp = q.locator('input[type="text"]');
  const ta  = q.locator('textarea');
  if (await inp.count()) await inp.first().fill(value);
  else if (await ta.count()) await ta.first().fill(value);
  else console.log(`  ⚠️  No input in: ${pattern}`);
}

// Forms carries the option value on the radio's own data-value / aria-label; the radio
// element itself has NO text. So `getByText('Male')` matched the sibling label span, and
// `filter({ hasText })` over [role=radio] could never match at all.
async function isRadioChecked(q, optionText) {
  const checked = q.locator('[role="radio"][aria-checked="true"]');
  const n = await checked.count();
  for (let i = 0; i < n; i++) {
    const el = checked.nth(i);
    const val = (await el.getAttribute('data-value')) || (await el.getAttribute('aria-label')) || '';
    if (val.trim() === optionText) return true;
  }
  return false;
}

// Only ever called for required radio fields (Gender *, Status *, Marital Status *).
// Must throw rather than warn-and-continue: a swallowed failure here previously let
// the row reach Submit with that field blank, silently corrupting the imported data.
//
// Clicking is not enough — verify aria-checked actually flipped. The label-span click
// above "succeeded" (the element existed and was clickable) while selecting nothing, so
// the row submitted with Gender/Status/Marital Status blank and clickRadio never threw.
// That only showed up headless: slowMo on a headed run hid the race.
async function clickRadio(page, pattern, optionText) {
  if (!optionText) throw new Error(`Required field has no value to submit: ${pattern}`);
  const q = await findQuestion(page, pattern);
  if (!q) throw new Error(`Radio question not found on form: ${pattern}`);

  const candidates = [
    q.locator(`[role="radio"][data-value="${optionText}"]`),
    q.locator(`[role="radio"][aria-label="${optionText}"]`),
    q.getByText(optionText, { exact: true }),
  ];

  for (const candidate of candidates) {
    if (!(await candidate.count())) continue;
    const el = candidate.first();
    for (let attempt = 0; attempt < 3; attempt++) {
      await el.click({ timeout: 5000 }).catch(() => {});
      if (await isRadioChecked(q, optionText)) return;
      await page.waitForTimeout(300);
    }
  }
  throw new Error(`Radio option "${optionText}" never became selected in question: ${pattern}`);
}

async function fillDate(page, pattern, dateStr) {
  if (!dateStr) return;
  const d = parseDate(dateStr);
  if (!d) { console.log(`  ⚠️  Date skipped (no year): ${dateStr}`); return; }
  const parts = fmtDate(d);
  const q = await findQuestion(page, pattern);
  if (!q) { console.log(`  ⚠️  Date field not found: ${pattern}`); return; }
  const nums = q.locator('input[type="number"]');
  if (await nums.count() >= 3) {
    await nums.nth(0).fill(parts.month);
    await nums.nth(1).fill(parts.day);
    await nums.nth(2).fill(parts.year);
    return;
  }
  const di = q.locator('input[type="date"]');
  if (await di.count()) { await di.first().fill(`${parts.year}-${parts.month}-${parts.day}`); return; }
  const texts = q.locator('input[type="text"]');
  if (await texts.count() >= 3) {
    await texts.nth(0).fill(parts.month);
    await texts.nth(1).fill(parts.day);
    await texts.nth(2).fill(parts.year);
    return;
  }
  console.log(`  ⚠️  Cannot find date inputs for: ${pattern}`);
}

// Forms renders its uploader inside a cross-origin Drive picker iframe whose `name`
// is regenerated every session, so it can never be addressed by a fixed selector —
// find it by URL among the live frames instead.
// Matching the first /picker frame is not enough: after an upload the spent picker
// stays in the DOM, so the second upload kept binding to that dead frame and timed out
// looking for a Browse button that was no longer there. Identify the live picker by
// the presence of a visible Browse button instead.
async function findLivePicker(page, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const f of page.frames()) {
      if (!/\/picker/.test(f.url())) continue;
      const btn = f.getByRole('button', { name: 'Browse' }).first();
      if (await btn.isVisible().catch(() => false)) return f;
    }
    await page.waitForTimeout(300);
  }
  return null;
}

// Throws rather than warn-and-continue, for the same reason clickRadio does, plus one
// more: a failed upload leaves the picker modal covering the page, so the later Submit
// click times out against the overlay. Warning here cost the photo AND the submission.
async function uploadFile(page, pattern, filePath) {
  if (!filePath) return;
  const q = await findQuestion(page, pattern);
  if (!q) throw new Error(`Upload field not found on form: ${pattern}`);

  // Forms restores a saved draft on load, so a file left by an earlier run would
  // otherwise ride along into this person's response.
  const removeBtn = q.locator('[aria-label*="Remove" i], [data-tooltip*="Remove" i]');
  while (await removeBtn.count()) {
    console.log(`  🧹  Clearing a file left in the form draft`);
    await removeBtn.first().click();
    await page.waitForTimeout(1500);
  }

  // The button carries the question's own name ("Profile Picture"), not "Add file".
  await q.getByRole('button', { name: pattern }).first()
    .or(page.getByRole('button', { name: pattern }).first())
    .click();

  // The file input does not exist until Browse is clicked — this step is why every
  // earlier attempt reported "no file inputs inside iframe".
  const picker = await findLivePicker(page);
  if (!picker) throw new Error(`Drive picker never opened for: ${pattern}`);

  // Browse pops the native OS file dialog. Claim it as a Playwright filechooser so no
  // OS-level window is left hanging over the page — relying on setInputFiles to win
  // that race left a stray macOS dialog open on an earlier run.
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 }).catch(() => null);
  await picker.getByRole('button', { name: 'Browse' }).first().click();
  const chooser = await chooserPromise;
  if (chooser) await chooser.setFiles(filePath);
  else await picker.locator('input[type="file"]').first().setInputFiles(filePath);

  // Done only once Forms shows the file chip; without this, Submit races the upload.
  await q.getByText(basename(filePath), { exact: false }).first()
    .waitFor({ state: 'visible', timeout: 120000 })
    .catch(() => { throw new Error(`Upload never completed for ${basename(filePath)} in: ${pattern}`); });
  console.log(`  ✔   Attached ${basename(filePath)}`);
}

// ── Main loop ─────────────────────────────────────────────────────────────────
// Uses the real Chrome browser (channel: 'chrome') so Google allows sign-in.
// Playwright's bundled Chromium triggers Google's "insecure browser" block.
// Session is saved in .playwright-session/ — sign in once, reused forever.
const context = await chromium.launchPersistentContext(SESSION_DIR, {
  channel: 'chrome',          // real Chrome, not Playwright's bundled Chromium
  headless: HEADLESS,
  slowMo: HEADLESS ? 0 : 200,
  viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
});

for (let i = 0; i < toProcess.length; i++) {
  const entry   = toProcess[i];
  const { row: R, profile, bg, key } = entry;
  console.log(`\n🧑  [${i + 1}/${toProcess.length}] ${key}`);

  const page = await context.newPage();
  try {
    await page.goto(FORM_URL, { waitUntil: 'networkidle' });

    await fillText(page,  'Mobile Number',           R['Mobile Number']);
    await fillText(page,  'First Name.*English',     R['First Name (English) *']);
    await fillText(page,  'First Name.*Marathi',     R['First Name (Marathi - पहिले नाव) *']);
    await fillText(page,  'Last Name.*English',      R['Last Name (English) *']);
    await fillText(page,  'Last Name.*Marathi',      R['Last Name (Marathi - आडनाव) *']);
    await fillText(page,  'Alias',                   R['Alias']);
    await fillText(page,  'Father Name',             R['Father Name (English) *']);
    await fillText(page,  'Mother Name',             R['Mother Name (English) *']);
    await fillText(page,  'Spouse First Name',       R['Spouse First Name (Mandatory if Married)']);
    await fillText(page,  'Spouse Father Name',      R['Spouse Father Name']);
    await fillText(page,  'Spouse Mother Name',      R['Spouse Mother Name']);
    await fillText(page,  'Spouse Last Name',        R['Spouse Last Name']);
    await fillText(page,  'Birth Place',             R['Birth Place *']);
    await fillText(page,  'Death Place',             R['Death Place (If applicable, only if Status is Deceased)']);
    await fillText(page,  'Occupation',              R['Occupation']);
    await fillText(page,  'Education Details',       R['Education Details (Free text field for specific qualifications)']);
    await fillText(page,  'Location.*City',          R['Location (Current City/Region) *']);
    await fillText(page,  'Biography',               R['Biography']);

    await clickRadio(page, 'Gender',         R['Gender *']);
    await clickRadio(page, '^Status',        R['Status *']);
    await clickRadio(page, 'Marital Status', R['Marital Status *']);

    await fillDate(page, 'Marriage Date', R['Marriage Date']);
    await fillDate(page, 'Birth Date',    R['Birth Date *']);
    await fillDate(page, 'Death Date',    R['Death Date (If applicable, only if Status is Deceased)']);

    if (profile) { console.log(`  📸  Uploading profile: ${basename(profile)}`); await uploadFile(page, 'Profile Picture', profile); }
    if (bg)      { console.log(`  🖼️   Uploading bg: ${basename(bg)}`);           await uploadFile(page, 'Background Picture', bg); }

    console.log(`  ✅  Submitting…`);
    const submitBtn = page.getByRole('button', { name: /submit/i }).or(
      page.locator('[value="Submit"], .freebirdFormviewerViewNavigationSubmitButton')
    );
    await submitBtn.first().click();

    let submitted = false;
    try {
      await page.waitForSelector('text=/response has been recorded|Thank you/i', { timeout: 10000 });
      submitted = true;
      console.log(`  🎉  Submitted!`);
    } catch {
      console.log(`  ⚠️  No confirmation — check the browser window`);
      if (!HEADLESS) await page.waitForTimeout(5000);
    }

    // Save progress immediately after each row
    if (submitted) {
      progress[key] = new Date().toISOString();
      saveProgress(progress);
    }
  } catch (err) {
    // A required field (Gender/Status/Marital Status/etc.) couldn't be set — do NOT
    // submit this row. Better a row stuck pending than one silently corrupted.
    console.log(`  ❌  Row aborted, NOT submitted: ${err.message}`);
    if (!HEADLESS) await page.waitForTimeout(5000);
  } finally {
    await page.close();
  }

  if (i < toProcess.length - 1) {
    console.log(`  ⏳  3 s before next…`);
    await new Promise(r => setTimeout(r, 3000));
  }
}

await context.close();

// Show what's still pending
const stillPending = eligible.filter(e => !progress[e.key]);
if (stillPending.length > 0) {
  console.log(`\n📋  ${stillPending.length} row(s) still pending:`);
  stillPending.forEach((e, i) => console.log(`     [${i === 0 ? '▶ next' : '    '}] ${e.key}`));
  console.log(`\n    Run again to submit the next one, or --all for the rest.\n`);
} else {
  console.log(`\n🎉  All rows submitted! Run --status to review.\n`);
}
