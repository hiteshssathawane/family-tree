#!/usr/bin/env node
/**
 * backfill-auth-personid.js — stamp `personId` onto existing data/auth.json entries.
 *
 * worker/photo-upload.js authorises a photo upload by checking that the identity
 * hash the browser presents belongs to the person it claims to be. That check reads
 * `entry.personId`. csv-import.js now writes it on every import, but entries minted
 * before that change have no personId, and the Worker would reject every one of them.
 *
 * This resolves each entry to a person using the same rule the app's login uses
 * (index.html — direct "First Last" match, or a married woman matched on her
 * husband's surname) and writes the id back.
 *
 * Idempotent and safe to re-run: entries that already carry a personId are left
 * alone, and nothing is written when there is nothing to change.
 *
 *   node scripts/backfill-auth-personid.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const authPath = resolve('data/auth.json');
const familyPath = resolve('data/family.json');

const auth = JSON.parse(readFileSync(authPath, 'utf8'));
const family = JSON.parse(readFileSync(familyPath, 'utf8'));

// Same resolution the login performs, kept deliberately identical so a member the app
// can log in as is a member this can resolve.
function findPerson(displayName) {
  const target = String(displayName || '').toLowerCase().trim();
  if (!target) return null;

  return family.persons.find(p => {
    if (`${p.firstName} ${p.lastName}`.toLowerCase().trim() === target) return true;

    // A married woman's login uses her husband's surname, not her maiden name.
    if (p.gender === 'F' || p.gender === 'f') {
      const marriage = family.relationships.find(
        r => r.type === 'marriage' && (r.person1Id === p.id || r.person2Id === p.id)
      );
      if (marriage) {
        const spouseId = marriage.person1Id === p.id ? marriage.person2Id : marriage.person1Id;
        const husband = family.persons.find(
          h => h.id === spouseId && (h.gender === 'M' || h.gender === 'm')
        );
        if (husband && husband.lastName) {
          return `${p.firstName} ${husband.lastName}`.toLowerCase().trim() === target;
        }
      }
    }
    return false;
  }) || null;
}

console.log('🔗 Backfilling personId on auth entries\n');

let stamped = 0, already = 0;
const unresolved = [];

auth.entries.forEach(entry => {
  if (entry.personId) { already++; return; }
  const person = findPerson(entry.displayName);
  if (!person) {
    unresolved.push(entry.displayName || '(no displayName)');
    return;
  }
  entry.personId = person.id;
  stamped++;
  console.log(`  ✅ ${entry.displayName} → ${person.id}`);
});

if (unresolved.length) {
  console.log('');
  unresolved.forEach(n => console.log(`  ⚠️  Could not resolve "${n}" to a person — left without a personId.`));
  console.log('     Those logins still work; they just cannot change their photo until resolved.');
}

if (stamped > 0) {
  writeFileSync(authPath, JSON.stringify(auth, null, 2));
  console.log(`\n💾 Wrote data/auth.json — ${stamped} stamped, ${already} already had one, ${unresolved.length} unresolved.`);
} else {
  console.log(`\n✨ Nothing to do — ${already} already had a personId, ${unresolved.length} unresolved.`);
}
