#!/usr/bin/env node
/**
 * gedcom-export.js — Export family.json to GEDCOM 5.5.5 format
 * Usage: node scripts/gedcom-export.js [output.ged]
 * Compatible with Ancestry, MyHeritage, FamilySearch
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const outFile = process.argv[2] || 'family-export.ged';
const family = JSON.parse(readFileSync(resolve('data/family.json'), 'utf8'));

const lines = [];
const push = (...l) => lines.push(...l);

// Header
push('0 HEAD', '1 SOUR FamilyTree', '2 VERS 1.0', '2 NAME The Family Tree',
  '1 GEDC', '2 VERS 5.5.5', '1 CHAR UTF-8',
  `1 DATE ${new Date().toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}).toUpperCase()}`);

// Individuals
family.persons.forEach(p => {
  push(`0 @${p.id}@ INDI`);
  push(`1 NAME ${p.firstName} /${p.lastName}/`);
  if (p.maidenName) push(`2 SURN ${p.maidenName}`);
  push(`1 SEX ${p.gender === 'F' ? 'F' : p.gender === 'X' ? 'X' : 'M'}`);
  if (p.birthDate) {
    push('1 BIRT');
    push(`2 DATE ${p.birthDate}`);
    if (p.birthPlace) push(`2 PLAC ${p.birthPlace}`);
  }
  if (p.deathDate) {
    push('1 DEAT');
    push(`2 DATE ${p.deathDate}`);
    if (p.deathPlace) push(`2 PLAC ${p.deathPlace}`);
  }
  if (p.occupation) push(`1 OCCU ${p.occupation}`);
  if (p.religion) push(`1 RELI ${p.religion}`);
  if (p.education) push(`1 EDUC ${p.education}`);
  if (p.biography) push(`1 NOTE ${p.biography.replace(/\n/g, '\n2 CONT ')}`);
});

// Families (marriage + parent-child)
const marriages = family.relationships.filter(r => r.type === 'marriage');
marriages.forEach((m, i) => {
  const famId = `F${String(i+1).padStart(3,'0')}`;
  const p1 = family.persons.find(p => p.id === m.person1Id);
  const p2 = family.persons.find(p => p.id === m.person2Id);
  push(`0 @${famId}@ FAM`);
  if (p1) push(`1 HUSB @${m.person1Id}@`);
  if (p2) push(`1 WIFE @${m.person2Id}@`);
  if (m.startDate) { push('1 MARR'); push(`2 DATE ${m.startDate}`); if (m.place) push(`2 PLAC ${m.place}`); }
  // Add children
  const parentIds = [m.person1Id, m.person2Id];
  const children = [...new Set(
    family.relationships
      .filter(r => r.type === 'parent-child' && parentIds.includes(r.parentId))
      .map(r => r.childId)
  )];
  children.forEach(cid => push(`1 CHIL @${cid}@`));
});

push('0 TRLR');

const output = lines.join('\n') + '\n';
writeFileSync(resolve(outFile), output, 'utf8');
console.log(`✅ Exported ${family.persons.length} persons to ${outFile}`);
console.log(`   Compatible with Ancestry, MyHeritage, FamilySearch`);
