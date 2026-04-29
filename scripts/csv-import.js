#!/usr/bin/env node
/**
 * csv-import.js — Bulk import members from CSV into family.json
 * Usage: node scripts/csv-import.js data/sample-import.csv
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const csvFile  = process.argv[2];
const dataPath = resolve('data/family.json');

if (!csvFile) {
  console.error('Usage: node scripts/csv-import.js <file.csv>');
  console.error('Download the template from the Admin panel in your browser.');
  process.exit(1);
}

console.log('📥 CSV Import — The Family Tree\n');

const csv = readFileSync(resolve(csvFile), 'utf8');
const family = JSON.parse(readFileSync(dataPath, 'utf8'));

const lines = csv.split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));

const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,''));
let added = 0, skipped = 0, errors = 0;

const existingIds = new Set(family.persons.map(p => p.id));

lines.slice(1).forEach((line, i) => {
  const vals = parseCSVLine(line);
  const row = {};
  headers.forEach((h, j) => { row[h] = (vals[j] || '').trim(); });

  if (!row.id || !row.firstName || !row.lastName) {
    console.warn(`  ⚠️  Row ${i+2}: missing id/firstName/lastName — skipping`);
    skipped++;
    return;
  }

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
    middleName: row.middleName || '',
    lastName: row.lastName,
    maidenName: row.maidenName || null,
    gender: row.gender || 'M',
    status: row.status || 'living',
    birthDate: row.birthDate || null,
    birthPlace: row.birthPlace || null,
    deathDate: row.deathDate || null,
    deathPlace: row.deathPlace || null,
    occupation: row.occupation || null,
    religion: row.religion || null,
    education: row.education || null,
    biography: row.biography || null,
    profilePhoto: row.profilePhoto || null,
    tags: row.tags ? row.tags.split(';').map(t => t.trim()) : [],
    private: false
  });

  existingIds.add(row.id);
  added++;
  console.log(`  ✅ Added: ${row.firstName} ${row.lastName} (${row.id})`);
});

if (added > 0) {
  family.meta.updatedAt = new Date().toISOString().split('T')[0];
  writeFileSync(dataPath, JSON.stringify(family, null, 2));
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
