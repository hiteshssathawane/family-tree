#!/usr/bin/env node
/**
 * Playwright script: submit test memories to the Family Scrapbook Google Form.
 * Companion to fill-form.js — same session, same Google Forms interaction patterns,
 * with a selectDropdown() helper added for this form's three dropdown questions.
 *
 * The "Who is writing" / "Whom is this about" dropdowns are populated by a form-bound
 * Apps Script (updateFormDropdowns(), see PLAN.md T-15c) that has no trigger and must be
 * run by hand after any member load. Only people already in that dropdown can be used
 * here — check scratch/inspect-scrapbook-form.cjs output before adding new ENTRIES.
 *
 * Usage:
 *   node scripts/fill-scrapbook-form.js             # submit all ENTRIES below
 *   node scripts/fill-scrapbook-form.js --headless  # no visible browser window
 *   node scripts/fill-scrapbook-form.js --dry-run   # print what would be submitted
 */

import { chromium } from 'playwright';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const ROOT        = join(__dirname, '..');
const CROPPED_DIR = join(ROOT, 'Family', 'Cropped');
const SESSION_DIR = join(ROOT, '.playwright-session'); // same saved Google login as fill-form.js
const FORM_URL    = 'https://docs.google.com/forms/d/e/1FAIpQLScvHzdX53qHkiRd7p-_kiIr6l_oNiriMeW4TTieQONywiC3oA/viewform';

const args     = process.argv.slice(2);
const HEADLESS = args.includes('--headless');
const DRY_RUN  = args.includes('--dry-run');
const LIMIT    = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;

// ── Test entries ─────────────────────────────────────────────────────────────
// Only Hitesh Sathawane / Swati Biradar are in the live dropdown as of this writing
// (see scratch/inspect-scrapbook-form.cjs output — the other 8 aren't there until
// updateFormDropdowns() is re-run). date: null exercises the "Unknown Date" fallback
// in tree-helpers.js's timeline sort.
const ENTRIES = [
  {
    writer: 'Hitesh Sathawane',
    about:  'Hitesh Sathawane',
    type:   '💍 Marriage / Wedding Anniversary',
    title:  'Wedding Day',
    date:   '2015-05-02',
    place:  'Nagpur',
    story:  'Married Swati in Nagpur — the whole family travelled in for the wedding.',
    photo:  join(CROPPED_DIR, 'Hitesh.png'),
  },
  {
    writer: 'Hitesh Sathawane',
    about:  'Hitesh Sathawane',
    type:   '🎂 Birth / Child Arrival',
    title:  'Became a Father',
    date:   '2021-11-08',
    place:  'Dombivli',
    story:  'Became a father for the first time when Dhruv was born.',
    photo:  null,
  },
  {
    writer: 'Hitesh Sathawane',
    about:  'Hitesh Sathawane',
    type:   '📖 Memory / Story / Anecdote',
    title:  'Sahyadris Trek',
    date:   null,
    place:  '',
    story:  'A family trek in the Sahyadris — exact date lost, but everyone remembers the rain.',
    photo:  null,
  },
  {
    writer: 'Swati Biradar',
    about:  'Swati Biradar',
    type:   '🎂 Birth / Child Arrival',
    title:  "Arjun's Birth",
    date:   '2025-12-02',
    place:  'Dombivli',
    story:  'Welcomed Arjun into the world — Dhruv was thrilled to be a big brother.',
    photo:  join(CROPPED_DIR, 'Swati.jpg'),
  },
];

if (DRY_RUN) {
  console.log('\n=== DRY RUN — would submit these entries: ===\n');
  ENTRIES.forEach((e, i) => {
    console.log(`--- [${i}] ${e.about} — ${e.title} ---`);
    console.log(JSON.stringify(e, null, 2));
  });
  process.exit(0);
}

// ── Google Forms helpers (shared pattern with fill-form.js) ───────────────────
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

async function fillDate(page, pattern, isoDate) {
  if (!isoDate) return;
  const [year, month, day] = isoDate.split('-');
  const q = await findQuestion(page, pattern);
  if (!q) { console.log(`  ⚠️  Date field not found: ${pattern}`); return; }
  const nums = q.locator('input[type="number"]');
  if (await nums.count() >= 3) {
    await nums.nth(0).fill(month);
    await nums.nth(1).fill(day);
    await nums.nth(2).fill(year);
    return;
  }
  const di = q.locator('input[type="date"]');
  if (await di.count()) { await di.first().fill(`${year}-${month}-${day}`); return; }
  console.log(`  ⚠️  Cannot find date inputs for: ${pattern}`);
}

// Google Forms dropdowns render their option list in a body-level portal, so once
// opened the options are matched globally on the page, scoped to the visible ones —
// a closed dropdown's stale option nodes can linger in the DOM but are not :visible.
async function selectDropdown(page, pattern, optionText) {
  if (!optionText) return;
  const q = await findQuestion(page, pattern);
  if (!q) throw new Error(`Dropdown not found: ${pattern}`);
  await q.locator('[role="listbox"]').first().click();
  const option = page.locator('[role="option"]:visible').filter({ hasText: optionText });
  await option.first().waitFor({ state: 'visible', timeout: 5000 });
  await option.first().click();
  await page.waitForTimeout(200);
  const selectedText = await q.locator('[role="listbox"]').first().textContent();
  if (!selectedText || !selectedText.includes(optionText)) {
    throw new Error(`Dropdown option "${optionText}" did not stick in question: ${pattern}`);
  }
}

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

async function uploadFile(page, pattern, filePath) {
  if (!filePath) return;
  const q = await findQuestion(page, pattern);
  if (!q) throw new Error(`Upload field not found on form: ${pattern}`);

  const removeBtn = q.locator('[aria-label*="Remove" i], [data-tooltip*="Remove" i]');
  while (await removeBtn.count()) {
    console.log(`  🧹  Clearing a file left in the form draft`);
    await removeBtn.first().click();
    await page.waitForTimeout(1500);
  }

  await q.getByRole('button', { name: /add file|upload/i }).first().click();

  const picker = await findLivePicker(page);
  if (!picker) throw new Error(`Drive picker never opened for: ${pattern}`);

  const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 }).catch(() => null);
  await picker.getByRole('button', { name: 'Browse' }).first().click();
  const chooser = await chooserPromise;
  if (chooser) await chooser.setFiles(filePath);
  else await picker.locator('input[type="file"]').first().setInputFiles(filePath);

  await q.getByText(basename(filePath), { exact: false }).first()
    .waitFor({ state: 'visible', timeout: 120000 })
    .catch(() => { throw new Error(`Upload never completed for ${basename(filePath)} in: ${pattern}`); });
  console.log(`  ✔   Attached ${basename(filePath)}`);
}

// ── Main loop ─────────────────────────────────────────────────────────────────
const context = await chromium.launchPersistentContext(SESSION_DIR, {
  channel: 'chrome',
  headless: HEADLESS,
  slowMo: HEADLESS ? 0 : 200,
  viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
});

const toRun = LIMIT ? ENTRIES.slice(0, LIMIT) : ENTRIES;
let submittedCount = 0;
for (let i = 0; i < toRun.length; i++) {
  const e = toRun[i];
  console.log(`\n📝  [${i + 1}/${ENTRIES.length}] ${e.about} — "${e.title}"`);

  const page = await context.newPage();
  try {
    await page.goto(FORM_URL, { waitUntil: 'networkidle' });

    await selectDropdown(page, 'Who is writing this memory', e.writer);
    await selectDropdown(page, 'Whom is this memory.*about', e.about);
    await selectDropdown(page, 'What type of event is this', e.type);
    await fillText(page, 'Title of the Memory', e.title);
    await fillDate(page, 'Event Date', e.date);
    await fillText(page, 'Location.*City', e.place);
    await fillText(page, 'The Story', e.story);
    if (e.photo) { console.log(`  📸  Uploading: ${basename(e.photo)}`); await uploadFile(page, 'Upload Photos', e.photo); }

    console.log(`  ✅  Submitting…`);
    const submitBtn = page.getByRole('button', { name: /submit/i }).or(
      page.locator('[value="Submit"], .freebirdFormviewerViewNavigationSubmitButton')
    );
    await submitBtn.first().click();

    await page.waitForSelector('text=/response has been recorded|Thank you/i', { timeout: 10000 });
    console.log(`  🎉  Submitted!`);
    submittedCount++;
  } catch (err) {
    console.log(`  ❌  Entry aborted, NOT submitted: ${err.message}`);
    if (!HEADLESS) await page.waitForTimeout(5000);
  } finally {
    await page.close();
  }

  if (i < toRun.length - 1) {
    console.log(`  ⏳  3 s before next…`);
    await new Promise(r => setTimeout(r, 3000));
  }
}

await context.close();
console.log(`\n🎉  ${submittedCount}/${toRun.length} scrapbook entries submitted.\n`);
