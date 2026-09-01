#!/usr/bin/env node
/**
 * pull-sheet.js — Fetch private Google Sheet responses via Apps Script Web App,
 * map the columns/values to match the CSV import schema, and trigger the import pipeline.
 */

import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import 'dotenv/config';

// Default configuration (can also be set via environment variables)
const WEB_APP_URL = process.env.GOOGLE_SHEET_URL || "https://script.google.com/macros/s/AKfycbygv2ZJ-4Ugn_PgGpeszxxGURhdqXX46XaZQGuj9Z9iVGiKpCcmSff63qJABi1gfX9I/exec";
const SECRET_TOKEN = process.env.GOOGLE_SHEET_SECRET || "MyFamilyTreeSecureToken2026";
const outputCsvPath = resolve('data/form-responses.csv');

// Only used as a fallback when the Web App still returns raw ISO instants (see formatDate).
const SHEET_TIMEZONE = process.env.SHEET_TIMEZONE || 'Asia/Kolkata';

const DUMP_HEADERS = process.argv.includes('--dump-headers');

// Sheet columns the member mapping depends on. A missing REQUIRED column silently
// defaulted to '' before, which is how Gender arrived as 'X' and Marital Status as
// 'unknown' — with no error anywhere. Now it fails the run instead.
const REQUIRED_HEADERS = [
  'First Name (English) *',
  'Last Name (English) *',
  'Gender *',
  'Status *',
  'Marital Status *',
  'Birth Date *',
  'Birth Place *'
];

const OPTIONAL_HEADERS = [
  'Father Name (English) *',
  'Mother Name (English) *',
  'Spouse First Name (Mandatory if Married)',
  'Spouse Father Name',
  'Spouse Mother Name',
  'Spouse Last Name',
  'Marriage Date',
  'Death Date (If applicable, only if Status is Deceased)',
  'Death Place (If applicable, only if Status is Deceased)',
  'Occupation',
  'Education Details (Free text field for specific qualifications)',
  'Location (Current City/Region) *',
  'Biography',
  'Alias',
  'First Name (Marathi - पहिले नाव) *',
  'Last Name (Marathi - आडनाव) *',
  'Profile Picture',
  'Background Picture'
];

// Throws when a required column is absent, naming exactly what is missing and what the
// sheet actually has, so a renamed form question is a loud error not silent data loss.
function reconcileHeaders(sheetHeaders) {
  const present = new Set(sheetHeaders);
  const missingRequired = REQUIRED_HEADERS.filter(h => !present.has(h));
  const missingOptional = OPTIONAL_HEADERS.filter(h => !present.has(h));

  if (missingOptional.length) {
    console.log(`⚠️  Optional columns not found (these fields will be blank):`);
    missingOptional.forEach(h => console.log(`     · ${h}`));
  }

  if (missingRequired.length) {
    const detail = [
      `Sheet is missing ${missingRequired.length} required column(s):`,
      ...missingRequired.map(h => `     · ${JSON.stringify(h)}`),
      ``,
      `   Sheet actually has these ${sheetHeaders.length} headers:`,
      ...sheetHeaders.map((h, i) => `     [${i}] ${JSON.stringify(h)}`),
      ``,
      `   Fix the Google Form question titles, or update REQUIRED_HEADERS in`,
      `   scripts/pull-sheet.js to match. Refusing to import partial data.`
    ].join('\n');
    throw new Error(detail);
  }

  console.log(`✅ All ${REQUIRED_HEADERS.length} required columns found.`);
}

// Helper to escape values for CSV
function escapeCSVValue(val) {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  // Escape quotes
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Helper to format Date strings from Sheet.
//
// A date-only cell is stored as midnight in the SHEET's timezone. Apps Script hands it
// back as a Date, which JSON.stringify serialises in UTC — so 29-Dec-1985 IST arrives as
// "1985-12-28T18:30:00.000Z". Reading the UTC half of that lands a day early, which then
// corrupts the login hash (SHA-256(name + DDMMYYYY)).
//
// The deployed Apps Script now formats date cells in the spreadsheet's own timezone, so
// the common path is a plain "yyyy-MM-dd" string. This stays correct for the old ISO
// payload too, in case an earlier Web App deployment is still live.
function formatDate(d) {
  if (!d) return '';
  d = String(d).trim();

  // Only ISO-8601 datetimes are rewritten; anything else is passed through untouched.
  const iso = d.match(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!iso) return d;

  // A datetime with no zone marker was already rendered in the sheet's own timezone by
  // the Apps Script, so its date half is correct as-is. Only an explicit UTC instant
  // (trailing Z, or a ±HH:MM offset) needs converting back to the sheet's timezone.
  if (!iso[2]) return iso[1];

  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHEET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(parsed); // en-CA yields YYYY-MM-DD
}

async function run() {
  console.log('📡 Fetching latest data from Google Sheet Web App...');
  const timestamp = Math.floor(Date.now() / 1000);
  const token = crypto
    .createHmac('sha256', SECRET_TOKEN)
    .update(timestamp.toString())
    .digest('hex');

  // Discover sheets first
  let sheets = [];
  try {
    const listUrl = `${WEB_APP_URL}?token=${token}&timestamp=${timestamp}&action=listSheets`;
    const listRes = await fetch(listUrl);
    if (listRes.ok) {
      sheets = await listRes.json();
    }
  } catch (e) {
    console.log('⚠️ Could not fetch sheet names from Apps Script:', e.message);
  }

  // Find Scrapbook sheet if any
  const scrapbookSheetName = Array.isArray(sheets) ? sheets.find(s => {
    const sl = s.toLowerCase();
    return sl.includes('scrapbook') || sl.includes('timeline') || sl.includes('memories');
  }) : null;

  // Find Primary (members) sheet name
  const primarySheetName = Array.isArray(sheets) && sheets.length > 0
    ? sheets.find(s => s !== scrapbookSheetName) || sheets[0]
    : null;

  const primaryUrl = primarySheetName
    ? `${WEB_APP_URL}?token=${token}&timestamp=${timestamp}&sheet=${encodeURIComponent(primarySheetName)}`
    : `${WEB_APP_URL}?token=${token}&timestamp=${timestamp}`;

  const res = await fetch(primaryUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch Sheet data (HTTP status: ${res.status})`);
  }
  
  const data = await res.json();
  if (data.error) {
    throw new Error(`Google Apps Script returned an error: ${data.error}`);
  }
  
  if (!Array.isArray(data) || data.length === 0) {
    console.log('⚠️  No data found in spreadsheet.');
    return;
  }

  const sheetHeaders = data[0].map(h => String(h).trim());
  const rows = data.slice(1);

  if (DUMP_HEADERS) {
    console.log(`\n📋 Actual headers on sheet "${primarySheetName || '(first sheet)'}":\n`);
    sheetHeaders.forEach((h, i) => console.log(`  [${i}] ${JSON.stringify(h)}`));
    console.log(`\n${rows.length} data row(s) present.\n`);
    reconcileHeaders(sheetHeaders);
    return;
  }

  reconcileHeaders(sheetHeaders);

  if (rows.length === 0) {
    console.log('ℹ️  Google Sheet has been cleared (0 data rows found). Synchronizing empty sheet to clear local database...');
  } else {
    console.log(`📊 Retrieved ${rows.length} rows from Google Sheet.`);
  }

  // Define target CSV headers
  const csvHeaders = [
    'firstName', 'fatherName', 'motherName', 'lastName',
    'gender', 'status', 'maritalStatus',
    'spouseFirstName', 'spouseFatherName', 'spouseMotherName', 'spouseLastName',
    'marriageDate', 'birthDate', 'birthPlace', 'deathDate', 'deathPlace',
    'occupation', 'education', 'location', 'biography', 'commonName',
    'firstNameMr', 'lastNameMr', 'profilePhoto', 'backgroundPhoto'
  ];

  // Map sheet headers to indexes
  const headerMap = {};
  sheetHeaders.forEach((h, index) => {
    headerMap[h] = index;
  });

  const parsedRows = [];

  rows.forEach((row, i) => {
    // Helper to get value by Sheet column name
    const getVal = (name) => {
      const idx = headerMap[name];
      return idx !== undefined ? row[idx] : '';
    };

    // Skip empty rows
    const firstName = getVal('First Name (English) *');
    const lastName = getVal('Last Name (English) *');
    if (!firstName && !lastName) {
      return;
    }

    // The column is guaranteed to exist (reconcileHeaders), so a blank here means the
    // form was submitted without the answer. Say so rather than quietly defaulting.
    const who = `${firstName} ${lastName}`.trim() || `row ${i + 2}`;
    const warnBlank = (label, raw, fallback) => {
      if (!String(raw ?? '').trim()) {
        console.warn(`  ⚠️  ${who}: "${label}" is blank on the sheet — using '${fallback}'.`);
      }
    };

    // Owner-chosen defaults for an unanswered required radio: Male / Active / Single.
    // They exist because the Form's radios can come back blank, not because the answer
    // is genuinely unknown — so every one of them is reported below, never silent.
    const rawDeathDate = getVal('Death Date (If applicable, only if Status is Deceased)');

    // Gender Mapping
    const rawGender = getVal('Gender *');
    warnBlank('Gender *', rawGender, 'M (default)');
    let gender = String(rawGender).trim();
    if (gender.toLowerCase().startsWith('m')) gender = 'M';
    else if (gender.toLowerCase().startsWith('f')) gender = 'F';
    else gender = 'M';

    // Status Mapping
    const rawStatus = getVal('Status *');
    let status = String(rawStatus).trim().toLowerCase();
    // The form offers Active / Deceased; "Active" means living.
    if (status.startsWith('liv') || status.startsWith('act')) status = 'living';
    else if (status.startsWith('dec')) status = 'deceased';
    else if (String(rawDeathDate ?? '').trim()) {
      // The default cannot be allowed to contradict a death date sitting on the same row.
      // Defaulting these to 'living' is what made csv-import delete the date — which is how
      // Jyoti was imported as alive, with the contradiction validate.js exists to catch
      // destroyed on the way in.
      warnBlank('Status *', rawStatus, 'deceased (death date present)');
      status = 'deceased';
    } else {
      warnBlank('Status *', rawStatus, 'living (default)');
      status = 'living';
    }

    // Marital Status Mapping
    const rawMarital = getVal('Marital Status *');
    warnBlank('Marital Status *', rawMarital, 'single (default)');
    let maritalStatus = String(rawMarital).trim().toLowerCase();
    if (maritalStatus.startsWith('marr')) maritalStatus = 'married';
    else if (maritalStatus.startsWith('sing')) maritalStatus = 'single';
    else if (maritalStatus.startsWith('div')) maritalStatus = 'divorced';
    else if (maritalStatus.startsWith('wid')) maritalStatus = 'widowed';
    else maritalStatus = 'single';

    const mappedRow = {
      firstName: firstName,
      fatherName: getVal('Father Name (English) *'),
      motherName: getVal('Mother Name (English) *'),
      lastName: lastName,
      gender: gender,
      status: status,
      maritalStatus: maritalStatus,
      spouseFirstName: getVal('Spouse First Name (Mandatory if Married)'),
      spouseFatherName: getVal('Spouse Father Name'),
      spouseMotherName: getVal('Spouse Mother Name'),
      spouseLastName: getVal('Spouse Last Name'),
      marriageDate: formatDate(getVal('Marriage Date')),
      birthDate: formatDate(getVal('Birth Date *')),
      birthPlace: getVal('Birth Place *'),
      deathDate: formatDate(getVal('Death Date (If applicable, only if Status is Deceased)')),
      deathPlace: getVal('Death Place (If applicable, only if Status is Deceased)'),
      occupation: getVal('Occupation'),
      education: getVal('Education Details (Free text field for specific qualifications)'),
      location: getVal('Location (Current City/Region) *'),
      biography: getVal('Biography'),
      commonName: getVal('Alias'),
      firstNameMr: getVal('First Name (Marathi - पहिले नाव) *'),
      lastNameMr: getVal('Last Name (Marathi - आडनाव) *'),
      profilePhoto: getVal('Profile Picture'),
      backgroundPhoto: getVal('Background Picture')
    };

    parsedRows.push(mappedRow);
  });

  // Construct CSV String
  let csvContent = csvHeaders.join(',') + '\n';
  parsedRows.forEach(row => {
    const line = csvHeaders.map(h => escapeCSVValue(row[h])).join(',');
    csvContent += line + '\n';
  });

  writeFileSync(outputCsvPath, csvContent, 'utf8');
  console.log(`💾 Successfully converted and saved CSV to ${outputCsvPath}`);

  // Execute the import script
  console.log('\n📥 Invoking the CSV import pipeline...');
  execSync(`node scripts/csv-import.js data/form-responses.csv`, { stdio: 'inherit' });

  // Fetch and merge Scrapbook data if found
  let scrapbookData = null;
  if (scrapbookSheetName) {
    console.log(`📡 Scrapbook sheet found: "${scrapbookSheetName}". Fetching...`);
    try {
      const scrapUrl = `${WEB_APP_URL}?token=${token}&timestamp=${timestamp}&sheet=${encodeURIComponent(scrapbookSheetName)}`;
      const scrapRes = await fetch(scrapUrl);
      if (scrapRes.ok) {
        scrapbookData = await scrapRes.json();
      }
    } catch (e) {
      console.log('⚠️ Failed to fetch scrapbook sheet data:', e.message);
    }
  }

  if (scrapbookData) {
    const familyPath = resolve('data/family.json');
    const family = JSON.parse(readFileSync(familyPath, 'utf8'));

    // Always clear/reset scrapbook if the scrapbook sheet was successfully fetched
    family.scrapbook = {};

    if (scrapbookData.length > 1) {
      console.log(`📊 Processing ${scrapbookData.length - 1} scrapbook entries...`);
      const sbHeaders = scrapbookData[0].map(h => String(h).trim());
      const sbRows = scrapbookData.slice(1);

      // Helper to find header index by keywords
      const findHeaderIdx = (headers, keywords, excludeKeywords = []) => {
        return headers.findIndex(h => {
          const hl = h.toLowerCase();
          return keywords.some(k => hl.includes(k)) && !excludeKeywords.some(k => hl.includes(k));
        });
      };

      const ownerIdx = findHeaderIdx(sbHeaders, ['whom', 'about', 'member', 'person', 'name'], ['tag', 'other', 'spouse', 'father', 'mother']);
      // Fallback owner: "Who is writing this memory?" — when the submitter is also the
      // subject (the common case for now, since the subject dropdown is what silently
      // drops its value on submit), this still resolves the entry to the right person
      // instead of discarding it.
      const writerIdx = findHeaderIdx(sbHeaders, ['writing', 'who is'], ['whom', 'about']);
      const dateIdx = findHeaderIdx(sbHeaders, ['date', 'year'], ['timestamp', 'birth', 'death', 'marriage']);
      // The loose word "memory" also appears in the author column ("Who is writing this
      // memory?") and the subject column ("Whom is this memory/event about?"), both of
      // which sit *before* the story column and would win a single findIndex. So try the
      // unambiguous words first and only fall back to the loose ones, excluding the
      // wording that belongs to the other questions.
      const captionExclude = ['writing', 'written', 'who is', 'whom', 'about', 'submitted', 'author', 'title', 'type of'];
      let captionIdx = findHeaderIdx(sbHeaders, ['story', 'caption', 'description'], captionExclude);
      if (captionIdx === -1) {
        captionIdx = findHeaderIdx(sbHeaders, ['details', 'memory', 'text'], captionExclude);
      }
      const photosIdx = findHeaderIdx(sbHeaders, ['photo', 'picture', 'image', 'upload', 'file']);
      const tagsIdx = findHeaderIdx(sbHeaders, ['tag', 'with', 'other']);

      if (ownerIdx !== -1) {
        // Build name to person ID lookup map
        const nameToId = {};
        family.persons.forEach(p => {
          const fullName = `${p.firstName} ${p.lastName}`.toLowerCase().replace(/\s+/g, '');
          nameToId[fullName] = p.id;
          if (p.commonName) {
            const commonFullName = `${p.commonName} ${p.lastName}`.toLowerCase().replace(/\s+/g, '');
            nameToId[commonFullName] = p.id;
            nameToId[p.commonName.toLowerCase().replace(/\s+/g, '')] = p.id;
          }
          nameToId[p.firstName.toLowerCase().replace(/\s+/g, '')] = p.id;
        });

        sbRows.forEach(row => {
          const ownerVal = row[ownerIdx] || (writerIdx !== -1 ? row[writerIdx] : '');
          if (!ownerVal) return;

          const ownerKey = String(ownerVal).toLowerCase().replace(/\s+/g, '');
          const ownerId = nameToId[ownerKey];
          if (!ownerId) {
            console.warn(`  ⚠️ Could not resolve scrapbook owner: "${ownerVal}"`);
            return;
          }

          const dateVal = dateIdx !== -1 && row[dateIdx] ? String(row[dateIdx]).trim() : 'Unknown Date';
          const captionVal = captionIdx !== -1 && row[captionIdx] ? String(row[captionIdx]).trim() : 'Memory';
          
          // Extract photos (Google Drive links)
          let photosList = [];
          if (photosIdx !== -1 && row[photosIdx]) {
            photosList = String(row[photosIdx])
              .split(/[\s,]+/)
              .map(u => u.trim())
              .filter(u => u.startsWith('http'));
          }
          if (photosList.length === 0) {
            photosList = [null];
          }

          // Extract tags
          let tagsList = [];
          if (tagsIdx !== -1 && row[tagsIdx]) {
            tagsList = String(row[tagsIdx])
              .split(',')
              .map(n => n.trim().toLowerCase().replace(/\s+/g, ''))
              .filter(Boolean)
              .map(nameKey => nameToId[nameKey])
              .filter(Boolean);
          }

          if (!family.scrapbook[ownerId]) {
            family.scrapbook[ownerId] = [];
          }

          family.scrapbook[ownerId].push({
            date: dateVal,
            caption: captionVal,
            photos: photosList,
            tags: tagsList
          });
        });

        console.log(`💾 Successfully merged scrapbook data into family.json!`);
      } else {
        console.warn(`  ⚠️ Could not find member/person ID column in Scrapbook sheet.`);
      }
    }
    
    // Save scrapbook back to family.json
    writeFileSync(familyPath, JSON.stringify(family, null, 2), 'utf8');
  }

  // Validate the data integrity
  console.log('\n🔍 Running data validation...');
  execSync(`npm run validate`, { stdio: 'inherit' });

  // The app renders tree-data.js, NOT data/family.json. Leaving this out meant every
  // sync updated family.json while the UI kept rendering a stale snapshot — the app was
  // showing 2026-05-23 test data (including junk "adsf"/"asdf" rows) no matter what the
  // pipeline did. Regenerating here keeps the rendered tree and the data in step.
  console.log('\n🌳 Regenerating tree-data.js for the app...');
  execSync(`node scripts/generate-tree-data.js`, { stdio: 'inherit' });

  console.log('\n🎉 Update pipeline completed successfully!');
}

// Exported so scripts/verify-pipeline.js can assert them offline, with no sheet access.
export { formatDate, reconcileHeaders, REQUIRED_HEADERS, OPTIONAL_HEADERS };

// Only hit the network when run directly, not when imported by the verifier.
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.dirname, 'pull-sheet.js')) {
  run().catch(err => {
    console.error('\n❌ Error executing pull script:', err.message);
    process.exit(1);
  });
}
