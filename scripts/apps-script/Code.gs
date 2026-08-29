/**
 * Code.gs — Google Apps Script Web App, container-bound to the family Google Sheet.
 *
 * THIS FILE IS THE SOURCE OF TRUTH. It is not deployed from here — paste it into the
 * bound Apps Script editor and redeploy. Keeping it in git is deliberate: this code
 * previously lived only inside Google, which is how the date bug below went unnoticed.
 *
 * ── After editing ──────────────────────────────────────────────────────────────
 *   Deploy → Manage deployments → (edit, pencil icon) → Version: New version → Deploy
 *   The /exec URL is preserved, so the GOOGLE_SHEET_URL secret does not change.
 *
 * ── Setup that lives outside this file ─────────────────────────────────────────
 *   Project Settings → Script Properties:
 *     GITHUB_PAT      GitHub fine-grained PAT, contents:write on family-tree
 *     SHEET_SECRET    must equal the GOOGLE_SHEET_SECRET GitHub Actions secret
 *
 *   Triggers (clock icon) → Add Trigger:
 *     triggerGitHubSync · From spreadsheet · On form submit
 *     Must be an INSTALLABLE trigger — a simple onFormSubmit(e) cannot call UrlFetchApp.
 *
 *   NEVER hardcode the PAT or the shared secret in this file. It is committed to a
 *   public repository.
 */

var GITHUB_OWNER = 'hiteshssathawane';
var GITHUB_REPO = 'family-tree';

function props() {
  return PropertiesService.getScriptProperties();
}

// ── 1. DATA FETCHING AND DRIVE DELETION HANDLERS ────────────────────────────────

function doGet(e) {
  var token = e.parameter.token;
  var timestamp = e.parameter.timestamp;
  var action = e.parameter.action;

  var secret = props().getProperty('SHEET_SECRET');
  if (!secret) {
    return json({ error: 'Script property SHEET_SECRET is not set.' });
  }
  if (!verifyToken(token, timestamp, secret)) {
    return json({ error: 'Unauthorized' });
  }

  if (action === 'deleteFile') {
    var fileId = e.parameter.fileId;
    try {
      var file = DriveApp.getFileById(fileId);
      try {
        // Works when we own the file.
        file.setTrashed(true);
      } catch (trashErr) {
        // Form uploads are owned by the submitter, not by us. We cannot trash those,
        // but we can detach them from the upload folder so the folder stays clean.
        var parents = file.getParents();
        while (parents.hasNext()) {
          parents.next().removeFile(file);
        }
      }
      return json({ success: true });
    } catch (err) {
      return json({ success: false, error: err.message });
    }
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (action === 'listSheets') {
    return json(ss.getSheets().map(function (s) { return s.getName(); }));
  }

  var sheetName = e.parameter.sheet || e.parameter.sheetName;
  var sheet = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
  if (!sheet) {
    return json({ error: 'Sheet not found: ' + sheetName });
  }

  // Was: var data = sheet.getDataRange().getValues();
  return json(readSheet(sheet, ss.getSpreadsheetTimeZone()));
}

/**
 * Reads a sheet, rendering date cells in the SPREADSHEET's own timezone.
 *
 * Why this matters: a date-only cell is stored as midnight in the sheet's timezone and
 * comes back from getValues() as a JS Date — an absolute instant. JSON.stringify then
 * serialises it in UTC, so 29-Dec-1985 in IST (UTC+5:30) left here as
 * "1985-12-28T18:30:00.000Z". The Node runner read the UTC half of that and landed a day
 * early on EVERY date. Because the family login hash is SHA-256(name + DDMMYYYY), a
 * one-day drift also minted duplicate, wrong-role logins.
 *
 * Formatting against getSpreadsheetTimeZone() is self-configuring: it stays correct even
 * if the spreadsheet's timezone is ever changed.
 *
 * A cell carrying a real time of day (the form's own Timestamp column) keeps it, so this
 * is not a lossy transform for anything but the intended date-only fields.
 */
function readSheet(sheet, tz) {
  return sheet.getDataRange().getValues().map(function (row) {
    return row.map(function (cell) {
      if (!(cell instanceof Date)) return cell;
      var hms = Utilities.formatDate(cell, tz, 'HH:mm:ss');
      return (hms === '00:00:00')
        ? Utilities.formatDate(cell, tz, 'yyyy-MM-dd')             // date-only cell
        : Utilities.formatDate(cell, tz, "yyyy-MM-dd'T'HH:mm:ss");  // real timestamp
    });
  });
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 2. HMAC SIGNATURE VERIFICATION ──────────────────────────────────────────────

function verifyToken(token, timestamp, secret) {
  var now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) { // 5-minute clock-skew window
    return false;
  }
  var signature = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_256, timestamp, secret
  );
  var computedToken = signature.map(function (byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('');
  return token === computedToken;
}

// ── 3. AUTOMATIC GITHUB REBUILD TRIGGER ─────────────────────────────────────────
// Bound to an installable "on form submit" trigger. Fires repository_dispatch, which
// starts .github/workflows/sync-sheet.yml.

function triggerGitHubSync() {
  var githubToken = props().getProperty('GITHUB_PAT');
  if (!githubToken) {
    throw new Error('Script property GITHUB_PAT is not set — cannot trigger the sync.');
  }

  var url = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/dispatches';

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + githubToken,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Google-Apps-Script'
    },
    payload: JSON.stringify({ event_type: 'sync-sheet' }),
    muteHttpExceptions: true
  });

  // 204 No Content is success for repository_dispatch; anything else is worth seeing.
  Logger.log('dispatch -> HTTP ' + response.getResponseCode() + ' ' + response.getContentText());
}

// ── 4. SETUP VERIFICATION (run manually from the editor) ────────────────────────

/**
 * Run this from the editor (select verifySetup → Run → Execution log) after pasting a
 * new version. It proves, without deploying or touching GitHub, that:
 *   · this script is actually bound to the spreadsheet
 *   · both script properties exist
 *   · date cells now leave here as yyyy-MM-dd in the sheet's timezone
 */
function verifySetup() {
  var ok = true;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    Logger.log('FAIL  Not bound to a spreadsheet. This is a standalone script — open the');
    Logger.log('      Sheet and use Extensions > Apps Script instead.');
    return;
  }
  Logger.log('PASS  Bound to: "' + ss.getName() + '"');
  Logger.log('      Timezone: ' + ss.getSpreadsheetTimeZone());

  ['SHEET_SECRET', 'GITHUB_PAT'].forEach(function (key) {
    if (props().getProperty(key)) {
      Logger.log('PASS  Script property ' + key + ' is set.');
    } else {
      Logger.log('FAIL  Script property ' + key + ' is MISSING.');
      ok = false;
    }
  });

  var sheet = ss.getSheets()[0];
  Logger.log('      First tab: "' + sheet.getName() + '"');

  var out = readSheet(sheet, ss.getSpreadsheetTimeZone());
  if (out.length < 2) {
    Logger.log('WARN  No data rows to sample — sheet has headers only.');
  } else {
    var headers = out[0];
    var row = out[1];
    // A present-but-empty required cell is its own failure mode: the column is fine, the
    // form simply never captured an answer. That is how Gender reached the importer as
    // '' and got defaulted to 'X', which then flipped the spouse's gender.
    ['Birth Date *', 'Marriage Date', 'Gender *', 'Marital Status *', 'Status *']
      .forEach(function (name) {
        var i = headers.indexOf(name);
        if (i === -1) {
          Logger.log('FAIL  Column not found: "' + name + '"');
          ok = false;
        } else if (String(row[i]).trim() === '') {
          Logger.log('WARN  ' + name + ' is EMPTY on the first data row — the form did not capture it.');
        } else {
          Logger.log('PASS  ' + name + ' = ' + JSON.stringify(row[i]));
        }
      });
  }

  Logger.log(ok ? '\nAll checks passed.' : '\nSomething above FAILED — fix before deploying.');
}

// ── 5. ONE-OFF MAINTENANCE HELPERS (run manually from the editor) ───────────────

// Run once to grant the Drive scope the deleteFile branch needs.
function authorizeDrive() {
  DriveApp.getRootFolder();
}

// Scratch helper for debugging Drive permissions on a single file.
function testDeleteManual() {
  var testFileId = 'PASTE_A_FILE_ID_HERE';
  try {
    var file = DriveApp.getFileById(testFileId);
    Logger.log('Found file: ' + file.getName());
    var parents = file.getParents();
    while (parents.hasNext()) {
      var parent = parents.next();
      parent.removeFile(file);
      Logger.log('Removed from parent folder: ' + parent.getName());
    }
  } catch (e) {
    Logger.log('Error encountered: ' + e.message);
  }
}
