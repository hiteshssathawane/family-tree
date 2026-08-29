import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const ROOT        = join(__dirname, '..');
const SESSION_DIR = join(ROOT, '.playwright-session');
const FORM_URL    = 'https://docs.google.com/forms/d/e/1FAIpQLSfLHIhyFathvheAnw5Lo41fu77KifAhi8XNuzBlgn8NtibvYw/viewform';

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

async function run() {
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();
  console.log('Navigating to form...');
  await page.goto(FORM_URL, { waitUntil: 'networkidle' });

  const q = await findQuestion(page, 'Profile Picture');
  if (!q) {
    console.error('Profile Picture question not found!');
    await context.close();
    return;
  }

  // Check if a file is already uploaded and remove it
  const removeBtn = q.locator('[aria-label="Remove file"]');
  const hasUploaded = await removeBtn.count();
  if (hasUploaded > 0) {
    console.log('Found already uploaded file. Clicking Remove file...');
    await removeBtn.first().click();
    await page.waitForTimeout(2000); // wait for removal animation
  }

  console.log('Clicking the Add File button...');
  const addFileBtn = q.locator('span:has-text("Add file"), [aria-label="Add file"]').first();
  await addFileBtn.click();
  
  console.log('Waiting for the picker iframe...');
  await page.waitForTimeout(5000); // wait 5 seconds for iframe to load fully
  
  const frames = page.frames();
  console.log(`Total frames: ${frames.length}`);
  
  let pickerFrame = null;
  for (const f of frames) {
    const url = f.url();
    console.log(`Frame: url="${url}", name="${f.name()}"`);
    if (url.includes('google.com/picker') || url.includes('docs.google.com/picker')) {
      pickerFrame = f;
    }
  }

  if (pickerFrame) {
    console.log('Found picker iframe:', pickerFrame.url());
    
    // Google picker iframe has a sub-frame or loads content from another source.
    // Let's locate input[type="file"] inside the frame locator
    // Sometimes the input[type="file"] is hidden or loads inside another nested frame
    const fileInputs = page.frameLocator('iframe[src*="docs.google.com/picker"]').locator('input[type="file"]');
    const inputCount = await fileInputs.count();
    console.log(`File inputs found inside iframe: ${inputCount}`);
    
    // If not found, let's search for "Select files from your device" button inside the frame and see if clicking it works
    if (inputCount === 0) {
      console.log('Trying to find any button or input inside the frame...');
      const allInputs = page.frameLocator('iframe[src*="docs.google.com/picker"]').locator('input');
      const allCount = await allInputs.count();
      for (let j = 0; j < allCount; j++) {
        const inp = allInputs.nth(j);
        const type = await inp.getAttribute('type').catch(() => '');
        console.log(`  Input [${j}]: type="${type}"`);
      }
    }
  } else {
    console.error('Could not find picker iframe in the open frames.');
  }

  console.log('Closing browser...');
  await context.close();
}

run().catch(console.error);
