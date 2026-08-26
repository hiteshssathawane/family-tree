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
  .filter(r => r.profile || r.bg);

// ── Progress state ────────────────────────────────────────────────────────────
if (RESET) {
  console.log('🔄  Progress reset. All rows marked as pending.\n');
}
const progress = loadProgress();

// ── --status ──────────────────────────────────────────────────────────────────
if (STATUS_ONLY) {
  console.log(`\n📋  Form submission status (${eligible.length} rows with images):\n`);
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
} else if (DRY_RUN || RUN_ALL) {
  // dry-run or --all: process all eligible rows (ignoring progress)
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

async function clickRadio(page, pattern, optionText) {
  if (!optionText) return;
  const q = await findQuestion(page, pattern);
  if (!q) { console.log(`  ⚠️  Radio not found: ${pattern}`); return; }
  try { await q.getByText(optionText, { exact: true }).first().click(); }
  catch {
    const radio = q.locator('[role="radio"]').filter({ hasText: optionText }).first();
    if (await radio.count()) await radio.click();
    else console.log(`  ⚠️  Option "${optionText}" not found in: ${pattern}`);
  }
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

async function uploadFile(page, pattern, filePath) {
  if (!filePath) return;
  const q = await findQuestion(page, pattern);
  if (!q) { console.log(`  ⚠️  Upload field not found: ${pattern}`); return; }
  const fileIn = q.locator('input[type="file"]');
  if (await fileIn.count()) {
    await fileIn.first().setInputFiles(filePath);
    await page.waitForTimeout(1500);
    return;
  }
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      q.locator('button, [role="button"]').first().click(),
    ]);
    await chooser.setFiles(filePath);
    await page.waitForTimeout(2000);
  } catch {
    console.log(`  ⚠️  File chooser not triggered for: ${pattern}`);
    console.log(`       Upload manually: ${filePath}`);
  }
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

  await page.close();

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
