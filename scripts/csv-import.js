#!/usr/bin/env node
/**
 * csv-import.js — Bulk import members from CSV into family.json
 * Usage: node scripts/csv-import.js data/sample-import.csv
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const csvFile  = process.argv[2];
const dataPath = resolve('data/family.json');
const authPath = resolve('data/auth.json');

if (!csvFile) {
  console.error('Usage: node scripts/csv-import.js <file.csv>');
  console.error('Download the template from the Admin panel in your browser.');
  process.exit(1);
}

console.log('📥 CSV Import — The Family Tree\n');

const csv = readFileSync(resolve(csvFile), 'utf8');
const family = JSON.parse(readFileSync(dataPath, 'utf8'));
let authData = { entries: [] };
try {
  authData = JSON.parse(readFileSync(authPath, 'utf8'));
} catch (e) {
  console.log('No existing auth.json found, will create one.');
}

const lines = csv.split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));

const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,''));
let added = 0, skipped = 0, errors = 0;

const existingIds = new Set(family.persons.map(p => p.id));
const parsedRows = [];

const monthMap = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

const formatDate = (d) => {
  if (!d) return null;
  d = d.trim();
  
  const monMatch = d.match(/^(\d{1,2})-?([a-zA-Z]{3})-?(\d{4})$/);
  if (monMatch) {
    const day = monMatch[1].padStart(2, '0');
    const month = monthMap[monMatch[2].toLowerCase()];
    const year = monMatch[3];
    if (month) return `${year}-${month}-${day}`;
  }
  
  if (/^\d{7}$/.test(d)) d = '0' + d;
  if (/^\d{8}$/.test(d)) return `${d.slice(4,8)}-${d.slice(2,4)}-${d.slice(0,2)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  
  return d;
};

lines.slice(1).forEach((line, i) => {
  const vals = parseCSVLine(line);
  
  if (vals.length !== headers.length) {
    console.warn(`  ⚠️  Row ${i+2}: incorrect number of columns (expected ${headers.length}, found ${vals.length}). Did you miss a comma? — skipping`);
    skipped++;
    return;
  }

  const row = {};
  headers.forEach((h, j) => { row[h] = (vals[j] || '').trim(); });

  if (!row.firstName || !row.lastName) {
    console.warn(`  ⚠️  Row ${i+2}: missing firstName/lastName — skipping`);
    skipped++;
    return;
  }

  const fatherNameStr = row.fatherName || '';
  const motherNameStr = row.motherName || '';
  row.id = `${row.firstName}_${motherNameStr}_${fatherNameStr}_${row.lastName}`.toUpperCase().replace(/\s+/g, '');

  if (existingIds.has(row.id)) {
    console.log(`  ℹ️  ${row.id} (${row.firstName} ${row.lastName}) already exists — skipping`);
    skipped++;
    return;
  }

  if (!['M','F','X'].includes(row.gender)) {
    console.warn(`  ⚠️  Row ${i+2}: invalid gender '${row.gender}' — defaulting to M`);
    row.gender = 'M';
  }

  family.persons.push({
    id: row.id,
    firstName: row.firstName,
    fatherName: row.fatherName || '',
    motherName: row.motherName || '',
    lastName: row.lastName,
    maidenName: row.maidenName || null,
    gender: row.gender || 'M',
    status: row.status || 'living',
    maritalStatus: row.maritalStatus || 'unknown',
    birthDate: formatDate(row.birthDate),
    birthPlace: row.birthPlace || null,
    deathDate: formatDate(row.deathDate),
    deathPlace: row.deathPlace || null,
    occupation: row.occupation || null,
    education: row.education || null,
    location: row.location || null,
    biography: row.biography || null,
    profilePhoto: row.profilePhoto || null,
    tags: row.tags ? row.tags.split(';').map(t => t.trim()) : [],
    private: false
  });

  if (row.birthDate && row.status !== 'deceased') {
    const fullName = `${row.firstName} ${row.lastName}`.trim();
    const formattedDob = formatDate(row.birthDate);
    const dobForHash = formattedDob ? `${formattedDob.slice(8,10)}${formattedDob.slice(5,7)}${formattedDob.slice(0,4)}` : '';
    const normalised = (fullName.toLowerCase().replace(/\s+/g, '') + dobForHash).replace(/[^a-z0-9]/g, '');
    const hash = createHash('sha256').update(normalised).digest('hex');
    
    if (!authData.entries.find(e => e.hash === hash)) {
      authData.entries.push({
        hash,
        role: 'viewer',
        branch: 'main',
        totpRequired: false,
        totpSecret: null,
        displayName: fullName
      });
      console.log(`  🔑 Auto-created 'viewer' login for ${fullName}`);
    }
  }

  existingIds.add(row.id);
  parsedRows.push(row);
  added++;
  console.log(`  ✅ Added: ${row.firstName} ${row.lastName} (${row.id})`);
});

console.log('\n🔗 Processing relationships...');
parsedRows.forEach((row) => {
  if (row.spouseFirstName && row.spouseLastName) {
    const sFirst = row.spouseFirstName.trim();
    const sLast = row.spouseLastName.trim();
    const sFather = (row.spouseFatherName || '').trim();
    const sMother = (row.spouseMotherName || '').trim();
    
    let potentialSpouses = [];

    if (sFather || sMother) {
      const exactId = `${sFirst}_${sMother}_${sFather}_${sLast}`.toUpperCase().replace(/\s+/g, '');
      const match = family.persons.find(p => p.id === exactId);
      if (match) potentialSpouses.push(match);
    } else {
      const nameNorm = `${sFirst} ${sLast}`.toLowerCase();
      potentialSpouses = family.persons.filter(p => 
        `${p.firstName} ${p.lastName}`.toLowerCase() === nameNorm
      );
    }

    if (potentialSpouses.length === 1) {
      const spouse = potentialSpouses[0];
      
      const exists = family.relationships.find(r => 
        r.type === 'marriage' && 
        ((r.person1Id === row.id && r.person2Id === spouse.id) || 
         (r.person1Id === spouse.id && r.person2Id === row.id))
      );

      if (!exists) {
        const relId = `R${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        family.relationships.push({
          id: relId,
          type: 'marriage',
          person1Id: row.id,
          person2Id: spouse.id,
          startDate: formatDate(row.marriageDate) || null,
          endDate: null,
          endReason: null,
          place: null,
          notes: null
        });
        console.log(`  💍 Added marriage: ${row.firstName} & ${spouse.firstName}`);
      }
    } else if (potentialSpouses.length === 0) {
      console.warn(`  ⚠️  Cannot link spouse for ${row.firstName}: '${sFirst} ${sLast}' not found.`);
    } else {
      console.warn(`  ⚠️  Cannot link spouse for ${row.firstName}: multiple people found named '${sFirst} ${sLast}'. Please provide spouseFatherName to resolve.`);
    }
  }
});

if (added > 0) {
  family.meta.updatedAt = new Date().toISOString().split('T')[0];
  writeFileSync(dataPath, JSON.stringify(family, null, 2));
  writeFileSync(authPath, JSON.stringify(authData, null, 2));
  console.log(`\n✅ Done! Added ${added} person(s). Skipped ${skipped}.`);
  console.log(`Run 'npm run validate' to verify.`);
} else {
  console.log(`\nℹ️  No new persons to add. Skipped ${skipped} rows.`);
}

// Handles quoted CSV fields
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
