import crypto from 'crypto';
import 'dotenv/config';

const WEB_APP_URL = process.env.GOOGLE_SHEET_URL || "https://script.google.com/macros/s/AKfycbzW9ryd60ptlFBInt8ErxYx0FsqiZP-LUE_mdGyH1eXIXp6KCiSMTqwZ6ku3LQFEn-5/exec";
const SECRET_TOKEN = process.env.GOOGLE_SHEET_SECRET || "MyFamilyTreeSecureToken2026";

async function test(params) {
  const timestamp = Math.floor(Date.now() / 1000);
  const token = crypto
    .createHmac('sha256', SECRET_TOKEN)
    .update(timestamp.toString())
    .digest('hex');

  let url = `${WEB_APP_URL}?token=${token}&timestamp=${timestamp}`;
  for (const [k, v] of Object.entries(params)) {
    url += `&${k}=${encodeURIComponent(v)}`;
  }
  
  const res = await fetch(url);
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return { success: true, url, json };
  } catch (e) {
    return { success: false, url, text };
  }
}

async function run() {
  console.log('Testing with sheet=Timeline Scrap Book...');
  console.log(await test({ sheet: 'Timeline Scrap Book' }));

  console.log('Testing with action=listSheets...');
  console.log(await test({ action: 'listSheets' }));
}

run().catch(console.error);
