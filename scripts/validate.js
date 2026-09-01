#!/usr/bin/env node
/**
 * validate.js — Validate family.json against the JSON Schema
 * Usage: node scripts/validate.js
 *        node scripts/validate.js data/family.json  (custom path)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import Ajv from 'ajv';

const dataPath   = resolve(process.argv[2] || 'data/family.json');
const schemaPath = resolve('data/family.schema.json');

console.log('📋 The Family Tree — Data Validator\n');

let data, schema;
try {
  data   = JSON.parse(readFileSync(dataPath, 'utf8'));
  schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
} catch (e) {
  console.error(`❌ Failed to read files: ${e.message}`);
  process.exit(1);
}

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);
const valid = validate(data);

if (!valid) {
  console.error('❌ Validation FAILED:\n');
  validate.errors.forEach(err => {
    console.error(`  • ${err.instancePath || '(root)'}: ${err.message}`);
  });
  process.exit(1);
}

// Business logic checks
const errors = [];
const warnings = [];
const persons = data.persons;
const ids = persons.map(p => p.id);

// Duplicate IDs
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length) errors.push(`Duplicate person IDs: ${[...new Set(dupes)].join(', ')}`);

// Relationship references
data.relationships.forEach(r => {
  if (r.type === 'parent-child') {
    if (!ids.includes(r.parentId)) errors.push(`R${r.id}: parentId ${r.parentId} not found`);
    if (!ids.includes(r.childId))  errors.push(`R${r.id}: childId ${r.childId} not found`);
  }
  if (r.type === 'marriage') {
    if (!ids.includes(r.person1Id)) errors.push(`R${r.id}: person1Id ${r.person1Id} not found`);
    if (!ids.includes(r.person2Id)) errors.push(`R${r.id}: person2Id ${r.person2Id} not found`);
  }
});

// Root person exists (if database is not empty)
if (persons.length > 0 && !ids.includes(data.meta.rootPersonId)) {
  errors.push(`rootPersonId ${data.meta.rootPersonId} not found in persons`);
}

// Deceased with no death date
persons.filter(p => p.status === 'deceased' && !p.deathDate)
  .forEach(p => warnings.push(`${p.id} (${p.firstName} ${p.lastName}) is deceased but has no deathDate`));

// Death date on anyone not marked deceased. Was `status === 'living'`, which missed the
// 'unknown' case entirely — the exact state a blank Status radio now produces.
persons.filter(p => p.status !== 'deceased' && p.deathDate)
  .forEach(p => errors.push(`${p.id} (${p.firstName} ${p.lastName}) has a deathDate but status is "${p.status}"`));

// A sheet that lost its radio answers imports as a wall of X/unknown and still passes every
// structural check, so report the shape of the import rather than only per-person faults.
const unanswered = {
  gender: persons.filter(p => p.gender === 'X').length,
  status: persons.filter(p => p.status === 'unknown').length,
  maritalStatus: persons.filter(p => p.maritalStatus === 'unknown').length,
};
Object.entries(unanswered)
  .filter(([, n]) => n > 0)
  .forEach(([field, n]) => warnings.push(
    `${n} of ${persons.length} persons have no ${field} — check the form's radio answers reached the Sheet`
  ));

// Print results
if (warnings.length) {
  console.warn('⚠️  Warnings:');
  warnings.forEach(w => console.warn(`  • ${w}`));
  console.warn('');
}

if (errors.length) {
  console.error('❌ Business logic errors:');
  errors.forEach(e => console.error(`  • ${e}`));
  process.exit(1);
}

console.log(`✅ family.json is valid!`);
console.log(`   ${persons.length} persons, ${data.relationships.length} relationships, ${data.events.length} events, ${data.media.length} media`);
console.log(`   Root: ${data.meta.rootPersonId} | Version: ${data.meta.version}`);
