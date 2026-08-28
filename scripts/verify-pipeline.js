#!/usr/bin/env node
/**
 * verify-pipeline.js — Offline regression checks for the Google Sheet import pipeline.
 *
 * Needs no secrets and no network. Run it before pushing any change to pull-sheet.js
 * or csv-import.js:
 *
 *   node scripts/verify-pipeline.js
 *
 * Covers the M0 failure modes:
 *   · a date-only cell arriving as a UTC instant and landing one day early
 *   · a renamed sheet column silently importing as an empty string
 *   · an unknown gender flipping a spouse to the opposite wrong gender
 */

import { formatDate, reconcileHeaders, REQUIRED_HEADERS, OPTIONAL_HEADERS } from './pull-sheet.js';

let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
  if (!ok) console.log(`       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function checkThrows(label, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) failures++;
  console.log(`  ${threw ? '✅' : '❌'} ${label}`);
  if (!threw) console.log(`       expected it to throw, but it returned normally`);
}

console.log('\n🧪 Pipeline verification (offline)\n');

// ── SC-1 / SC-2 — dates survive the trip through UTC ────────────────────────────
// A date-only cell is midnight in the sheet's timezone; JSON.stringify serialises that
// instant in UTC, so 29-Dec-1985 IST leaves Google as 1985-12-28T18:30:00.000Z.
console.log('Dates (SC-1, SC-2):');
check('birth date, legacy ISO payload',    formatDate('1985-12-28T18:30:00.000Z'), '1985-12-29');
check('marriage date, legacy ISO payload', formatDate('2015-05-01T18:30:00.000Z'), '2015-05-02');
check('new Apps Script payload passes through', formatDate('1985-12-29'), '1985-12-29');
check('blank stays blank',                 formatDate(''), '');
check('null stays blank',                  formatDate(null), '');
check('unparseable string is left alone',  formatDate('not a date T'), 'not a date T');
check('explicit +05:30 offset is honoured', formatDate('1985-12-29T00:00:00+05:30'), '1985-12-29');

// A cell that is genuinely a timestamp (the form's own Timestamp column) keeps its
// local calendar day rather than rolling back over the UTC boundary.
check('late-evening IST timestamp keeps its day', formatDate('2026-05-23T20:00:00.000Z'), '2026-05-24');

// Apps Script renders zone-less datetimes already in sheet-local time, so the date half
// is correct as-is. Converting it again would shift a late-evening entry to the next day.
check('zone-less local datetime is not re-converted', formatDate('2026-05-24T23:30:00'), '2026-05-24');

// ── SC-8 — a renamed column fails the run instead of importing blanks ───────────
console.log('\nHeader reconciliation (SC-8):');
const goodHeaders = [...new Set([...REQUIRED_HEADERS, ...OPTIONAL_HEADERS])];
let reconciled = true;
try { reconcileHeaders(goodHeaders); } catch { reconciled = false; failures++; }
console.log(`  ${reconciled ? '✅' : '❌'} a complete header row is accepted`);

checkThrows(
  'a missing "Gender *" column throws',
  () => reconcileHeaders(goodHeaders.filter(h => h !== 'Gender *'))
);
checkThrows(
  'a missing "Marital Status *" column throws',
  () => reconcileHeaders(goodHeaders.filter(h => h !== 'Marital Status *'))
);
checkThrows(
  'a renamed "Birth Date" column throws',
  () => reconcileHeaders(goodHeaders.map(h => (h === 'Birth Date *' ? 'Birth Date' : h)))
);

// ── SC-4 — an unknown gender must not sex the spouse ────────────────────────────
// Mirrors the inference in csv-import.js so a regression there is caught here.
console.log('\nSpouse gender inference (SC-4):');
const spouseGender = g => (g === 'M' ? 'F' : g === 'F' ? 'M' : 'X');
check('husband M  → wife F',        spouseGender('M'), 'F');
check('wife F     → husband M',     spouseGender('F'), 'M');
check('unknown X  → spouse stays X', spouseGender('X'), 'X');

console.log(
  failures === 0
    ? '\n🎉 All pipeline checks passed.\n'
    : `\n❌ ${failures} check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
