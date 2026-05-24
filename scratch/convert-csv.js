import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// Read the old CSV
const oldCsvPath = resolve('The Family Tree (Remix)/sample-import.csv');
const oldCsv = readFileSync(oldCsvPath, 'utf8');

const lines = oldCsv.split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));

const oldHeaders = lines[0].split(',').map(h => h.trim());

// Function to parse a CSV line, handling quotes
function parseCSVLine(line) {
  const result = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { result.push(field); field = ''; continue; }
    field += c;
  }
  result.push(field);
  return result;
}

const parsedRows = [];
lines.slice(1).forEach(line => {
  const vals = parseCSVLine(line);
  const row = {};
  oldHeaders.forEach((h, index) => {
    row[h] = vals[index] || '';
  });
  parsedRows.push(row);
});

// Target headers
const newHeaders = [
  'Timestamp',
  'Mobile Number',
  'Profile Picture',
  'Background Picture',
  'First Name (English) *',
  'First Name (Marathi - पहिले नाव) *',
  'Last Name (English) *',
  'Last Name (Marathi - आडनाव) *',
  'Alias',
  'Father Name (English) *',
  'Mother Name (English) *',
  'Gender *',
  'Status *',
  'Marital Status *',
  'Spouse First Name (Mandatory if Married)',
  'Spouse Father Name',
  'Spouse Mother Name',
  'Spouse Last Name',
  'Marriage Date',
  'Birth Date *',
  'Birth Place *',
  'Death Date (If applicable, only if Status is Deceased)',
  'Death Place (If applicable, only if Status is Deceased)',
  'Occupation',
  'Education Details (Free text field for specific qualifications)',
  'Location (Current City/Region) *',
  'Biography'
];

function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

let output = newHeaders.join(',') + '\n';

parsedRows.forEach((row, i) => {
  // Map gender
  let gender = row.gender || 'M';
  if (gender === 'M') gender = 'Male';
  else if (gender === 'F') gender = 'Female';
  else gender = 'Other';

  // Map status
  let status = row.status || 'living';
  if (status === 'living') status = 'Living';
  else if (status === 'deceased') status = 'Deceased';

  // Map maritalStatus
  let maritalStatus = row.maritalStatus || 'single';
  if (maritalStatus === 'married') maritalStatus = 'Married';
  else if (maritalStatus === 'single') maritalStatus = 'Single';
  else if (maritalStatus === 'divorced') maritalStatus = 'Divorced';
  else if (maritalStatus === 'widowed') maritalStatus = 'Widowed';
  else maritalStatus = 'Single';

  const mapped = {
    'Timestamp': `24/05/2026 00:00:${String(i).padStart(2, '0')}`,
    'Mobile Number': '',
    'Profile Picture': '',
    'Background Picture': '',
    'First Name (English) *': row.firstName,
    'First Name (Marathi - पहिले नाव) *': row.firstNameMr,
    'Last Name (English) *': row.lastName,
    'Last Name (Marathi - आडनाव) *': row.lastNameMr,
    'Alias': row.commonName,
    'Father Name (English) *': row.fatherName,
    'Mother Name (English) *': row.motherName,
    'Gender *': gender,
    'Status *': status,
    'Marital Status *': maritalStatus,
    'Spouse First Name (Mandatory if Married)': row.spouseFirstName,
    'Spouse Father Name': row.spouseFatherName,
    'Spouse Mother Name': row.spouseMotherName,
    'Spouse Last Name': row.spouseLastName,
    'Marriage Date': row.marriageDate,
    'Birth Date *': row.birthDate,
    'Birth Place *': row.birthPlace,
    'Death Date (If applicable, only if Status is Deceased)': row.deathDate,
    'Death Place (If applicable, only if Status is Deceased)': row.deathPlace,
    'Occupation': row.occupation,
    'Education Details (Free text field for specific qualifications)': row.education,
    'Location (Current City/Region) *': row.location,
    'Biography': row.biography
  };

  const line = newHeaders.map(h => escapeCSV(mapped[h])).join(',');
  output += line + '\n';
});

writeFileSync(resolve('scratch/sheet-import.csv'), output, 'utf8');
console.log('Successfully written converted CSV to scratch/sheet-import.csv');
