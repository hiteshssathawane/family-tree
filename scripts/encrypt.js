#!/usr/bin/env node
/**
 * encrypt.js — Bundles and encrypts index.html with staticrypt
 *
 * Usage:
 *   FAMILY_PASSWORD=YourPassword node scripts/encrypt.js
 *
 * Or set FAMILY_PASSWORD in a local .env file (never commit .env!)
 * The encrypted output goes to dist/index.html — this is what gets deployed.
 *
 * Run this locally before pushing to GitHub, OR let GitHub Actions do it
 * using the FAMILY_PASSWORD GitHub Secret.
 */

import { execSync } from 'child_process';
import { 
  existsSync, 
  mkdirSync, 
  copyFileSync, 
  readFileSync, 
  writeFileSync, 
  readdirSync, 
  statSync,
  unlinkSync
} from 'fs';
import { resolve } from 'path';

// Load .env file manually if exists (useful for local builds)
if (existsSync('.env')) {
  const envContent = readFileSync('.env', 'utf8');
  envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

const password = process.env.FAMILY_PASSWORD;
if (!password) {
  console.error('❌ FAMILY_PASSWORD environment variable not set.');
  console.error('   Usage: FAMILY_PASSWORD=YourSecret node scripts/encrypt.js');
  process.exit(1);
}

const srcHtml = resolve('index.html');
const distDir = resolve('dist');
const distHtml = resolve('dist/index.html');
const tempHtml = resolve('index_temp.html');

if (!existsSync(srcHtml)) {
  console.error('❌ index.html not found. Check project structure.');
  process.exit(1);
}

if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

function copyFolderRecursiveSync(source, target) {
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
  }
  const files = readdirSync(source);
  files.forEach(file => {
    const curSource = resolve(source, file);
    const curTarget = resolve(target, file);
    if (statSync(curSource).isDirectory()) {
      copyFolderRecursiveSync(curSource, curTarget);
    } else {
      copyFileSync(curSource, curTarget);
    }
  });
}

console.log('📦 Bundling scripts and data files into index.html...');
try {
  let htmlContent = readFileSync(srcHtml, 'utf8');

  // Load the data and scripts to inline
  const authJson = readFileSync(resolve('data/auth.json'), 'utf8');
  const familyJson = readFileSync(resolve('data/family.json'), 'utf8');
  const enI18nJson = readFileSync(resolve('data/i18n/en.json'), 'utf8');
  const mrI18nJson = readFileSync(resolve('data/i18n/mr.json'), 'utf8');
  const helpersJs = readFileSync(resolve('tree-helpers.js'), 'utf8');
  const appJs = readFileSync(resolve('tree-app.js'), 'utf8');

  const injection = `
  <!-- PRODUCTION BUNDLED SCRIPTS AND DATABASES -->
  <script>
    window.BUNDLED_MODE = true;
    window.AUTH_DATA = ${authJson.trim()};
    window.FAMILY_DATA = ${familyJson.trim()};
    window.I18N_DATA = { en: ${enI18nJson.trim()}, mr: ${mrI18nJson.trim()} };
  </script>
  <script>
    ${helpersJs}
  </script>
  <script>
    ${appJs}
  </script>
`;

  // Inject before closing body tag
  htmlContent = htmlContent.replace('</body>', `${injection}\n</body>`);

  // Write temporary combined file
  writeFileSync(tempHtml, htmlContent, 'utf8');

  console.log('🔐 Encrypting with staticrypt...');
  // staticrypt uses --directory to set output folder and outputs file with input filename
  execSync(
    `npx staticrypt "${tempHtml}" --password "${password}" --directory "${distDir}" --remember 1 --short --template "scripts/password_template.html"`,
    { stdio: 'inherit' }
  );

  // Rename index_temp.html to index.html inside dist
  const generatedHtml = resolve(distDir, 'index_temp.html');
  if (existsSync(generatedHtml)) {
    copyFileSync(generatedHtml, distHtml);
    unlinkSync(generatedHtml);
  } else {
    throw new Error('staticrypt output file index_temp.html not found in dist.');
  }

  console.log('📁 Copying production assets...');
  copyFolderRecursiveSync(resolve('assets'), resolve('dist/assets'));
  copyFolderRecursiveSync(resolve('vendor'), resolve('dist/vendor'));

  // Copy other assets to dist
  const assets = ['manifest.json', 'sw.js', 'robots.txt'];
  assets.forEach(file => {
    const src = resolve(file);
    if (existsSync(src)) copyFileSync(src, resolve('dist', file));
  });

  console.log('\n✅ Encrypted page written to dist/index.html');
  console.log('   Deploy the contents of dist/ to GitHub Pages.');
  console.log('\n⚠️  NEVER commit dist/ to git — it contains the encrypted page.');
} catch (e) {
  console.error('❌ Build/Encryption failed:', e.message);
  process.exit(1);
} finally {
  // Clean up temp files
  if (existsSync(tempHtml)) {
    try {
      unlinkSync(tempHtml);
    } catch (err) {
      console.warn('⚠️ Could not remove temporary file index_temp.html:', err.message);
    }
  }
  // Clean up staticrypt's default encrypted folder output if it somehow got created there
  const defaultTempOutput = resolve('encrypted/index_temp.html');
  if (existsSync(defaultTempOutput)) {
    try {
      unlinkSync(defaultTempOutput);
    } catch (err) {}
  }
}
