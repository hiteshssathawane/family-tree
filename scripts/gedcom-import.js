#!/usr/bin/env node
/**
 * gedcom-import.js — Import a GEDCOM 5.5.5 file into family.json
 * Usage: node scripts/gedcom-import.js path/to/file.ged
 *
 * Adds imported persons/families to existing family.json (merges, no overwrite)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const gedFile  = process.argv[2];
const dataPath = resolve('data/family.json');

if (!gedFile) {
  console.error('Usage: node scripts/gedcom-import.js <file.ged>');
  process.exit(1);
}

console.log('📂 GEDCOM Import — The Family Tree\n');

const ged = readFileSync(resolve(gedFile), 'utf8');
const family = JSON.parse(readFileSync(dataPath, 'utf8'));

// Parse GEDCOM into records
function parseGEDCOM(text) {
  const records = {};
  let current = null;

  text.split('\n').forEach(rawLine => {
    const line = rawLine.trim();
    if (!line) return;
    const m = line.match(/^(\d+)\s+(@[^@]+@)?\s*(\w+)\s*(.*)?$/);
    if (!m) return;
    const [, level, xref, tag, value] = m;
    const lvl = parseInt(level);

    if (lvl === 0 && xref) {
      current = { id: xref.replace(/@/g,''), tag, children: [], raw: {} };
      records[current.id] = current;
    } else if (current) {
      if (!current.raw[tag]) current.raw[tag] = [];
      current.raw[tag].push({ value: value?.trim() || '', level: lvl });
    }
  });

  return records;
}

const records = parseGEDCOM(ged);

// Get existing IDs
const existingPersonIds = new Set(family.persons.map(p => p.id));
const existingRelIds = new Set(family.relationships.map(r => r.id));
const existingEventIds = new Set(family.events.map(e => e.id));

let personsAdded = 0, relsAdded = 0;

// Helper: get child tag value
function val(raw, tag, sub) {
  const entries = raw[tag];
  if (!entries || !entries.length) return null;
  if (!sub) return entries[0].value || null;
  // sub-tag (e.g. BIRT > DATE)
  return null; // simplified — extend for production use
}

// Process INDI records
Object.values(records).filter(r => r.tag === 'INDI').forEach(rec => {
  const id = rec.id; // e.g. "I1"
  const personId = 'P' + id.replace(/\D/g,'');
  if (existingPersonIds.has(personId)) return;

  const name = val(rec.raw, 'NAME') || '';
  const parts = name.replace(/\//g,'').trim().split(' ');
  const firstName = parts[0] || 'Unknown';
  const lastName  = parts.slice(1).join(' ') || 'Unknown';
  const sex = val(rec.raw, 'SEX') || 'M';

  const person = {
    id: personId,
    firstName, lastName,
    gender: sex === 'F' ? 'F' : 'M',
    status: 'unknown',
    birthDate: null, birthPlace: null,
    deathDate: null, deathPlace: null,
    private: false
  };

  // Try to get BIRT/DEAT sub-records — simplified
  const lines = ged.split('\n');
  let inIndividual = false, inBirt = false, inDeat = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.includes(`@${id}@`)) { inIndividual = true; continue; }
    if (inIndividual && line.match(/^0 @/)) break;
    if (!inIndividual) continue;

    if (line === '1 BIRT') { inBirt = true; inDeat = false; continue; }
    if (line === '1 DEAT' || line === '1 DEAT Y') { inDeat = true; inBirt = false; person.status = 'deceased'; continue; }
    if (line.match(/^1 /)) { inBirt = false; inDeat = false; }

    if (inBirt && line.startsWith('2 DATE')) { person.birthDate = line.replace('2 DATE','').trim(); }
    if (inBirt && line.startsWith('2 PLAC')) { person.birthPlace = line.replace('2 PLAC','').trim(); }
    if (inDeat && line.startsWith('2 DATE')) { person.deathDate = line.replace('2 DATE','').trim(); }
    if (inDeat && line.startsWith('2 PLAC')) { person.deathPlace = line.replace('2 PLAC','').trim(); }
  }

  if (person.status === 'unknown' && !person.deathDate) person.status = 'living';

  family.persons.push(person);
  existingPersonIds.add(personId);
  personsAdded++;
});

// Process FAM records
Object.values(records).filter(r => r.tag === 'FAM').forEach(rec => {
  const famId = rec.id;
  const husbId = val(rec.raw, 'HUSB')?.replace(/@/g,'');
  const wifeId = val(rec.raw, 'WIFE')?.replace(/@/g,'');
  const childIds = (rec.raw['CHIL'] || []).map(c => c.value.replace(/@/g,''));

  if (husbId && wifeId) {
    const relId = 'R' + (family.relationships.length + 1).toString().padStart(3,'0');
    if (!existingRelIds.has(relId)) {
      const p1 = 'P' + husbId.replace(/\D/g,'');
      const p2 = 'P' + wifeId.replace(/\D/g,'');
      family.relationships.push({ id: relId, type: 'marriage', person1Id: p1, person2Id: p2, startDate: null, endDate: null });
      existingRelIds.add(relId);
      relsAdded++;
    }
  }

  childIds.forEach(cid => {
    if (husbId) {
      const relId = 'R' + (family.relationships.length + 1).toString().padStart(3,'0');
      family.relationships.push({ id: relId, type: 'parent-child', parentId: 'P' + husbId.replace(/\D/g,''), childId: 'P' + cid.replace(/\D/g,''), relation: 'biological' });
      relsAdded++;
    }
    if (wifeId) {
      const relId = 'R' + (family.relationships.length + 1).toString().padStart(3,'0');
      family.relationships.push({ id: relId, type: 'parent-child', parentId: 'P' + wifeId.replace(/\D/g,''), childId: 'P' + cid.replace(/\D/g,''), relation: 'biological' });
      relsAdded++;
    }
  });
});

// Update meta
family.meta.updatedAt = new Date().toISOString().split('T')[0];

writeFileSync(dataPath, JSON.stringify(family, null, 2));
console.log(`✅ Import complete!`);
console.log(`   Added ${personsAdded} persons, ${relsAdded} relationships`);
console.log(`   Total: ${family.persons.length} persons, ${family.relationships.length} relationships`);
console.log(`\nRun 'npm run validate' to verify the result.`);
