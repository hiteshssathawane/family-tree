#!/usr/bin/env node
/**
 * encrypt.js — Encrypt public/index.html with staticrypt
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
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { resolve } from 'path';

const password = process.env.FAMILY_PASSWORD;
if (!password) {
  console.error('❌ FAMILY_PASSWORD environment variable not set.');
  console.error('   Usage: FAMILY_PASSWORD=YourSecret node scripts/encrypt.js');
  process.exit(1);
}

const srcHtml = resolve('index.html');
const distDir = resolve('dist');
const distHtml = resolve('dist/index.html');

if (!existsSync(srcHtml)) {
  console.error('❌ index.html not found. Check project structure.');
  process.exit(1);
}

if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

console.log('🔐 Encrypting with staticrypt...');

try {
  execSync(
    `npx staticrypt "${srcHtml}" --password "${password}" --output "${distHtml}" --remember 1 --short --template "scripts/password_template.html"`,
    { stdio: 'inherit' }
  );

  // Copy other assets to dist
  const assets = ['manifest.json', 'sw.js'];
  assets.forEach(file => {
    const src = resolve(file);
    if (existsSync(src)) copyFileSync(src, resolve('dist', file));
  });

  console.log('\n✅ Encrypted page written to dist/index.html');
  console.log('   Deploy the contents of dist/ to GitHub Pages.');
  console.log('\n⚠️  NEVER commit dist/ to git — it contains the encrypted page.');
  console.log('   GitHub Actions encrypts fresh on every deploy using the GitHub Secret.');
} catch (e) {
  console.error('❌ Encryption failed:', e.message);
  process.exit(1);
}
