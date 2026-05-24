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

  // Let's call deleteFile with an invalid/dummy file ID
  const dummyFileId = "1RKHTxwBzC9-mia-S1LCxXhwM361oyRyn"; // one of the files we synced
  const url = `${WEB_APP_URL}?token=${token}&timestamp=${timestamp}&action=deleteFile&fileId=${dummyFileId}`;

  console.log(`Sending delete request for file ID ${dummyFileId} to Web App...`);
  const res = await fetch(url);
  const result = await res.json();
  console.log('Result:', result);
}

run().catch(console.error);
