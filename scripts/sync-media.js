#!/usr/bin/env node
/**
 * sync-media.js — Sync media from Google Drive upload URLs to Cloudflare R2
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import 'dotenv/config'; // Loads variables from .env file if it exists

const familyPath = resolve('data/family.json');

// Check Cloudflare R2 environment variables
const requiredEnv = [
  'CF_ACCOUNT_ID',
  'CF_R2_ACCESS_KEY_ID',
  'CF_R2_SECRET_ACCESS_KEY',
  'CF_R2_BUCKET_NAME',
  'CF_R2_PUBLIC_URL'
];

const missingEnv = requiredEnv.filter(key => !process.env[key]);

if (missingEnv.length > 0) {
  console.log('ℹ️  Cloudflare R2 is not fully configured yet.');
  console.log('To automatically migrate Google Drive media to Cloudflare, create a file named `.env` in the root of your project and populate the following keys:');
  console.log('\n----------------------------------------');
  console.log('CF_ACCOUNT_ID=your_cloudflare_account_id');
  console.log('CF_R2_ACCESS_KEY_ID=your_r2_access_key_id');
  console.log('CF_R2_SECRET_ACCESS_KEY=your_r2_secret_access_key');
  console.log('CF_R2_BUCKET_NAME=your_r2_bucket_name');
  console.log('CF_R2_PUBLIC_URL=https://your_public_r2_bucket_url.r2.dev');
  console.log('----------------------------------------\n');
  console.log('Skipping media sync. (Your data is still fully functional, but images will remain stored on Google Drive).');
  process.exit(0);
}

// Initialize S3 Client for Cloudflare R2
const r2 = new S3Client({
  endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CF_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY,
  },
  region: 'auto',
});

const bucketName = process.env.CF_R2_BUCKET_NAME;
const publicBaseUrl = process.env.CF_R2_PUBLIC_URL.replace(/\/$/, '');

// Helper to extract File ID from Google Drive URL
function extractGoogleDriveId(url) {
  if (!url) return null;
  if (!url.includes('drive.google.com') && !url.includes('docs.google.com')) return null;

  // Match /d/FILE_ID/
  const dMatch = url.match(/\/d\/([-\w]{25,})/);
  if (dMatch) return dMatch[1];

  // Match id=FILE_ID
  const idMatch = url.match(/[?&]id=([-\w]{25,})/);
  if (idMatch) return idMatch[1];

  return null;
}

// Helper to download image from Google Drive
async function downloadFromDrive(fileId) {
  const downloadUrl = `https://docs.google.com/uc?export=download&id=${fileId}`;
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`HTTP Error ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';
  
  // Handle Google Drive's security/virus scan confirmation page
  if (contentType.includes('text/html')) {
    const htmlText = await res.text();
    const confirmMatch = htmlText.match(/href="([^"]*confirm=[^"]*)"/);
    if (confirmMatch) {
      let confirmUrl = confirmMatch[1].replace(/&amp;/g, '&');
      if (!confirmUrl.startsWith('http')) {
        confirmUrl = 'https://docs.google.com' + confirmUrl;
      }
      const confirmRes = await fetch(confirmUrl);
      if (confirmRes.ok) {
        const arrayBuffer = await confirmRes.arrayBuffer();
        return {
          buffer: Buffer.from(arrayBuffer),
          mimeType: confirmRes.headers.get('content-type') || 'image/jpeg'
        };
      }
    }
    throw new Error('Google Drive returned HTML (file may be private or requires sign-in)');
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: contentType || 'image/jpeg'
  };
}

// Helper to upload buffer to Cloudflare R2
async function uploadToR2(fileName, buffer, mimeType) {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: buffer,
    ContentType: mimeType,
  });

  await r2.send(command);
  return `${publicBaseUrl}/${fileName}`;
}

async function sync() {
  if (!existsSync(familyPath)) {
    console.error(`❌ family.json not found at ${familyPath}`);
    process.exit(1);
  }

  const family = JSON.parse(readFileSync(familyPath, 'utf8'));
  let updated = false;

  console.log('📸 Scanning family.json for Google Drive media links...');

  for (const person of family.persons) {
    if (person.profilePhoto && person.profilePhoto.includes('drive.google.com')) {
      const fileId = extractGoogleDriveId(person.profilePhoto);
      if (fileId) {
        console.log(`\n⏳ Found Google Drive URL for ${person.firstName} ${person.lastName} (${person.id})`);
        try {
          console.log(`   ⬇️ Downloading image...`);
          const { buffer, mimeType } = await downloadFromDrive(fileId);

          // Get file extension from MIME type
          let ext = 'jpg';
          if (mimeType.includes('png')) ext = 'png';
          else if (mimeType.includes('webp')) ext = 'webp';

          const r2FileName = `profile_${person.id.toLowerCase()}.${ext}`;
          console.log(`   ⬆️ Uploading to Cloudflare R2 as: ${r2FileName}...`);
          const cfUrl = await uploadToR2(r2FileName, buffer, mimeType);

          console.log(`   🚀 Success! Public URL: ${cfUrl}`);
          person.profilePhoto = cfUrl;
          updated = true;
        } catch (err) {
          console.error(`   ❌ Failed to sync media for ${person.firstName}: ${err.message}`);
        }
      }
    }
  }

  if (updated) {
    family.meta.updatedAt = new Date().toISOString().split('T')[0];
    writeFileSync(familyPath, JSON.stringify(family, null, 2), 'utf8');
    console.log('\n💾 Successfully updated family.json with new Cloudflare URLs!');
  } else {
    console.log('\n✨ No pending Google Drive profile photos to migrate.');
  }
}

sync().catch(err => {
  console.error('❌ Sync failed:', err.message);
  process.exit(1);
});
