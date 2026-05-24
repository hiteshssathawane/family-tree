import crypto from 'crypto';
import 'dotenv/config';

const WEB_APP_URL = process.env.GOOGLE_SHEET_URL || "https://script.google.com/macros/s/AKfycbzW9ryd60ptlFBInt8ErxYx0FsqiZP-LUE_mdGyH1eXIXp6KCiSMTqwZ6ku3LQFEn-5/exec";
const SECRET_TOKEN = process.env.GOOGLE_SHEET_SECRET || "MyFamilyTreeSecureToken2026";

async function run() {
  const timestamp = Math.floor(Date.now() / 1000);
  const token = crypto
    .createHmac('sha256', SECRET_TOKEN)
    .update(timestamp.toString())
    .digest('hex');

  // Discover sheets first
  console.log('Discovering sheets...');
  const listUrl = `${WEB_APP_URL}?token=${token}&timestamp=${timestamp}&action=listSheets`;
  const listRes = await fetch(listUrl);
  const sheets = await listRes.json();
  console.log('Sheets discovered:', sheets);

  for (const sheetName of sheets) {
    console.log(`\nFetching sheet: "${sheetName}"...`);
    const sheetUrl = `${WEB_APP_URL}?token=${token}&timestamp=${timestamp}&sheet=${encodeURIComponent(sheetName)}`;
    const res = await fetch(sheetUrl);
    const data = await res.json();
    console.log(`- Status: ${res.status}`);
    console.log(`- Data array length: ${Array.isArray(data) ? data.length : typeof data}`);
    if (Array.isArray(data) && data.length > 0) {
      console.log(`- Header row:`, data[0]);
      if (data.length > 1) {
        console.log(`- Row 1:`, data[1]);
      }
      if (data.length > 2) {
        console.log(`- Row 2:`, data[2]);
      }
    }
  }
}

run().catch(console.error);
