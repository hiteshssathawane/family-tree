#!/usr/bin/env node
/**
 * pull-sheet.js — Fetch private Google Sheet responses via Apps Script Web App,
 * map the columns/values to match the CSV import schema, and trigger the import pipeline.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';

// Default configuration (can also be set via environment variables)
const WEB_APP_URL = process.env.GOOGLE_SHEET_URL || "https://script.google.com/macros/s/AKfycbwbPcBgZyC0uFEYazabQoPoYegtpWMZMlE1M76EoqbAxRpG2nO3R6vhlFdak40o54bZ/exec";
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

  const url = `${WEB_APP_URL}?token=${token}&timestamp=${timestamp}`;
  const res = await fetch(url);
  
  if (!res.ok) {
    throw new Error(`Failed to fetch Sheet data (HTTP status: ${res.status})`);
  }
  
  const data = await res.json();
  if (data.error) {
    throw new Error(`Google Apps Script returned an error: ${data.error}`);
  }
  
  if (!Array.isArray(data) || data.length < 2) {
    console.log('⚠️  No data rows found in spreadsheet.');
    return;
  }

  const sheetHeaders = data[0].map(h => String(h).trim());
  const rows = data.slice(1);

  console.log(`📊 Retrieved ${rows.length} rows from Google Sheet.`);

  // Define target CSV headers
  const csvHeaders = [
    'firstName', 'fatherName', 'motherName', 'lastName',
    'gender', 'status', 'maritalStatus',
    'spouseFirstName', 'spouseFatherName', 'spouseMotherName', 'spouseLastName',
    'marriageDate', 'birthDate', 'birthPlace', 'deathDate', 'deathPlace',
    'occupation', 'education', 'location', 'biography', 'commonName',
    'firstNameMr', 'lastNameMr', 'profilePhoto'
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
      profilePhoto: getVal('Profile Picture')
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

  // Validate the data integrity
  console.log('\n🔍 Running data validation...');
  execSync(`npm run validate`, { stdio: 'inherit' });

  console.log('\n🎉 Update pipeline completed successfully!');
}

run().catch(err => {
  console.error('\n❌ Error executing pull script:', err.message);
  process.exit(1);
});
