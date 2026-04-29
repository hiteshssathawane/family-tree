#!/usr/bin/env node
/**
 * download-vendors.js — Download all CDN dependencies locally
 *
 * This script downloads all external JavaScript and CSS libraries
 * to the vendor/ folder to make the app completely self-contained.
 * No CDN dependencies = reliable offline functionality.
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';

const VENDOR_DIR = 'vendor';
const FONTS_DIR = join(VENDOR_DIR, 'fonts');

// Ensure directories exist
if (!existsSync(VENDOR_DIR)) mkdirSync(VENDOR_DIR, { recursive: true });
if (!existsSync(FONTS_DIR)) mkdirSync(FONTS_DIR, { recursive: true });

// Downloads to perform
const downloads = [
  {
    url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    dest: join(VENDOR_DIR, 'leaflet.js')
  },
  {
    url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    dest: join(VENDOR_DIR, 'leaflet.css')
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
    dest: join(VENDOR_DIR, 'd3.min.js')
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/flexsearch@0.7.31/dist/flexsearch.bundle.js',
    dest: join(VENDOR_DIR, 'flexsearch.bundle.js')
  },
  {
    url: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;700&family=Lato:wght@300;400;700&display=swap',
    dest: join(VENDOR_DIR, 'fonts.css')
  }
];

/**
 * Download a file from URL to destination
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`📥 Downloading ${url}`);

    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;

    const file = createWriteStream(dest);

    client.get(url, (response) => {
      // Follow redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
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
 * Extract and download font files from Google Fonts CSS
 */
async function downloadFontFiles(cssPath) {
  console.log(`🔍 Parsing font CSS for WOFF2 URLs...`);

  const fs = await import('fs/promises');
  const cssContent = await fs.readFile(cssPath, 'utf8');

  // Extract WOFF2 URLs from CSS
  const woff2Urls = cssContent.match(/url\((https:\/\/[^)]+\.woff2)\)/g);

  if (!woff2Urls) {
    console.log('⚠️  No WOFF2 URLs found in fonts.css');
    return;
  }

  console.log(`📥 Found ${woff2Urls.length} font files to download`);

  for (let i = 0; i < woff2Urls.length; i++) {
    const urlMatch = woff2Urls[i].match(/url\((https:\/\/[^)]+\.woff2)\)/);
    if (!urlMatch) continue;

    const fontUrl = urlMatch[1];
    const fileName = `font-${i + 1}.woff2`;
    const fontDest = join(FONTS_DIR, fileName);

    try {
      await downloadFile(fontUrl, fontDest);

      // Update CSS to use local path
      const localUrl = `fonts/${fileName}`;
      const updatedCss = cssContent.replace(fontUrl, localUrl);
      await fs.writeFile(cssPath, updatedCss);

    } catch (err) {
      console.error(`❌ Failed to download font: ${err.message}`);
    }
  }

  console.log(`✅ Updated fonts.css to use local font files`);
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

    // Download Google Fonts WOFF2 files
    await downloadFontFiles(join(VENDOR_DIR, 'fonts.css'));

    console.log('');
    console.log('✅ All vendor files downloaded successfully!');
    console.log(`📂 Files saved to: ${VENDOR_DIR}/`);
    console.log('');
    console.log('Next steps:');
    console.log('1. Update index.html to use vendor/ files');
    console.log('2. Remove all CDN <script> and <link> tags');
    console.log('3. Test locally with ./dev-server.sh');

  } catch (err) {
    console.error(`❌ Download failed: ${err.message}`);
    process.exit(1);
  }
}

main();