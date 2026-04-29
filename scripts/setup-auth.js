#!/usr/bin/env node
/**
 * setup-auth.js — Generate SHA-256 identity hash + TOTP secret for a family member
 *
 * Usage:
 *   node scripts/setup-auth.js "Vikram Sharma" "04111972"
 *   node scripts/setup-auth.js "Arjun Sharma" "15031945" --role admin
 *
 * Output:
 *   - The SHA-256 hash to paste into data/auth.json
 *   - A TOTP secret (base32)
 *   - A QR code URL to open in browser → screenshot → send on WhatsApp
 */

import { createHash, randomBytes } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node scripts/setup-auth.js "Full Name" "DDMMYYYY" [--role viewer|contributor|admin] [--branch sharma]');
  process.exit(1);
}

const fullName = args[0];
const dob = args[1];
const roleArg = args.indexOf('--role');
const role = roleArg >= 0 ? args[roleArg + 1] : 'viewer';
const branchArg = args.indexOf('--branch');
const branch = branchArg >= 0 ? args[branchArg + 1] : 'sharma';

// Normalise: lowercase, remove spaces, only letters+digits
const normalised = (fullName.toLowerCase().replace(/\s+/g, '') + dob.replace(/\D/g, '')).replace(/[^a-z0-9]/g, '');
const hash = createHash('sha256').update(normalised).digest('hex');

// Generate TOTP secret (base32)
const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const secretBytes = randomBytes(20);
let totpSecret = '';
for (let i = 0; i < 16; i++) {
  totpSecret += base32chars[secretBytes[i] % 32];
}

// TOTP is required for admin and contributor
const totpRequired = ['admin', 'contributor'].includes(role);

// QR code URL (use Google Charts API — free, no account)
const otpauthUri = `otpauth://totp/FamilyTree:${encodeURIComponent(fullName)}?secret=${totpSecret}&issuer=FamilyTree&algorithm=SHA1&digits=6&period=30`;
const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUri)}`;

// Auth entry to add to auth.json
const authEntry = {
  hash,
  role,
  branch,
  totpRequired,
  totpSecret: totpRequired ? totpSecret : null,
  displayName: fullName
};

console.log('\n═══════════════════════════════════════════');
console.log('  The Family Tree — Auth Setup');
console.log('═══════════════════════════════════════════\n');
console.log(`  Member  : ${fullName}`);
console.log(`  DOB     : ${dob}`);
console.log(`  Role    : ${role}`);
console.log(`  Branch  : ${branch}`);
console.log(`  TOTP    : ${totpRequired ? 'Required' : 'Not required'}`);
console.log('\n─── Add this to data/auth.json → "entries" array: ───\n');
console.log(JSON.stringify(authEntry, null, 2));

if (totpRequired) {
  console.log('\n─── TOTP QR Code ───');
  console.log(`\nOpen this URL in your browser, screenshot the QR, send to ${fullName} on WhatsApp:`);
  console.log(`\n  ${qrUrl}\n`);
  console.log('They scan it once in Google Authenticator → done forever.');
}

// Optionally auto-update auth.json
const authPath = resolve('data/auth.json');
try {
  const authData = JSON.parse(readFileSync(authPath, 'utf8'));
  const existingIdx = authData.entries.findIndex(e => e.hash === hash);
  if (existingIdx >= 0) {
    console.log('\n⚠️  Hash already exists in auth.json — updating entry.');
    authData.entries[existingIdx] = authEntry;
  } else {
    authData.entries.push(authEntry);
    console.log('\n✅ Entry added to data/auth.json automatically.');
  }
  writeFileSync(authPath, JSON.stringify(authData, null, 2));
} catch (e) {
  console.log('\n⚠️  Could not auto-update data/auth.json. Add the entry above manually.');
}

console.log('\n═══════════════════════════════════════════\n');
