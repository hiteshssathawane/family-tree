#!/usr/bin/env node
/* ============================================================
   family.json + data/i18n → tree-data.js

   This script is a packager, not a layout engine. tree-data.js carries the raw
   records and the two i18n bundles; every derived thing — generation levels, x/y
   coordinates, married-name formatting, Marathi name translation and the timeline
   entries — is computed in the browser by processRawFamilyData() in tree-helpers.js,
   which is the copy the deployed bundle runs too.

   It used to compute all of that here as well, into `outputPeople` and
   `outputScrapbook` locals that were never read: the emitted file below has only
   ever contained `family` and the i18n bundles. That fork had already drifted
   (it never learned about marriage or child-birth timeline entries, or the
   UNKNOWN_BIRTH_DATE placeholder rule), so it is gone rather than kept in sync.
   ============================================================ */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const familyPath = resolve('data/family.json');
const enI18nPath = resolve('data/i18n/en.json');
const mrI18nPath = resolve('data/i18n/mr.json');
const outputPath = resolve('tree-data.js');

console.log('🌳 Generating tree-data.js...');

const family = JSON.parse(readFileSync(familyPath, 'utf8'));
const i18nEn = JSON.parse(readFileSync(enI18nPath, 'utf8'));
const i18nMr = JSON.parse(readFileSync(mrI18nPath, 'utf8'));

if (!family.meta || !(family.meta.rootPersonId || (family.persons && family.persons[0]))) {
  console.error('No root person found!');
  process.exit(1);
}

const jsContent = `/* ============================================================
   FAMILY TREE DATA (AUTO-GENERATED)
   ----------------------------------------------------------------
   Generated on: ${new Date().toISOString().split('T')[0]}
   ============================================================ */

window.FAMILY_DATA = ${JSON.stringify(family, null, 2)};
window.I18N_DATA = { en: ${JSON.stringify(i18nEn, null, 2)}, mr: ${JSON.stringify(i18nMr, null, 2)} };
`;

writeFileSync(outputPath, jsContent);
console.log('✅ Successfully wrote tree-data.js!');
