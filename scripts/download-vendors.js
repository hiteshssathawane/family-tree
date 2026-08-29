#!/usr/bin/env node
/**
 * download-vendors.js — Download all CDN dependencies locally
 *
 * This script downloads all external JavaScript and CSS libraries
 * to the vendor/ folder to make the app completely self-contained.
 * No CDN dependencies = reliable offline functionality.
 *
 * Fonts: the families here must match the ones index.html actually styles with
 * (Cormorant Garamond + Inter). We request the CSS with a browser User-Agent so
 * Google serves woff2 rather than the legacy ttf it hands to unknown clients,
 * then download every face and rewrite fonts.css to relative `fonts/…` paths.
 */

import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';

const VENDOR_DIR = 'vendor';
const FONTS_DIR = join(VENDOR_DIR, 'fonts');

// Ensure directories exist
if (!existsSync(VENDOR_DIR)) mkdirSync(VENDOR_DIR, { recursive: true });
if (!existsSync(FONTS_DIR)) mkdirSync(FONTS_DIR, { recursive: true });

// Google serves woff2 only to clients it recognises; without this it returns ttf.
const WOFF2_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// The faces index.html styles with. Keep these axes in sync with the
// font-family / font-weight / font-style rules in index.html.
//
// Both families are variable fonts (wght axis: Inter 100-900, Cormorant
// Garamond 300-700), so we ask for a `400..600` RANGE rather than the discrete
// `400;500;600`. Google returns the identical file for every discrete weight,
// so the discrete form downloads the same bytes three times and pins each copy
// to one instance. The range form ships it once and lets the browser
// interpolate — 6 files instead of 14, and a true 500/600 instead of a pinned
// one. Adding a weight in index.html needs no new download while it stays
// inside 400-600.
const FONT_CSS_URL =
  'https://fonts.googleapis.com/css2' +
  '?family=Cormorant+Garamond:ital,wght@0,400..600;1,400..600' +
  '&family=Inter:wght@400..600' +
  '&display=swap';

// Google splits each face across ~7 unicode-range subsets. This app is English +
// Marathi; Devanagari is not covered by either family (it falls back to a system
// font), and cyrillic / greek / vietnamese are dead weight in an offline precache.
const KEEP_SUBSETS = ['latin', 'latin-ext'];

// Downloads to perform
const downloads = [
  {
    url: 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
    dest: join(VENDOR_DIR, 'd3.min.js')
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/flexsearch@0.7.31/dist/flexsearch.bundle.js',
    dest: join(VENDOR_DIR, 'flexsearch.bundle.js')
  }
];

/**
 * Download a file from URL to destination
 */
function downloadFile(url, dest, headers = {}) {
  return new Promise((resolve, reject) => {
    console.log(`📥 Downloading ${url}`);

    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;

    const file = createWriteStream(dest);

    client.get(url, { headers }, (response) => {
      // Follow redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        return downloadFile(response.headers.location, dest, headers).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${response.statusCode}: ${url}`));
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log(`✅ Downloaded ${dest}`);
        resolve();
      });

      file.on('error', (err) => {
        file.close();
        reject(err);
      });
    }).on('error', (err) => {
      file.close();
      reject(err);
    });
  });
}

/**
 * Fetch a URL into a string (used for the Google Fonts stylesheet).
 */
function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;

    client.get(url, { headers }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return fetchText(response.headers.location, headers).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        return reject(new Error(`HTTP ${response.statusCode}: ${url}`));
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

const slug = (family) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Download the Google Fonts faces and write a vendor/fonts.css that points at
 * them relatively. Returns the list of local font paths, for sw.js's precache.
 */
async function buildLocalFonts() {
  console.log('🔤 Fetching Google Fonts stylesheet (woff2)...');
  const remoteCss = await fetchText(FONT_CSS_URL, { 'User-Agent': WOFF2_UA });

  // Each face arrives as: /* subset */\n@font-face { ... }
  const blocks = [...remoteCss.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)];
  if (blocks.length === 0) {
    throw new Error('No @font-face blocks found — did Google change the CSS format?');
  }

  const pick = (block, prop) => (block.match(new RegExp(`${prop}:\\s*([^;]+);`)) || [])[1]?.trim();

  const out = [];
  const localPaths = [];

  for (const [, subset, block] of blocks) {
    if (!KEEP_SUBSETS.includes(subset)) continue;

    const family = (pick(block, 'font-family') || '').replace(/['"]/g, '');
    const style = pick(block, 'font-style') || 'normal';
    const weight = pick(block, 'font-weight') || '400';
    const unicodeRange = pick(block, 'unicode-range');
    const remoteUrl = (block.match(/url\((https:\/\/[^)]+\.woff2)\)/) || [])[1];

    if (!family || !remoteUrl) {
      console.warn(`⚠️  Skipping an unparseable @font-face block (${subset})`);
      continue;
    }

    // One file per family + style + subset. The weight is a range, not part of
    // the identity, so it stays out of the filename.
    const fileName = `${slug(family)}${style === 'italic' ? '-italic' : ''}-${subset}.woff2`;
    await downloadFile(remoteUrl, join(FONTS_DIR, fileName), { 'User-Agent': WOFF2_UA });

    const size = statSync(join(FONTS_DIR, fileName)).size;
    if (size === 0) throw new Error(`Downloaded ${fileName} is empty`);

    localPaths.push(`vendor/fonts/${fileName}`);
    out.push(
      `/* ${family} ${weight}${style === 'italic' ? ' italic' : ''} — ${subset} */\n` +
      `@font-face {\n` +
      `  font-family: '${family}';\n` +
      `  font-style: ${style};\n` +
      `  font-weight: ${weight};\n` +
      `  font-display: swap;\n` +
      `  src: url(fonts/${fileName}) format('woff2');\n` +
      (unicodeRange ? `  unicode-range: ${unicodeRange};\n` : '') +
      `}`
    );
  }

  const header =
    `/* vendor/fonts.css — self-hosted faces. Generated by scripts/download-vendors.js.\n` +
    `   Do not hand-edit and never point src at a CDN (CLAUDE.md rule 1). */\n\n`;

  await writeFile(join(VENDOR_DIR, 'fonts.css'), header + out.join('\n\n') + '\n');
  console.log(`✅ Wrote ${join(VENDOR_DIR, 'fonts.css')} with ${out.length} local faces`);

  return localPaths;
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 The Family Tree — Vendor Download');
  console.log('━'.repeat(50));
  console.log('Downloading all CDN dependencies locally...\n');

  try {
    // Download all main files
    for (const download of downloads) {
      await downloadFile(download.url, download.dest);
    }

    console.log('');

    // Download Google Fonts WOFF2 files and rewrite fonts.css to local paths
    const fontPaths = await buildLocalFonts();

    console.log('');
    console.log('✅ All vendor files downloaded successfully!');
    console.log(`📂 Files saved to: ${VENDOR_DIR}/`);
    console.log('');
    console.log('sw.js STATIC_CACHE font entries should be:');
    for (const p of fontPaths) console.log(`  '${p}',`);
    console.log('');
    console.log('Next steps:');
    console.log('1. Confirm index.html links vendor/fonts.css (no Google Fonts tags)');
    console.log('2. grep -c "unpkg\\|cdnjs\\|jsdelivr\\|googleapis" index.html  → must be 0');
    console.log('3. Test locally with ./dev-server.sh');

  } catch (err) {
    console.error(`❌ Download failed: ${err.message}`);
    process.exit(1);
  }
}

main();
