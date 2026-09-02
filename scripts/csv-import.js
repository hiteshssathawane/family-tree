#!/usr/bin/env node
/**
 * csv-import.js — Bulk import members from CSV into family.json
 * Usage: node scripts/csv-import.js data/sample-import.csv
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// Keep in step with window.UNKNOWN_BIRTH_DATE in tree-helpers.js — the runtime uses it
// to keep this placeholder out of the profile panel, the calendar and the .ics feed.
const UNKNOWN_BIRTH_DATE = '1970-01-01';

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

family.persons = [];
family.relationships = [];
const addedIds = new Set();
const parsedRows = [];

const monthMap = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

const formatDate = (d) => {
  if (!d) return null;
  d = d.trim();
  
  // 1. Check if already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  
  // 2. D-Mon-YY or D-Mon-YYYY (e.g., 29-Dec-85 or 29-Dec-1985)
  const monMatch = d.match(/^(\d{1,2})-?([a-zA-Z]{3})-?(\d{2,4})$/);
  if (monMatch) {
    const day = monMatch[1].padStart(2, '0');
    const month = monthMap[monMatch[2].toLowerCase()];
    let year = monMatch[3];
    if (year.length === 2) {
      year = parseInt(year) >= 30 ? '19' + year : '20' + year;
    }
    if (month) return `${year}-${month}-${day}`;
  }
  
  // 3. M/D/YY or M/D/YYYY (e.g., 9/4/87 or 11/29/1984)
  const slashMatch = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const month = slashMatch[1].padStart(2, '0');
    const day = slashMatch[2].padStart(2, '0');
    let year = slashMatch[3];
    if (year.length === 2) {
      year = parseInt(year) >= 30 ? '19' + year : '20' + year;
    }
    return `${year}-${month}-${day}`;
  }
  
  // 4. D-Mon (e.g., 19-Jan, 5-Sep, 20-Sep)
  const dayMonMatch = d.match(/^(\d{1,2})-?([a-zA-Z]{3})$/);
  if (dayMonMatch) {
    const day = dayMonMatch[1].padStart(2, '0');
    const month = monthMap[dayMonMatch[2].toLowerCase()];
    if (month) return `1900-${month}-${day}`;
  }
  
  // 5. 8-digit or 7-digit numbers (DDMMYYYY)
  if (/^\d{7}$/.test(d)) d = '0' + d;
  if (/^\d{8}$/.test(d)) return `${d.slice(4,8)}-${d.slice(2,4)}-${d.slice(0,2)}`;
  
  return d;
};

// T-34: resolve a father/mother/spouse reference against an existing person by name
// before minting a new composite id. Matching used to require the EXISTING record's
// gender to already equal the role being resolved (e.g. father lookup required
// x.gender === 'M') — but that gender can be wrong or 'X' on a person created from an
// incomplete row, so a real match silently failed and a duplicate stub got created
// instead (the root cause of the Hitesh/HITESH___SATHAWANE split). Gender is now used
// only to disambiguate if more than one name match exists, never to block a match.
//
// lastName is optional: pass it for father/spouse, where the CSV assumes the person's
// own lastName equals the child's (paternal surname). Omit it for mother — her own row
// keeps her maiden lastName, which won't equal the child's paternal surname, so
// requiring it here would break the very match this fix exists to make.
function findExistingPerson(firstName, lastName, preferredGender) {
  const fn = firstName.trim().toLowerCase();
  const ln = lastName ? lastName.trim().toLowerCase() : null;
  const candidates = family.persons.filter(x =>
    x.firstName.trim().toLowerCase() === fn &&
    (ln === null || x.lastName.trim().toLowerCase() === ln)
  );
  if (candidates.length <= 1) return candidates[0] || null;
  const genderMatch = preferredGender && candidates.find(x => x.gender === preferredGender);
  if (genderMatch) return genderMatch;
  console.warn(`  ⚠️  Multiple existing persons named "${firstName}${lastName ? ' ' + lastName : ''}" — using the first match (${candidates[0].id}). Check for a real duplicate.`);
  return candidates[0];
}

// A married woman is one person under two surnames: her husband names her by her maiden
// name in his Spouse fields, while her own Form row carries the married name she signs
// and logs in with. findExistingPerson keys on the surname, so those two never met and
// she entered the tree twice — one node holding her details, the other holding the
// marriage.
//
// Parents are the part of an identity that marriage does not change, so match on
// first name + father + mother and ignore the surname entirely. Both parent names must
// be present on both sides: every auto-created stub has blank parents, and matching on
// a blank would collapse every unrelated "Swati" in the tree into one person. A known
// gender that disagrees also blocks the match.
function findPersonByParents(firstName, fatherName, motherName, preferredGender) {
  const fn = (firstName || '').trim().toLowerCase();
  const fa = (fatherName || '').trim().toLowerCase();
  const mo = (motherName || '').trim().toLowerCase();
  if (!fn || !fa || !mo) return null;

  const candidates = family.persons.filter(x => {
    if (x.firstName.trim().toLowerCase() !== fn) return false;
    if ((x.fatherName || '').trim().toLowerCase() !== fa) return false;
    if ((x.motherName || '').trim().toLowerCase() !== mo) return false;
    // 'X' is "not recorded", so it never contradicts anything.
    if (preferredGender && x.gender && x.gender !== 'X' && preferredGender !== 'X' &&
        x.gender !== preferredGender) return false;
    return true;
  });
  return candidates[0] || null;
}

// Identity is the maiden surname; the husband's surname is a display name derived
// downstream (tree-helpers.js renders "Swati Sathawane (Biradar)", and csv-import's own
// login pass hashes the married name). So when the two rows disagree about a wife's
// surname, the maiden one is simply whichever is NOT her husband's — no extra Form
// question needed, and it is the same answer whichever row arrived first.
function reconcileMaidenName(wife, husbandLastName, otherLastName) {
  const husband = (husbandLastName || '').trim();
  const other = (otherLastName || '').trim();
  if (!husband || !other) return;
  if (other.toLowerCase() === husband.toLowerCase()) return;

  const current = (wife.lastName || '').trim();
  if (current.toLowerCase() === husband.toLowerCase()) {
    // She is stored under her married name — swap identity back to the maiden one.
    wife.lastName = other;
    wife.maidenName = other;
    console.log(`  👰 ${wife.firstName}: identity set to maiden name '${other}' (displays as '${husband}')`);
  } else if (!wife.maidenName) {
    wife.maidenName = current;
  }
}

// T-08: Google Forms appends a row per submission, so a member correcting their details
// produces a second row with the same derived id. Keeping the FIRST occurrence meant the
// stale row always won and the correction was silently dropped — there was no way to fix
// a record through the form at all. Resolve each id to its LAST occurrence so that
// resubmitting the form *is* the correction mechanism.
//
// The key deliberately drops the surname when both parents are known, because a woman
// who resubmits after her wedding files the same identity under a new last name. Keyed
// on the surname those are two people; keyed on her parents they are one, and the later
// row still wins. Rows with an incomplete parent pair keep the surname in the key —
// without it, two unrelated members sharing a first name would supersede each other.
function identityKey(r) {
  const father = (r.fatherName || '').trim();
  const mother = (r.motherName || '').trim();
  const stem = father && mother
    ? `${r.firstName}_${mother}_${father}`
    : `${r.firstName}_${mother}_${father}_${r.lastName}`;
  return stem.toUpperCase().replace(/\s+/g, '');
}

const lastRowIndexById = new Map();
lines.slice(1).forEach((line, i) => {
  const vals = parseCSVLine(line);
  if (vals.length > headers.length) return;
  const r = {};
  headers.forEach((h, j) => { r[h] = (vals[j] || '').trim(); });
  if (!r.firstName || !r.lastName) return;
  lastRowIndexById.set(identityKey(r), i);
});

lines.slice(1).forEach((line, i) => {
  const vals = parseCSVLine(line);

  if (vals.length > headers.length) {
    console.warn(`  ⚠️  Row ${i+2}: too many columns (expected ${headers.length}, found ${vals.length}) — skipping`);
    skipped++;
    return;
  }
  while (vals.length < headers.length) {
    vals.push('');
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

  // Superseded by a later submission for the same person — that one carries the fix.
  if (lastRowIndexById.get(identityKey(row)) !== i) {
    console.log(`  ↻  ${row.firstName} ${row.lastName} — superseded by a later submission`);
    skipped++;
    return;
  }
  if (addedIds.has(row.id)) {
    console.log(`  ℹ️  ${row.id} (${row.firstName} ${row.lastName}) duplicate in CSV — skipping`);
    skipped++;
    return;
  }

  // Unknown must stay unknown. Guessing 'M' here used to silently mis-sex people and,
  // worse, flipped their spouse to the opposite wrong gender further down.
  if (!['M','F','X'].includes(row.gender)) {
    console.warn(`  ⚠️  Row ${i+2}: unrecognised gender '${row.gender}' — recording as 'X' (unknown)`);
    row.gender = 'X';
  }

  family.persons.push({
    id: row.id,
    firstName: row.firstName,
    fatherName: row.fatherName || '',
    motherName: row.motherName || '',
    lastName: row.lastName,
    maidenName: row.maidenName || null,
    // Defaults match pull-sheet.js: Male / Active / Single. A death date still overrides
    // the status default, so an import can never mark a person with a death date alive.
    gender: row.gender || 'M',
    status: row.status || (formatDate(row.deathDate) ? 'deceased' : 'living'),
    maritalStatus: row.maritalStatus || 'single',
    // Identity is SHA-256(name + DDMMYYYY), so a member with no DOB gets no hash and
    // cannot log in at all. The placeholder gives them one. It is a login token, not a
    // birth date: tree-helpers.js reports hasBirthYear false for it, and the calendar
    // raises no birthday and writes no .ics event for it, so it never renders as a fact.
    birthDate: formatDate(row.birthDate) || UNKNOWN_BIRTH_DATE,
    birthPlace: row.birthPlace || null,
    // Never discard a death date on the strength of the status field. This used to read
    // `row.status === 'living' ? null : …`, so one blank Status radio erased the date —
    // and erased the very contradiction validate.js exists to catch. Keep both and let
    // validation report the conflict instead of silently resolving it.
    deathDate: formatDate(row.deathDate),
    deathPlace: row.deathPlace || null,
    occupation: row.occupation || null,
    education: row.education || null,
    location: row.location || null,
    commonName: row.commonName || null,
    commonNameMr: row.commonNameMr || null,
    firstNameMr: row.firstNameMr || null,
    lastNameMr: row.lastNameMr || null,
    biography: row.biography || null,
    profilePhoto: row.profilePhoto || null,
    backgroundPhoto: row.backgroundPhoto || null,
    tags: row.tags ? row.tags.split(';').map(t => t.trim()) : [],
    private: false
  });

  // Login auto-generation moved to the end of the import process after all relationships are processed

  addedIds.add(row.id);
  parsedRows.push(row);
  added++;
  console.log(`  ✅ Added: ${row.firstName} ${row.lastName} (${row.id})`);
});

// Auto-create parents for any person who lists fatherName/motherName but lacks those nodes in the database
// Settle every wife's surname BEFORE parents are auto-created. The parent pass names a
// father from the child's own surname, so running it while a woman is still stored under
// her married name gives her parents the husband's surname — Swati's father came out as
// "Bhimrao Sathawane" instead of "Bhimrao Biradar". Only a husband's row carries the
// maiden name (his Spouse Last Name), which is why this cannot be done from her row alone.
console.log('\n👰 Reconciling maiden surnames...');
parsedRows.forEach((row) => {
  if (!row.spouseFirstName) return;
  const sGender = row.gender === 'M' ? 'F' : row.gender === 'F' ? 'M' : null;
  if (sGender !== 'F') return;

  const sFirst = row.spouseFirstName.trim();
  const sLast = (row.spouseLastName || '').trim() || row.lastName.trim();
  const sFather = (row.spouseFatherName || '').trim();
  const sMother = (row.spouseMotherName || '').trim();
  const exactId = `${sFirst}_${sMother}_${sFather}_${sLast}`.toUpperCase().replace(/\s+/g, '');

  const wife = family.persons.find(p => p.id === exactId)
    || findExistingPerson(sFirst, sLast, 'F')
    || findPersonByParents(sFirst, sFather, sMother, 'F');
  if (wife) reconcileMaidenName(wife, row.lastName, sLast);
});

console.log('\n🚸 Auto-detecting and creating missing parents...');
const currentPersons = [...family.persons];
currentPersons.forEach((p) => {
  let childBirthYear = null;
  if (p.birthDate) {
    const match = p.birthDate.match(/^(\d{4})/);
    if (match) childBirthYear = parseInt(match[1]);
  } else if (p.birth) {
    childBirthYear = p.birth;
  }
  const parentStatus = (childBirthYear && childBirthYear < 1975) || p.status === 'deceased' ? 'deceased' : 'living';

  let father = null;
  if (p.fatherName) {
    const fFirst = p.fatherName.trim();
    const fLast = p.lastName.trim();
    const fatherId = `${fFirst}___${fLast}`.toUpperCase().replace(/\s+/g, '');
    
    father = family.persons.find(x => x.id === fatherId) || findExistingPerson(fFirst, fLast, 'M');

    if (!father) {
      father = {
        id: fatherId,
        firstName: fFirst,
        fatherName: '',
        motherName: '',
        lastName: fLast,
        maidenName: null,
        gender: 'M',
        status: parentStatus,
        maritalStatus: 'married',
        birthDate: null,
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
        biography: `Father of ${p.firstName} ${p.lastName}.`,
        profilePhoto: null,
        tags: [],
        private: false
      };
      family.persons.push(father);
      addedIds.add(fatherId);
      added++;
      console.log(`  ➕ Auto-created father node: ${fFirst} ${fLast} (${fatherId})`);
    }
  }

  let mother = null;
  if (p.motherName) {
    const mFirst = p.motherName.trim();
    const mLast = p.lastName.trim();
    const motherId = `${mFirst}___${mLast}`.toUpperCase().replace(/\s+/g, '');
    
    mother = family.persons.find(x => x.id === motherId) || findExistingPerson(mFirst, null, 'F');

    if (!mother) {
      mother = {
        id: motherId,
        firstName: mFirst,
        fatherName: '',
        motherName: '',
        lastName: mLast,
        maidenName: null,
        gender: 'F',
        status: parentStatus,
        maritalStatus: 'married',
        birthDate: null,
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
        biography: `Mother of ${p.firstName} ${p.lastName}.`,
        profilePhoto: null,
        tags: [],
        private: false
      };
      family.persons.push(mother);
      addedIds.add(motherId);
      added++;
      console.log(`  ➕ Auto-created mother node: ${mFirst} ${mLast} (${motherId})`);
    }
  }

  if (father && mother) {
    const exists = family.relationships.find(r => 
      r.type === 'marriage' && 
      ((r.person1Id === father.id && r.person2Id === mother.id) || 
       (r.person1Id === mother.id && r.person2Id === father.id))
    );
    if (!exists) {
      const p1 = father.id < mother.id ? father.id : mother.id;
      const p2 = father.id < mother.id ? mother.id : father.id;
      const relId = `R_M_${p1}_${p2}`;
      family.relationships.push({
        id: relId,
        type: 'marriage',
        person1Id: p1,
        person2Id: p2,
        startDate: null,
        endDate: null,
        endReason: null,
        place: null,
        notes: `Auto-created parental marriage link.`
      });
      console.log(`  💍 Auto-created marriage: ${father.firstName} & ${mother.firstName}`);
    }
  }
});

console.log('\n🔗 Processing marriages...');
parsedRows.forEach((row) => {
  if (row.spouseFirstName) {
    const sFirst = row.spouseFirstName.trim();
    const sLast = (row.spouseLastName || '').trim() || row.lastName.trim();
    const sFather = (row.spouseFatherName || '').trim();
    const sMother = (row.spouseMotherName || '').trim();
    
    const exactId = `${sFirst}_${sMother}_${sFather}_${sLast}`.toUpperCase().replace(/\s+/g, '');

    // Infer the spouse's gender only from a known one. The old `=== 'M' ? 'F' : 'M'`
    // turned every unknown-gender member's wife into a male node.
    const sGender = row.gender === 'M' ? 'F'
                  : row.gender === 'F' ? 'M'
                  : null;

    // Third resolution step: the same person under a different surname. This is the one
    // that stops a wife entering the tree twice — once as her husband names her (maiden)
    // and once as she names herself (married).
    let spouse = family.persons.find(p => p.id === exactId)
      || findExistingPerson(sFirst, sLast, sGender)
      || findPersonByParents(sFirst, sFather, sMother, sGender);

    if (spouse && sGender === 'F') {
      // `row` is the husband here, so his lastName is the married surname.
      reconcileMaidenName(spouse, row.lastName, sLast);
    }

    if (!spouse) {
      spouse = {
        id: exactId,
        firstName: sFirst,
        fatherName: sFather,
        motherName: sMother,
        lastName: sLast,
        maidenName: null,
        gender: sGender || 'X',
        status: 'living',
        maritalStatus: 'married',
        birthDate: null,
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
        biography: `Spouse of ${row.firstName} ${row.lastName}.`,
        profilePhoto: null,
        tags: [],
        private: false
      };
      family.persons.push(spouse);
      addedIds.add(exactId);
      added++;
      console.log(`  ➕ Auto-created spouse node: ${sFirst} ${sLast} (${exactId})`);
    }

    const exists = family.relationships.find(r => 
      r.type === 'marriage' && 
      ((r.person1Id === row.id && r.person2Id === spouse.id) || 
       (r.person1Id === spouse.id && r.person2Id === row.id))
    );

    if (!exists) {
      const p1 = row.id < spouse.id ? row.id : spouse.id;
      const p2 = row.id < spouse.id ? spouse.id : row.id;
      const relId = `R_M_${p1}_${p2}`;
      family.relationships.push({
        id: relId,
        type: 'marriage',
        person1Id: p1,
        person2Id: p2,
        startDate: formatDate(row.marriageDate) || null,
        endDate: null,
        endReason: null,
        place: null,
        notes: null
      });
      console.log(`  💍 Added marriage: ${row.firstName} & ${spouse.firstName}`);
    } else {
      // The parental pass above runs first and links a couple the moment a *child's*
      // row names them as father + mother — but a child's row carries no marriage
      // date, so that link is minted with startDate: null. When the couple's own row
      // arrives here it found `exists` and returned, dropping the date on the floor:
      // every anniversary in the tree was lost this way. Backfill instead of skipping.
      const startDate = formatDate(row.marriageDate) || null;
      if (startDate && !exists.startDate) {
        exists.startDate = startDate;
        if (exists.notes === 'Auto-created parental marriage link.') exists.notes = null;
        console.log(`  💍 Backfilled marriage date for ${row.firstName} & ${spouse.firstName}: ${startDate}`);
      }
    }
  }
});

// Auto-link parent-child relationships for all persons
console.log('\n🚸 Processing parent-child relationships...');
family.persons.forEach((p) => {
  let father = null;
  if (p.fatherName) {
    // Gender disambiguates here, it must never block. T-34 removed exactly this condition
    // from findExistingPerson but left it standing in this second pass, so a father whose
    // own gender is 'X' — every person whose Gender radio came back blank — matched nothing
    // and the edge was dropped in silence. That is why Dhruv and Arjun had no parents at
    // all while the Sheet named Hitesh and Swati for both.
    // Self-exclusion is required, not defensive: the data really does contain
    // "Sampathrao, father Sampathrao, Sathawane", who would otherwise father himself.
    const fCandidates = family.persons.filter(f =>
      f.id !== p.id &&
      f.firstName.toLowerCase() === p.fatherName.toLowerCase() &&
      f.lastName.toLowerCase() === p.lastName.toLowerCase()
    );
    const males = fCandidates.filter(f => f.gender === 'M');
    father = (males.length ? males : fCandidates)[0] || null;
    if (father) {
      const exists = family.relationships.some(r => 
        r.type === 'parent-child' && 
        r.parentId === father.id && 
        r.childId === p.id
      );
      if (!exists) {
        family.relationships.push({
          id: `R_PC_${father.id}_${p.id}`,
          type: 'parent-child',
          parentId: father.id,
          childId: p.id,
          relation: 'biological'
        });
        console.log(`  👪 Added parent-child: ${father.firstName} ➔ ${p.firstName}`);
      }
    }
  }

  if (p.motherName) {
    let mother = null;
    // Same rule as the father lookup above: prefer 'F', but fall back to the unfiltered
    // pool rather than dropping the edge when gender is unknown. lastName is deliberately
    // not required — her own row keeps her maiden surname.
    const allCandidates = family.persons.filter(m =>
      m.id !== p.id &&
      m.firstName.toLowerCase() === p.motherName.toLowerCase()
    );
    const females = allCandidates.filter(m => m.gender === 'F');
    const candidates = females.length ? females : allCandidates;
    if (candidates.length === 1) {
      mother = candidates[0];
    } else if (candidates.length > 1) {
      if (father) {
        mother = candidates.find(m => 
          family.relationships.some(r => 
            r.type === 'marriage' && 
            ((r.person1Id === father.id && r.person2Id === m.id) || 
             (r.person2Id === father.id && r.person1Id === m.id))
          )
        );
      }
      if (!mother) {
        mother = candidates.find(m => m.lastName.toLowerCase() === p.lastName.toLowerCase());
      }
    }

    if (mother) {
      const exists = family.relationships.some(r => 
        r.type === 'parent-child' && 
        r.parentId === mother.id && 
        r.childId === p.id
      );
      if (!exists) {
        family.relationships.push({
          id: `R_PC_${mother.id}_${p.id}`,
          type: 'parent-child',
          parentId: mother.id,
          childId: p.id,
          relation: 'biological'
        });
        console.log(`  👪 Added parent-child: ${mother.firstName} ➔ ${p.firstName}`);
      }
    }
  }
});

// Auto-generate/update logins for living members with correct naming conventions
console.log('\n🔑 Regenerating / updating logins for living members...');
const newAuthEntries = [];

// Preserve the hardcoded admin login for Hitesh Sathawane.
//
// This must never be conditional. The loop below skips whichever person hashes to
// adminHash, on the assumption the entry was already preserved here. If auth.json had
// been wiped, that assumption left ZERO admin entries and locked the owner out of the
// app with no error anywhere. Rebuild it when it is absent.
const adminHash = '974447909d98279f6429b03355055fd113ccfb7628e501f897a4a68331d548f9';
const adminEntry = authData.entries.find(e => e.hash === adminHash) || {
  hash: adminHash,
  role: 'admin',
  branch: 'main',
  totpRequired: false,
  totpSecret: null,
  displayName: 'Hitesh Sathawane'
};
if (!authData.entries.some(e => e.hash === adminHash)) {
  console.log('  🛡️  Admin login was missing from auth.json — restored it.');
}
newAuthEntries.push(adminEntry);

// One person must never end up with two logins. Ranked so that when the same displayName
// resolves twice, the more privileged role survives rather than being downgraded.
const ROLE_RANK = { admin: 3, contributor: 2, viewer: 1 };
function addAuthEntry(entry) {
  if (!entry) return;
  if (newAuthEntries.some(e => e.hash === entry.hash)) return;

  const name = String(entry.displayName || '').toLowerCase();
  const clash = name && newAuthEntries.find(
    e => String(e.displayName || '').toLowerCase() === name
  );
  if (clash) {
    const keep = (ROLE_RANK[entry.role] ?? 0) > (ROLE_RANK[clash.role] ?? 0) ? entry.role : clash.role;
    console.warn(
      `  ⚠️  Duplicate login for "${entry.displayName}" (${clash.hash.slice(0, 12)}… vs ` +
      `${entry.hash.slice(0, 12)}…) — keeping the first, role '${keep}'.`
    );
    clash.role = keep;
    return;
  }
  newAuthEntries.push(entry);
}

family.persons.forEach(p => {
  if (p.status !== 'deceased' && p.birthDate) {
    let loginLastName = p.lastName;
    
    // If female and married, look up the husband's last name
    if (p.gender === 'F' || p.gender === 'f') {
      const marriage = family.relationships.find(r => 
        r.type === 'marriage' && (r.person1Id === p.id || r.person2Id === p.id)
      );
      if (marriage) {
        const spouseId = marriage.person1Id === p.id ? marriage.person2Id : marriage.person1Id;
        const spouse = family.persons.find(x => x.id === spouseId);
        if (spouse && (spouse.gender === 'M' || spouse.gender === 'm') && spouse.lastName) {
          loginLastName = spouse.lastName;
        }
      }
    }
    
    const fullName = `${p.firstName} ${loginLastName}`.trim();
    const formattedDob = p.birthDate;
    const dobForHash = formattedDob ? `${formattedDob.slice(8,10)}${formattedDob.slice(5,7)}${formattedDob.slice(0,4)}` : '';
    const normalised = (fullName.toLowerCase().replace(/\s+/g, '') + dobForHash).replace(/[^a-z0-9]/g, '');
    const hash = createHash('sha256').update(normalised).digest('hex');
    
    // If it is the admin hash itself, skip (already preserved above)
    if (hash === adminHash) {
      return;
    }
    
    let matchedEntry = authData.entries.find(e => e.hash === hash);
    if (!matchedEntry) {
      const maidenFullName = `${p.firstName} ${p.lastName}`.trim();
      const maidenNormalised = (maidenFullName.toLowerCase().replace(/\s+/g, '') + dobForHash).replace(/[^a-z0-9]/g, '');
      const maidenHash = createHash('sha256').update(maidenNormalised).digest('hex');
      
      const existingMaiden = authData.entries.find(e => e.hash === maidenHash);
      if (existingMaiden) {
        console.log(`  🔄 Updating existing login from maiden name ${maidenFullName} to married name ${fullName}`);
        matchedEntry = {
          ...existingMaiden,
          hash: hash,
          displayName: fullName
        };
      } else {
        const existingByName = authData.entries.find(
          e => String(e.displayName || '').toLowerCase() === fullName.toLowerCase()
        );
        if (existingByName) {
          matchedEntry = {
            ...existingByName,
            hash: hash
          };
        } else {
          matchedEntry = {
            hash,
            role: 'viewer',
            branch: 'main',
            totpRequired: false,
            totpSecret: null,
            displayName: fullName
          };
          console.log(`  🔑 Auto-created 'viewer' login for ${fullName}`);
        }
      }
    }
    
    addAuthEntry(matchedEntry);
  }
});

authData.entries = newAuthEntries;

// Since authData might be updated, we will write it
writeFileSync(authPath, JSON.stringify(authData, null, 2));

// Auto-resolve rootPersonId in metadata if it has changed
if (!addedIds.has(family.meta.rootPersonId)) {
  const oldRootIdParts = family.meta.rootPersonId.split('_');
  const oldRootFirstName = oldRootIdParts[0]?.toLowerCase();
  const oldRootLastName = oldRootIdParts[oldRootIdParts.length - 1]?.toLowerCase();
  
  const match = family.persons.find(p => 
    p.firstName.toLowerCase() === oldRootFirstName && 
    p.lastName.toLowerCase() === oldRootLastName
  );
  if (match) {
    console.log(`  🔄 Updating rootPersonId in metadata from '${family.meta.rootPersonId}' to '${match.id}'`);
    family.meta.rootPersonId = match.id;
  }
}

family.meta.updatedAt = new Date().toISOString().split('T')[0];
writeFileSync(dataPath, JSON.stringify(family, null, 2));
console.log(`\n✅ Done! Synced ${family.persons.length} persons, ${family.relationships.length} relationships.`);
console.log(`Run 'npm run validate' to verify.`);

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
