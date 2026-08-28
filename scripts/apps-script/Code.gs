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
 *   · Script property GITHUB_PAT  (Project Settings → Script Properties), repo scope
 *   · Installable trigger: triggerGitHubSync, from spreadsheet, on form submit.
 *     Must be installable — a simple onFormSubmit(e) cannot call UrlFetchApp.
 */

var SHARED_SECRET = 'MyFamilyTreeSecureToken2026'; // must match GOOGLE_SHEET_SECRET
var GITHUB_OWNER = 'hiteshssathawane';
var GITHUB_REPO = 'family-tree';

// ── 1. DATA FETCHING AND DRIVE DELETION HANDLERS ────────────────────────────────

function doGet(e) {
  var token = e.parameter.token;
  var timestamp = e.parameter.timestamp;
  var action = e.parameter.action;

  if (!verifyToken(token, timestamp, SHARED_SECRET)) {
    return json({ error: 'Unauthorized' });
  }

  if (action === 'deleteFile') {
    var fileId = e.parameter.fileId;
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
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

  return json(readSheet(sheet, ss.getSpreadsheetTimeZone()));
}

/**
 * Reads a sheet, rendering date cells in the SPREADSHEET's own timezone.
 *
 * Why this matters: a date-only cell is stored as midnight in the sheet's timezone and
 * comes back from getValues() as a JS Date — an absolute instant. JSON.stringify then
 * serialises it in UTC, so 29-Dec-1985 in IST (UTC+5:30) leaves here as
 * "1985-12-28T18:30:00.000Z". The Node runner used to read the UTC half of that and land
 * a day early on EVERY date. Because the family login hash is
 * SHA-256(name + DDMMYYYY), a one-day drift also minted duplicate, wrong-role logins.
 *
 * Formatting here — against getSpreadsheetTimeZone() — is self-configuring: it stays
 * correct even if the spreadsheet's timezone is ever changed.
 *
 * A cell that carries a real time of day (the form's own Timestamp column) keeps it, so
 * this is not a lossy transform for anything but the intended date-only fields.
 */
function readSheet(sheet, tz) {
  return sheet.getDataRange().getValues().map(function (row) {
    return row.map(function (cell) {
      if (!(cell instanceof Date)) return cell;
      var hms = Utilities.formatDate(cell, tz, 'HH:mm:ss');
      return (hms === '00:00:00')
        ? Utilities.formatDate(cell, tz, 'yyyy-MM-dd')            // date-only cell
        : Utilities.formatDate(cell, tz, "yyyy-MM-dd'T'HH:mm:ss"); // real timestamp
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
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_PAT');
  if (!token) {
    throw new Error('Script property GITHUB_PAT is not set — cannot trigger the sync.');
  }

  var url = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/dispatches';

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    payload: JSON.stringify({ event_type: 'sync-sheet' })
  });
}
