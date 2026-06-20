#!/usr/bin/env node
/**
 * clear-data.js — Reset the family tree and logins to a clean state.
 *
 * Usage:
 *   node scripts/clear-data.js
 *   node scripts/clear-data.js "Your Name" "DDMMYYYY"
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { createHash } from 'crypto';

console.log('🧹 The Family Tree — Data Resetter\n');

// 1. Define Hitesh Sathawane (Always Kept as Admin and Default User)
const hiteshName = 'Hitesh Sathawane';
const hiteshDobStr = '29121985';
const hiteshDobFormatted = '29/12/1985';
const hiteshId = 'HITESH_JYOTI_SHANKAR_SATHAWANE';
const hiteshBirthDate = '1985-12-28';
const hiteshNormalised = 'hiteshsathawane29121985';
const hiteshHash = createHash('sha256').update(hiteshNormalised).digest('hex');

const persons = [
  {
    id: hiteshId,
    firstName: "Hitesh",
    fatherName: "",
    motherName: "",
    lastName: "Sathawane",
    maidenName: null,
    gender: "M",
    status: "living",
    maritalStatus: "single",
    birthDate: hiteshBirthDate,
    birthPlace: null,
    deathDate: null,
    deathPlace: null,
    occupation: null,
    education: null,
    location: null,
    commonName: null,
    commonNameMr: null,
    firstNameMr: "हितेश",
    lastNameMr: "साठवणे",
    biography: "Initial admin member.",
    profilePhoto: null,
    backgroundPhoto: null,
    tags: [],
    private: false
  }
];

const authEntries = [
  {
    hash: hiteshHash,
    role: 'admin',
    branch: 'main',
    totpRequired: false,
    totpSecret: null,
    displayName: hiteshName
  }
];

// 2. Parse arguments for an optional additional user
const args = process.argv.slice(2);
let customUser = null;

if (args.length >= 2) {
  const customFullName = args[0];
  const customDob = args[1].replace(/\D/g, ''); // keep only digits

  if (customDob.length !== 8) {
    console.error('❌ Error: Date of birth must be in DDMMYYYY format (8 digits).');
    process.exit(1);
  }

  // Check if it's Hitesh Sathawane (with either spelling/variation)
  const isHitesh = customFullName.toLowerCase().replace(/[^a-z]/g, '').includes('hitesh') &&
                   (customFullName.toLowerCase().replace(/[^a-z]/g, '').includes('sathawane') || 
                    customFullName.toLowerCase().replace(/[^a-z]/g, '').includes('satahwane'));

  if (isHitesh) {
    console.log('ℹ️  Custom arguments resolve to Hitesh Sathawane, who is already preserved as Admin.');
  } else {
    const customParts = customFullName.trim().split(/\s+/);
    const customFirstName = customParts[0] || 'Admin';
    const customLastName = customParts.slice(1).join(' ') || 'User';

    const customFormattedId = `${customFirstName.toUpperCase()}_${customLastName.toUpperCase()}`.replace(/[^A-Z0-9_]/g, '');
    const cDay = customDob.slice(0, 2);
    const cMonth = customDob.slice(2, 4);
    const cYear = customDob.slice(4, 8);
    const customFormattedBirthDate = `${cYear}-${cMonth}-${cDay}`;

    const customNormalised = (customFullName.toLowerCase().replace(/\s+/g, '') + customDob).replace(/[^a-z0-9]/g, '');
    const customHash = createHash('sha256').update(customNormalised).digest('hex');

    const customPerson = {
      id: customFormattedId,
      firstName: customFirstName,
      fatherName: "",
      motherName: "",
      lastName: customLastName,
      maidenName: null,
      gender: "M",
      status: "living",
      maritalStatus: "single",
      birthDate: customFormattedBirthDate,
      birthPlace: null,
      deathDate: null,
      deathPlace: null,
      occupation: null,
      education: null,
      location: null,
      commonName: null,
      commonNameMr: null,
      firstNameMr: null,
      lastNameMr: null,
      biography: "Additional admin member.",
      profilePhoto: null,
      backgroundPhoto: null,
      tags: [],
      private: false
    };

    const customAuthEntry = {
      hash: customHash,
      role: 'admin',
      branch: 'main',
      totpRequired: false,
      totpSecret: null,
      displayName: customFullName
    };

    persons.push(customPerson);
    authEntries.push(customAuthEntry);
    customUser = {
      fullName: customFullName,
      dob: `${cDay}/${cMonth}/${cYear}`,
      id: customFormattedId
    };
  }
} else {
  console.log('ℹ️  Seeding Hitesh Sathawane as default Admin and primary user.');
  console.log('👉 To seed an additional Admin, run:');
  console.log('   node scripts/clear-data.js "Custom Admin Name" "DDMMYYYY"\n');
}

// 3. Perform safe Backup
const backupDir = resolve('backups');
if (!existsSync(backupDir)) {
  mkdirSync(backupDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = join(backupDir, `before_clear_${timestamp}`);
mkdirSync(backupPath);

console.log(`📦 Creating backup in: ${backupPath}`);
try {
  if (existsSync('data/family.json')) {
    writeFileSync(join(backupPath, 'family.json'), readFileSync('data/family.json'));
  }
  if (existsSync('data/auth.json')) {
    writeFileSync(join(backupPath, 'auth.json'), readFileSync('data/auth.json'));
  }
  console.log('✅ Backup successful!');
} catch (e) {
  console.error(`❌ Backup failed: ${e.message}. Aborting reset.`);
  process.exit(1);
}

// 4. Construct empty templates
const newFamily = {
  meta: {
    familyName: `Sathawane's Family Tree`,
    description: `A genealogy record of the Sathawane family.`,
    version: '1.0.0',
    createdAt: new Date().toISOString().slice(0, 10),
    updatedAt: new Date().toISOString().slice(0, 10),
    rootPersonId: hiteshId,
    privacy: {
      hideLivingContactInfo: true,
      hideLivingDOBYear: false,
      publicViewAllowed: false
    }
  },
  persons: persons,
  relationships: [],
  events: [],
  media: []
};

const newAuth = {
  familyPasswordHint: `Ask Hitesh on family WhatsApp`,
  entries: authEntries
};

// 5. Write to files
try {
  writeFileSync(resolve('data/family.json'), JSON.stringify(newFamily, null, 2));
  writeFileSync(resolve('data/auth.json'), JSON.stringify(newAuth, null, 2));
  console.log('\n🗑️  All old family data and logins have been deleted.');
  console.log('✅ Created fresh data templates with preserved admin user(s).');
} catch (e) {
  console.error(`❌ Failed to write new templates: ${e.message}`);
  process.exit(1);
}

// 6. Print login credentials for verification
console.log('\n🔑 Use the following credentials to sign in:');
console.log('═════════════════════════════════════════════');
console.log(`  Family Password : InLovingMemoryOfJyoti=Energy`);
console.log(`  Full Name       : ${hiteshName}`);
console.log(`  Date of Birth   : ${hiteshDobFormatted}`);
console.log(`  Admin Person ID : ${hiteshId}`);
if (customUser) {
  console.log('─────────────────────────────────────────────');
  console.log(`  Full Name (2)   : ${customUser.fullName}`);
  console.log(`  Date of Birth   : ${customUser.dob}`);
  console.log(`  Admin Person ID : ${customUser.id}`);
}
console.log('═════════════════════════════════════════════\n');
console.log('👉 Verify validation passes by running:');
console.log('   npm run validate\n');
