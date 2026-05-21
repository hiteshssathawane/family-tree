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
    deathDate: row.status === 'living' ? null : formatDate(row.deathDate),
    deathPlace: row.status === 'living' ? null : (row.deathPlace || null),
    occupation: row.occupation || null,
    education: row.education || null,
    location: row.location || null,
    commonName: row.commonName || null,
    commonNameMr: row.commonNameMr || null,
    firstNameMr: row.firstNameMr || null,
    lastNameMr: row.lastNameMr || null,
    biography: row.biography || null,
    profilePhoto: row.profilePhoto || null,
    tags: row.tags ? row.tags.split(';').map(t => t.trim()) : [],
    private: false
  });

  // Login auto-generation moved to the end of the import process after all relationships are processed

  existingIds.add(row.id);
  parsedRows.push(row);
  added++;
  console.log(`  ✅ Added: ${row.firstName} ${row.lastName} (${row.id})`);
});

// Auto-create parents for any person who lists fatherName/motherName but lacks those nodes in the database
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
    
    father = family.persons.find(x => x.id === fatherId);
    if (!father) {
      father = family.persons.find(x => 
        (x.gender === 'M' || x.gender === 'm') && 
        x.firstName.toLowerCase() === fFirst.toLowerCase() && 
        x.lastName.toLowerCase() === fLast.toLowerCase()
      );
    }
    
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
      existingIds.add(fatherId);
      added++;
      console.log(`  ➕ Auto-created father node: ${fFirst} ${fLast} (${fatherId})`);
    }
  }

  let mother = null;
  if (p.motherName) {
    const mFirst = p.motherName.trim();
    const mLast = p.lastName.trim();
    const motherId = `${mFirst}___${mLast}`.toUpperCase().replace(/\s+/g, '');
    
    mother = family.persons.find(x => x.id === motherId);
    if (!mother) {
      mother = family.persons.find(x => 
        (x.gender === 'F' || x.gender === 'f') && 
        x.firstName.toLowerCase() === mFirst.toLowerCase()
      );
    }
    
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
      existingIds.add(motherId);
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
      const relId = `R${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      family.relationships.push({
        id: relId,
        type: 'marriage',
        person1Id: father.id,
        person2Id: mother.id,
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
    
    let spouse = family.persons.find(p => p.id === exactId);
    if (!spouse) {
      const nameNorm = `${sFirst} ${sLast}`.toLowerCase();
      const potential = family.persons.filter(p => 
        `${p.firstName} ${p.lastName}`.toLowerCase() === nameNorm
      );
      if (potential.length === 1) {
        spouse = potential[0];
      }
    }
    
    if (!spouse) {
      const sGender = row.gender === 'M' ? 'F' : 'M';
      spouse = {
        id: exactId,
        firstName: sFirst,
        fatherName: sFather,
        motherName: sMother,
        lastName: sLast,
        maidenName: null,
        gender: sGender,
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
      existingIds.add(exactId);
      added++;
      console.log(`  ➕ Auto-created spouse node: ${sFirst} ${sLast} (${exactId})`);
    }

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
  }
});

// Auto-link parent-child relationships for all persons
console.log('\n🚸 Processing parent-child relationships...');
family.persons.forEach((p) => {
  let father = null;
  if (p.fatherName) {
    father = family.persons.find(f => 
      f.gender === 'M' && 
      f.firstName.toLowerCase() === p.fatherName.toLowerCase() && 
      f.lastName.toLowerCase() === p.lastName.toLowerCase()
    );
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
    const candidates = family.persons.filter(m => 
      m.gender === 'F' && 
      m.firstName.toLowerCase() === p.motherName.toLowerCase()
    );
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
    
    const existing = authData.entries.find(e => e.hash === hash);
    if (!existing) {
      const maidenFullName = `${p.firstName} ${p.lastName}`.trim();
      const maidenNormalised = (maidenFullName.toLowerCase().replace(/\s+/g, '') + dobForHash).replace(/[^a-z0-9]/g, '');
      const maidenHash = createHash('sha256').update(maidenNormalised).digest('hex');
      
      const existingMaiden = authData.entries.find(e => e.hash === maidenHash);
      if (existingMaiden) {
        console.log(`  🔄 Updating existing login from maiden name ${maidenFullName} to married name ${fullName}`);
        existingMaiden.hash = hash;
        existingMaiden.displayName = fullName;
      } else {
        const existingByName = authData.entries.find(e => e.displayName.toLowerCase() === fullName.toLowerCase());
        if (existingByName) {
          existingByName.hash = hash;
        } else {
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
    }
  }
});

// Since authData might be updated, we will write it
writeFileSync(authPath, JSON.stringify(authData, null, 2));

if (added > 0) {
  family.meta.updatedAt = new Date().toISOString().split('T')[0];
  writeFileSync(dataPath, JSON.stringify(family, null, 2));
  console.log(`\n✅ Done! Added ${added} person(s). Skipped ${skipped}.`);
  console.log(`Run 'npm run validate' to verify.`);
} else {
  console.log(`\nℹ️  No new persons to add, but logins updated. Skipped ${skipped} rows.`);
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
