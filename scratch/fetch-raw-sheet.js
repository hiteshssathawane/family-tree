import crypto from 'crypto';

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwbPcBgZyC0uFEYazabQoPoYegtpWMZMlE1M76EoqbAxRpG2nO3R6vhlFdak40o54bZ/exec";
const SECRET_TOKEN = "MyFamilyTreeSecureToken2026";

async function run() {
  const timestamp = Math.floor(Date.now() / 1000);
  const token = crypto
    .createHmac('sha256', SECRET_TOKEN)
    .update(timestamp.toString())
    .digest('hex');

  // Try standard fetch first
  const url = `${WEB_APP_URL}?token=${token}&timestamp=${timestamp}`;
  console.log('Fetching:', url);
  const res = await fetch(url);
  const data = await res.json();
  console.log('Keys of the returned data or type:', typeof data, Array.isArray(data) ? `array of length ${data.length}` : data);
  if (Array.isArray(data) && data.length > 0) {
    console.log('First element:', data[0]);
  }
}

run().catch(console.error);
