/**
 * BulkPhotoLinks.gs — writes Drive links for bulk-uploaded photos into the correct
 * Sheet rows, matched by person identity. Container-bound to the family Google Sheet,
 * alongside Code.gs.
 *
 * THIS FILE IS THE SOURCE OF TRUTH. It is not deployed from here — paste it into the
 * bound Apps Script editor as a second file (＋ → Script → name it BulkPhotoLinks) and
 * save. Nothing here is web-facing, so there is no deployment step: you run these
 * functions by hand from the editor.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────
 *   Photos normally reach the Sheet by riding along with a Google Form submission —
 *   Forms drops the upload in Drive and writes the link into the row it just created,
 *   so the row and the link can never disagree. Bulk uploads skip that, which means
 *   something has to match a file back to a row afterwards. That is this script.
 *
 * ── Setup ──────────────────────────────────────────────────────────────────────
 *   Project Settings → Script Properties:
 *     PHOTO_FOLDER_PROFILE      Drive folder ID (or full URL) holding profile photos
 *     PHOTO_FOLDER_BACKGROUND   Drive folder ID (or full URL) holding background photos
 *
 *   Either may be omitted — a missing property just means that kind is not synced,
 *   so you can run the two halves independently.
 *
 *   Then, from the editor's function dropdown:
 *     bplVerifySetup   proves the properties, folders, columns and key derivation work
 *     bplDryRun        full match, writes NOTHING — read the log, then commit
 *     bplRun           the real thing
 *
 * ── The matching key ───────────────────────────────────────────────────────────
 *   The Sheet has no ID column — no email, no roll number. The only stable identity
 *   in this dataset is the one the rest of the pipeline already uses, from
 *   scripts/csv-import.js:263 :
 *
 *       firstName _ motherName _ fatherName _ lastName      (lowercased, spaces removed)
 *
 *   Empty parent segments are KEPT, which is why a member with unknown parents keys as
 *   "shaila___sathawane" — three underscores, not one. That exact string is also how
 *   the local Family/ folders are named, and how R2 objects are keyed
 *   (<profile|background>_<personId lowercased>.webp per data/config.json), so the same
 *   key works end to end.
 *
 *   Surname caveat: a married woman is filed under her husband's surname, by design.
 *   Name her files with the surname as it appears in the SHEET, not her maiden one.
 *
 * ── Filename layouts accepted ──────────────────────────────────────────────────
 *   All three of these resolve, so you can upload whichever way is least work:
 *     1. profile_arjun_swati_hitesh_sathawane.jpg   ← prefix names the kind explicitly
 *     2. arjun_swati_hitesh_sathawane.jpg           ← kind comes from the folder it is in
 *     3. <folder arjun_swati_hitesh_sathawane>/profile.jpg
 *                                                   ← mirrors the local Family/ layout;
 *                                                     drag that tree straight into Drive
 *
 * ── Guarantees ─────────────────────────────────────────────────────────────────
 *   · Idempotent. A row that already has a link is never touched (BPL_OVERWRITE below).
 *     Re-running after a partial run resumes cleanly and costs one read per column.
 *   · Never writes on an ambiguous match — two rows deriving one key are both left alone.
 *   · Every file and every row lands in the "Photo Sync Log" tab with a reason.
 */

// ── Configuration ───────────────────────────────────────────────────────────────

// Leave null to use the first tab, which is where Forms writes. Set a name to override.
var BPL_SHEET_NAME = null;

// The log tab. Recreated automatically if you delete it.
var BPL_LOG_SHEET_NAME = 'Photo Sync Log';

// false  → a row that already has a link is left alone (the safe, idempotent default).
// true   → bulk files win and overwrite existing links.
//
// Keep this false. scripts/csv-import.js has a preservePhoto() guard that deliberately
// keeps an in-app/R2 photo over a Drive URL from the sheet; flipping this to true puts
// the two in a fight the sheet wins, and a photo corrected in the app gets clobbered on
// the next sync.
var BPL_OVERWRITE = false;

// Sheet header → the kind of photo it holds. These names are load-bearing: they must
// match the Form question titles exactly, because scripts/pull-sheet.js reads the same
// two columns by name and hard-fails if they drift.
var BPL_COLUMNS = {
  profile: 'Profile Picture',
  background: 'Background Picture'
};

// Script Property holding each kind's Drive folder.
var BPL_FOLDER_PROPS = {
  profile: 'PHOTO_FOLDER_PROFILE',
  background: 'PHOTO_FOLDER_BACKGROUND'
};

// The four columns whose values compose the identity key, in order.
var BPL_KEY_COLUMNS = [
  'First Name (English) *',
  'Mother Name (English) *',
  'Father Name (English) *',
  'Last Name (English) *'
];

// Guards against a runaway recursion into a folder tree that is not what we think it is.
var BPL_MAX_DEPTH = 3;

// ── Entry points ────────────────────────────────────────────────────────────────

/** Match and report, writing nothing. Run this first, every time. */
function bplDryRun() {
  bplSync_(true);
}

/** Match and write. */
function bplRun() {
  bplSync_(false);
}

// ── Core ────────────────────────────────────────────────────────────────────────

function bplSync_(dryRun) {
  var started = new Date();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Not bound to a spreadsheet. Open the Sheet and use Extensions > Apps Script.');
  }
  var tz = ss.getSpreadsheetTimeZone();
  var runId = Utilities.formatDate(started, tz, 'yyyy-MM-dd HH:mm:ss');
  var log = bplLogger_(ss, tz, runId, dryRun);

  var sheet = BPL_SHEET_NAME ? ss.getSheetByName(BPL_SHEET_NAME) : ss.getSheets()[0];
  if (!sheet) {
    throw new Error('Sheet not found: ' + BPL_SHEET_NAME);
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    log.add('RUN', 'ERROR', '', '', '', '', '', 'Sheet has no data rows.');
    log.flush();
    return;
  }
  var headers = data[0].map(function (h) { return String(h).trim(); });

  var index = bplIndexRows_(data, headers, log);

  var totals = { wrote: 0, skippedFilled: 0, unmatched: 0, ambiguous: 0, errors: 0, scanned: 0 };

  Object.keys(BPL_COLUMNS).forEach(function (kind) {
    bplSyncKind_(kind, sheet, data, headers, index, dryRun, log, totals);
  });

  // Rows that ended the run with nothing in either column — the inverse of the unmatched
  // file list, and the half you actually act on: these are the people still missing a photo.
  Object.keys(index.byKey).forEach(function (key) {
    var rowIdx = index.byKey[key];
    if (rowIdx === null) return; // ambiguous, already logged
    Object.keys(BPL_COLUMNS).forEach(function (kind) {
      var col = headers.indexOf(BPL_COLUMNS[kind]);
      if (col === -1) return;
      if (String(data[rowIdx][col]).trim() === '') {
        log.add('ROW', 'NO_FILE', kind, '', '', key, rowIdx + 1, 'Row has no ' + kind + ' photo in Drive.');
      }
    });
  });

  var verb = dryRun ? 'WOULD WRITE' : 'wrote';
  log.add('RUN', 'SUMMARY', '', '', '', '', '',
    'scanned ' + totals.scanned + ' files · ' + verb + ' ' + totals.wrote +
    ' · skipped(filled) ' + totals.skippedFilled +
    ' · unmatched ' + totals.unmatched +
    ' · ambiguous ' + totals.ambiguous +
    ' · errors ' + totals.errors);
  log.flush();

  Logger.log('Done. ' + (dryRun ? 'DRY RUN — nothing was written. ' : '') +
    'See the "' + BPL_LOG_SHEET_NAME + '" tab for the full breakdown.');
}

/**
 * Builds key → row index. A key claimed by two rows is poisoned to null rather than
 * resolved to the first: writing a face onto the wrong person is far worse than leaving
 * both blank for you to disambiguate by hand.
 */
function bplIndexRows_(data, headers, log) {
  var cols = BPL_KEY_COLUMNS.map(function (name) {
    var i = headers.indexOf(name);
    if (i === -1) {
      throw new Error('Key column not found on the sheet: "' + name +
        '". The sheet actually has: ' + headers.join(' | '));
    }
    return i;
  });

  var byKey = {};
  var byFirst = {};
  var dupes = {};

  for (var r = 1; r < data.length; r++) {
    var parts = cols.map(function (c) { return String(data[r][c] == null ? '' : data[r][c]).trim(); });
    if (parts[0] === '' && parts[3] === '') continue; // blank row
    var key = bplNormalizeKey_(parts.join('_'));

    // First-name index, used only to turn "no match" into "did you mean…". The keys drift
    // for two reasons this script cannot fix on its own: a woman's folder is named with
    // her married surname while the sheet holds her maiden one (deliberate — see
    // csv-import.js:201), and parent names get filled in after the folders were named.
    // Both leave a file stranded, and a suggestion is the difference between a rename you
    // can do in ten seconds and a puzzle.
    var first = bplNormalizeKey_(parts[0]);
    if (first) {
      if (!byFirst[first]) byFirst[first] = [];
      byFirst[first].push({ key: key, row: r + 1 });
    }

    if (byKey.hasOwnProperty(key)) {
      if (!dupes[key]) {
        dupes[key] = [byKey[key] + 1];
        byKey[key] = null;
      }
      dupes[key].push(r + 1);
    } else {
      byKey[key] = r;
    }
  }

  Object.keys(dupes).forEach(function (key) {
    log.add('ROW', 'AMBIGUOUS_ROW', '', '', '', key, dupes[key].join(', '),
      'Rows ' + dupes[key].join(' & ') + ' derive the same identity key — skipped, resolve by hand.');
  });

  return { byKey: byKey, byFirst: byFirst };
}

/** Turns an unmatched key into "did you mean…" by looking up its first-name segment. */
function bplSuggest_(key, index) {
  var first = key.split('_')[0];
  var cands = index.byFirst[first];
  if (!cands || !cands.length) return '';
  return ' Did you mean: ' + cands.map(function (c) {
    return c.key + ' (row ' + c.row + ')';
  }).join(' | ') + ' — rename the file to match.';
}

function bplSyncKind_(kind, sheet, data, headers, index, dryRun, log, totals) {
  var folderId = bplFolderId_(kind);
  if (!folderId) {
    log.add('RUN', 'SKIPPED_KIND', kind, '', '', '', '',
      'Script property ' + BPL_FOLDER_PROPS[kind] + ' is not set — ' + kind + ' not synced.');
    return;
  }

  var header = BPL_COLUMNS[kind];
  var col = headers.indexOf(header);
  if (col === -1) {
    log.add('RUN', 'ERROR', kind, '', '', '', '',
      'Column "' + header + '" not found on the sheet. Nothing written for ' + kind + '.');
    totals.errors++;
    return;
  }

  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (err) {
    log.add('RUN', 'ERROR', kind, '', folderId, '', '',
      'Cannot open Drive folder: ' + err.message);
    totals.errors++;
    return;
  }

  var files = [];
  bplCollectFiles_(folder, kind, 0, files);

  // One key claimed by two files is the same hazard as one key claimed by two rows.
  var seenKey = {};
  var updates = {};   // rowIndex → link
  var wroteAny = false;

  files.forEach(function (entry) {
    totals.scanned++;
    var file = entry.file;
    var name = file.getName();
    var id = file.getId();

    var resolved = bplKeyFromFile_(name, entry.parentName, kind);
    if (!resolved.key) {
      totals.unmatched++;
      log.add('FILE', 'UNMATCHED_FILE', kind, name, id, '', '', resolved.reason);
      return;
    }
    // A profile_*.jpg sitting in the background folder is a misfile, not a match.
    if (resolved.kind && resolved.kind !== kind) {
      totals.unmatched++;
      log.add('FILE', 'WRONG_FOLDER', kind, name, id, resolved.key, '',
        'Filename says "' + resolved.kind + '" but it is in the ' + kind + ' folder — skipped.');
      return;
    }

    var key = resolved.key;

    if (seenKey[key]) {
      totals.unmatched++;
      log.add('FILE', 'DUPLICATE_KEY_FILE', kind, name, id, key, '',
        'Another file already claimed this key this run ("' + seenKey[key] + '") — skipped.');
      return;
    }

    if (!index.byKey.hasOwnProperty(key)) {
      totals.unmatched++;
      log.add('FILE', 'UNMATCHED_FILE', kind, name, id, key, '',
        'No sheet row derives this key.' + bplSuggest_(key, index));
      return;
    }

    var rowIdx = index.byKey[key];
    if (rowIdx === null) {
      totals.ambiguous++;
      log.add('FILE', 'AMBIGUOUS_ROW', kind, name, id, key, '',
        'Two rows share this key — skipped rather than guess.');
      return;
    }

    seenKey[key] = name;

    var existing = String(data[rowIdx][col] == null ? '' : data[rowIdx][col]).trim();
    if (existing !== '' && !BPL_OVERWRITE) {
      totals.skippedFilled++;
      log.add('FILE', 'SKIPPED_FILLED', kind, name, id, key, rowIdx + 1,
        'Row already has a link — left untouched.');
      return;
    }

    var link;
    try {
      link = bplShareableLink_(file);
    } catch (err) {
      totals.errors++;
      log.add('FILE', 'ERROR', kind, name, id, key, rowIdx + 1, 'Sharing/link failed: ' + err.message);
      return;
    }

    if (existing === link) {
      totals.skippedFilled++;
      log.add('FILE', 'ALREADY_CORRECT', kind, name, id, key, rowIdx + 1, 'Link already present and identical.');
      return;
    }

    if (!dryRun) {
      updates[rowIdx] = link;
      wroteAny = true;
    }
    totals.wrote++;
    log.add('FILE', dryRun ? 'WOULD_WRITE' : 'WROTE', kind, name, id, key, rowIdx + 1,
      (existing === '' ? '' : 'OVERWROTE "' + existing + '" → ') + link);
  });

  if (!dryRun && wroteAny) {
    // One read + one write for the whole column. Scattered setValue() calls would be
    // dozens of round trips and would half-apply if the run hit the execution limit.
    var n = data.length - 1;
    var range = sheet.getRange(2, col + 1, n, 1);
    var values = range.getValues();
    Object.keys(updates).forEach(function (rowIdx) {
      values[Number(rowIdx) - 1][0] = updates[rowIdx];
      data[Number(rowIdx)][col] = updates[rowIdx]; // keep the in-memory copy honest
    });
    range.setValues(values);
    SpreadsheetApp.flush();
  }
}

/** Walks the folder, and one or two levels of subfolders, collecting image files. */
function bplCollectFiles_(folder, kind, depth, out) {
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    var mime = f.getMimeType();
    if (mime.indexOf('image/') !== 0) continue;
    out.push({ file: f, parentName: folder.getName() });
  }
  if (depth >= BPL_MAX_DEPTH) return;
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    bplCollectFiles_(subs.next(), kind, depth + 1, out);
  }
}

/**
 * Resolves a file to an identity key, accepting the three layouts documented at the top.
 * Returns { key, kind, reason } — kind is set only when the filename states it.
 */
function bplKeyFromFile_(fileName, parentName, folderKind) {
  var base = String(fileName).toLowerCase().replace(/\.[a-z0-9]+$/, '');
  var kind = null;

  var m = base.match(/^(profile|background)[_-]?(.*)$/);
  if (m) {
    kind = m[1];
    base = m[2];
  }

  // Layout 3: the file is just "profile.jpg" inside a per-person folder.
  if (base === '') {
    var fromParent = bplNormalizeKey_(parentName);
    if (!fromParent) {
      return { key: null, kind: kind, reason: 'Filename carries no identity and the parent folder name is empty.' };
    }
    return { key: fromParent, kind: kind };
  }

  var key = bplNormalizeKey_(base);
  if (!key) {
    return { key: null, kind: kind, reason: 'Filename "' + fileName + '" yields no usable key.' };
  }
  return { key: key, kind: kind };
}

/**
 * The one normalisation both sides go through, mirroring csv-import.js:263 — lowercase,
 * all whitespace removed. Empty segments are preserved, so "shaila___sathawane" survives
 * intact; collapsing the underscores here would silently break every parentless member.
 */
function bplNormalizeKey_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '').trim();
}

/**
 * Ensures link-viewable, then returns the URL in the exact shape the Form itself writes —
 * https://drive.google.com/open?id=FILE_ID. scripts/sync-media.js parses links with
 * /[?&]id=([-\w]{25,})/, so this format is what the rest of the pipeline already reads.
 */
function bplShareableLink_(file) {
  var needsShare = true;
  try {
    needsShare = file.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK;
  } catch (err) {
    // Some shared-drive and org-policy configurations refuse to report access. Try to set
    // it anyway rather than assuming it is already public.
    needsShare = true;
  }
  if (needsShare) {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }
  return 'https://drive.google.com/open?id=' + file.getId();
}

/** Accepts a bare folder ID or any Drive URL containing one. */
function bplFolderId_(kind) {
  var raw = PropertiesService.getScriptProperties().getProperty(BPL_FOLDER_PROPS[kind]);
  if (!raw) return null;
  raw = String(raw).trim();
  var m = raw.match(/\/folders\/([-\w]{15,})/) || raw.match(/[?&]id=([-\w]{15,})/);
  return m ? m[1] : raw;
}

// ── Logging ─────────────────────────────────────────────────────────────────────

/**
 * Buffers rows and appends them in one write at the end. Logging line by line turned a
 * 100-file run into 100 spreadsheet round trips, which is most of the 6-minute quota.
 */
function bplLogger_(ss, tz, runId, dryRun) {
  var buffer = [];
  var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  var mode = dryRun ? 'DRY RUN' : 'LIVE';

  return {
    add: function (scope, status, kind, fileName, fileId, key, row, detail) {
      buffer.push([stamp, runId, mode, scope, status, kind, fileName, fileId, key, row, detail]);
      Logger.log([status, kind, fileName, key, row, detail].filter(String).join(' | '));
    },
    flush: function () {
      var sheet = ss.getSheetByName(BPL_LOG_SHEET_NAME);
      if (!sheet) {
        sheet = ss.insertSheet(BPL_LOG_SHEET_NAME);
        sheet.appendRow(['Timestamp', 'Run', 'Mode', 'Scope', 'Status', 'Kind',
                         'File Name', 'File ID', 'Key', 'Row', 'Detail']);
        sheet.getRange(1, 1, 1, 11).setFontWeight('bold');
        sheet.setFrozenRows(1);
      }
      if (!buffer.length) return;
      sheet.getRange(sheet.getLastRow() + 1, 1, buffer.length, 11).setValues(buffer);
      buffer = [];
    }
  };
}

// ── Setup verification (run manually from the editor) ───────────────────────────

/**
 * Proves, without touching a single cell, that the properties resolve, the folders open,
 * the columns exist, and the key derivation produces something that actually looks like
 * the folder names in Family/. Run this before bplDryRun.
 */
function bplVerifySetup() {
  var ok = true;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    Logger.log('FAIL  Not bound to a spreadsheet.');
    return;
  }
  Logger.log('PASS  Bound to: "' + ss.getName() + '" (tz ' + ss.getSpreadsheetTimeZone() + ')');

  var sheet = BPL_SHEET_NAME ? ss.getSheetByName(BPL_SHEET_NAME) : ss.getSheets()[0];
  Logger.log('      Reading tab: "' + sheet.getName() + '"');

  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function (h) { return String(h).trim(); });

  BPL_KEY_COLUMNS.concat([BPL_COLUMNS.profile, BPL_COLUMNS.background])
    .forEach(function (name) {
      if (headers.indexOf(name) === -1) {
        Logger.log('FAIL  Column not found: "' + name + '"');
        ok = false;
      } else {
        Logger.log('PASS  Column present: "' + name + '"');
      }
    });

  Object.keys(BPL_FOLDER_PROPS).forEach(function (kind) {
    var id = bplFolderId_(kind);
    if (!id) {
      Logger.log('WARN  ' + BPL_FOLDER_PROPS[kind] + ' not set — ' + kind + ' will be skipped.');
      return;
    }
    try {
      var folder = DriveApp.getFolderById(id);
      var n = 0;
      var files = [];
      bplCollectFiles_(folder, kind, 0, files);
      n = files.length;
      Logger.log('PASS  ' + kind + ' folder "' + folder.getName() + '" — ' + n + ' image file(s).');
    } catch (err) {
      Logger.log('FAIL  ' + kind + ' folder unreadable: ' + err.message);
      ok = false;
    }
  });

  if (ok && data.length > 1) {
    Logger.log('\n      Sample keys derived from the first 5 rows — these must match your');
    Logger.log('      Drive filenames / folder names exactly:');
    var cols = BPL_KEY_COLUMNS.map(function (n) { return headers.indexOf(n); });
    for (var r = 1; r < Math.min(6, data.length); r++) {
      var parts = cols.map(function (c) { return String(data[r][c] == null ? '' : data[r][c]).trim(); });
      Logger.log('        row ' + (r + 1) + ' → ' + bplNormalizeKey_(parts.join('_')));
    }
  }

  Logger.log(ok ? '\nAll checks passed. Run bplDryRun next.' : '\nSomething FAILED above — fix before running.');
}
