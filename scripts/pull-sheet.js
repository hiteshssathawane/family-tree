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

console.log('📡 Fetching latest data from Google Sheet Web App...');

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

// Helper to format Date strings from Sheet
function formatDate(d) {
  if (!d) return '';
  d = String(d).trim();
  // If ISO date time (e.g. 1987-04-08T18:30:00.000Z), extract YYYY-MM-DD
  if (d.includes('T')) {
    return d.split('T')[0];
  }
  return d;
}

async function run() {
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

    // Gender Mapping
    let gender = String(getVal('Gender *')).trim();
    if (gender.toLowerCase().startsWith('m')) gender = 'M';
    else if (gender.toLowerCase().startsWith('f')) gender = 'F';
    else gender = 'X';

    // Status Mapping
    let status = String(getVal('Status *')).trim().toLowerCase();
    if (status.startsWith('liv')) status = 'living';
    else if (status.startsWith('dec')) status = 'deceased';
    else status = 'living';

    // Marital Status Mapping
    let maritalStatus = String(getVal('Marital Status *')).trim().toLowerCase();
    if (maritalStatus.startsWith('marr')) maritalStatus = 'married';
    else if (maritalStatus.startsWith('sing')) maritalStatus = 'single';
    else if (maritalStatus.startsWith('div')) maritalStatus = 'divorced';
    else if (maritalStatus.startsWith('wid')) maritalStatus = 'widowed';
    else maritalStatus = 'unknown';

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
      const dateIdx = findHeaderIdx(sbHeaders, ['date', 'year'], ['timestamp', 'birth', 'death', 'marriage']);
      const captionIdx = findHeaderIdx(sbHeaders, ['story', 'caption', 'description', 'text', 'details', 'memory']);
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
          const ownerVal = row[ownerIdx];
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

  console.log('\n🎉 Update pipeline completed successfully!');
}

run().catch(err => {
  console.error('\n❌ Error executing pull script:', err.message);
  process.exit(1);
});
