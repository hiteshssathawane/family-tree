/*
 * Family Tree — photo upload Worker
 *
 * Lets a logged-in family member replace their OWN profile or background photo.
 * The browser crops and re-encodes to WebP; this Worker validates, writes the
 * object to R2, and (only on a person's first upload) commits the resulting URL
 * into data/family.json so the app knows the photo exists.
 *
 * Keys are fixed and overwritten in place — `profile_<personid>.webp` /
 * `background_<personid>.webp`, the same deterministic naming scripts/sync-media.js
 * already uses. That means exactly two objects per person no matter how many times
 * they re-upload, so R2 storage never grows. Freshness comes from Cache-Control
 * rather than from versioned keys.
 *
 * DEPLOY:
 *   1. npm install -g wrangler && wrangler login
 *   2. wrangler deploy                  (uses worker/wrangler.toml)
 *   3. wrangler secret put GITHUB_TOKEN (a fine-grained PAT with Contents: read/write
 *                                        on hiteshssathawane/family-tree only)
 *   4. Put the deployed URL into PHOTO_WORKER_URL in .env, and add it as the
 *      PHOTO_WORKER_URL GitHub Secret so CI builds pick it up too.
 *
 * SECURITY NOTE, stated plainly: data/auth.json is public in the repo, so its
 * identity hashes are readable by anyone who clones it. This Worker can verify that
 * a hash exists and maps to the claimed personId — it cannot prove the caller *is*
 * that person any more strongly than the app already does. The real gate remains the
 * StatiCrypt family password on the page. This is the same trust level as the rest of
 * the app, not a stronger one.
 */

const ALLOWED_ORIGINS = [
  'https://hiteshssathawane.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

const OWNER = 'hiteshssathawane';
const REPO = 'family-tree';
const BRANCH = 'main';
const FAMILY_PATH = 'data/family.json';
const AUTH_PATH = 'data/auth.json';
const GITHUB_API = 'https://api.github.com';

const KIND_FIELD = { profile: 'profilePhoto', background: 'backgroundPhoto' };
// Extensions sync-media.js may have written previously. On a first upload we delete
// these siblings so a person never accumulates more than their two current objects.
const STALE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];

// Cached across invocations on a warm isolate. auth.json changes rarely, and a stale
// read only ever costs a newly-added member one retry.
let authCache = null;
let authCachedAt = 0;
const AUTH_TTL_MS = 5 * 60 * 1000;

// Best-effort rate limit, per isolate. Not a security boundary — it exists to stop a
// stuck client hammering R2. A real limit would need KV or Durable Objects.
const rateBuckets = new Map();

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, cors);
    }
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: 'Forbidden origin' }, 403, cors);
    }

    const path = new URL(request.url).pathname;

    try {
      if (path === '/dob') return await handleDobUpdate(request, env, cors);
      return await handleUpload(request, env, cors);
    } catch (err) {
      // Never leak internals to the browser; the detail goes to `wrangler tail`.
      console.error('photo-upload failed:', err && err.stack ? err.stack : err);
      return json({ error: 'Request failed. Please try again.' }, 500, cors);
    }
  },
};

async function handleUpload(request, env, cors) {
  const personId = (request.headers.get('X-Person-Id') || '').trim();
  const kind = (request.headers.get('X-Photo-Kind') || '').trim();
  const identityHash = (request.headers.get('X-Identity-Hash') || '').trim().toLowerCase();
  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim();

  if (!KIND_FIELD[kind]) {
    return json({ error: 'kind must be "profile" or "background"' }, 400, cors);
  }
  // personId is interpolated into an R2 key, so constrain it hard rather than trusting it.
  if (!/^[A-Za-z0-9_]{1,120}$/.test(personId)) {
    return json({ error: 'Invalid personId' }, 400, cors);
  }
  if (!/^[a-f0-9]{64}$/.test(identityHash)) {
    return json({ error: 'Invalid identity' }, 401, cors);
  }
  if (contentType !== 'image/webp' && contentType !== 'image/jpeg') {
    return json({ error: 'Only WebP or JPEG accepted' }, 415, cors);
  }

  // --- Identity: the hash must exist in auth.json AND belong to the claimed person.
  // This is what enforces "you may only change your own photo".
  const entry = await findAuthEntry(identityHash, env);
  if (!entry) {
    return json({ error: 'Identity not recognised' }, 401, cors);
  }
  if (entry.personId !== personId) {
    return json({ error: 'You can only change your own photo' }, 403, cors);
  }

  if (!allowRequest(personId, env)) {
    return json({ error: 'Too many uploads. Please try again later.' }, 429, cors);
  }

  // --- Size. Content-Length can be absent or lie, so check the buffer too.
  const maxBytes = (Number(env.PHOTO_MAX_UPLOAD_MB) || 5) * 1024 * 1024;
  const declared = Number(request.headers.get('Content-Length'));
  if (declared && declared > maxBytes) {
    return json({ error: `Image is larger than ${maxBytes / 1024 / 1024} MB` }, 413, cors);
  }
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    return json({ error: 'Empty image' }, 400, cors);
  }
  if (body.byteLength > maxBytes) {
    return json({ error: `Image is larger than ${maxBytes / 1024 / 1024} MB` }, 413, cors);
  }
  if (!looksLikeImage(body, contentType)) {
    return json({ error: 'That file is not a valid image' }, 415, cors);
  }

  // --- Write to R2. Fixed key, overwritten in place.
  const ext = contentType === 'image/jpeg' ? 'jpg' : 'webp';
  const key = `${kind}_${personId.toLowerCase()}.${ext}`;
  await env.PHOTOS.put(key, body, {
    httpMetadata: {
      contentType,
      // 60s is what makes a replaced photo show up without minting a new key.
      cacheControl: 'public, max-age=60',
    },
  });

  const publicBase = (env.PHOTO_PUBLIC_URL || '').replace(/\/+$/, '');
  const url = `${publicBase}/${key}`;

  // --- Commit family.json only when the stored value isn't already this URL.
  // 69 of 71 people have profilePhoto: null today, so the first upload needs a commit;
  // every later one is a pure R2 overwrite with no commit and no Pages rebuild.
  let committed = false;
  const field = KIND_FIELD[kind];
  try {
    const { data: family, sha } = await getFamilyData(env.GITHUB_TOKEN);
    const person = family.persons.find(p => p.id === personId);
    if (!person) {
      // The object is already in R2; report it so the client can still show it.
      return json({ url, committed: false, warning: 'Person not found in family.json' }, 200, cors);
    }
    if (person[field] !== url) {
      const previous = person[field];
      person[field] = url;
      family.meta.updatedAt = new Date().toISOString().split('T')[0];
      await putFamilyData(
        family,
        sha,
        `Update ${kind} photo: ${entry.displayName || personId}`,
        env.GITHUB_TOKEN
      );
      committed = true;
      // Drop any sibling this person had under a different extension so the two-objects
      // -per-person guarantee holds. Best effort — a failure here must not fail the upload.
      await deleteStaleSiblings(env.PHOTOS, kind, personId, key, previous);
    }
  } catch (err) {
    // The photo IS in R2. A failed commit only means the app won't pick it up yet,
    // which is worth reporting honestly rather than swallowing.
    console.error('family.json commit failed:', err && err.stack ? err.stack : err);
    return json(
      { url, committed: false, warning: 'Photo saved, but the family record could not be updated. Tell Hitesh.' },
      200,
      cors
    );
  }

  return json({ url, committed }, 200, cors);
}

// --- DOB self-edit ----------------------------------------------------------
//
// Identity here is SHA-256(lowercase(name) + DDMMYYYY) — see index.html's
// nextStep2(). DOB is therefore part of the login credential, so changing it
// must recompute and commit a new auth.json hash in the same operation, or the
// member locks themselves out on their next login.

async function handleDobUpdate(request, env, cors) {
  const personId = (request.headers.get('X-Person-Id') || '').trim();
  const identityHash = (request.headers.get('X-Identity-Hash') || '').trim().toLowerCase();
  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim();

  if (!/^[A-Za-z0-9_]{1,120}$/.test(personId)) {
    return json({ error: 'Invalid personId' }, 400, cors);
  }
  if (!/^[a-f0-9]{64}$/.test(identityHash)) {
    return json({ error: 'Invalid identity' }, 401, cors);
  }
  if (contentType !== 'application/json') {
    return json({ error: 'Expected application/json' }, 415, cors);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'Invalid JSON body' }, 400, cors);
  }
  const birthDate = String((body && body.birthDate) || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) {
    return json({ error: 'birthDate must be YYYY-MM-DD' }, 400, cors);
  }
  const [, yStr, moStr, dStr] = m;
  const year = Number(yStr), month = Number(moStr), day = Number(dStr);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const isRealCalendarDate =
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  const currentYear = new Date().getUTCFullYear();
  // Bounding the year also keeps this endpoint from ever (re)setting the
  // 1674-06-06 "unknown DOB" sentinel — self-service is for real dates only.
  if (!isRealCalendarDate || year < 1900 || year > currentYear || parsed.getTime() > Date.now()) {
    return json({ error: 'Please enter a real date of birth, not in the future' }, 400, cors);
  }

  // --- Identity: the hash must exist in auth.json AND belong to the claimed
  // person — the same "you may only change your own record" rule as photos.
  const entry = await findAuthEntry(identityHash, env);
  if (!entry) {
    return json({ error: 'Identity not recognised' }, 401, cors);
  }
  if (entry.personId !== personId) {
    return json({ error: 'You can only change your own date of birth' }, 403, cors);
  }

  // Its own bucket and a tighter cap than photos — this changes a login credential.
  const dobLimit = Number(env.DOB_RATE_LIMIT_PER_HOUR) || 3;
  if (!allowRequest(`dob:${personId}`, env, dobLimit)) {
    return json({ error: 'Too many changes. Please try again later.' }, 429, cors);
  }

  const nameNormalized = String(entry.displayName || '').toLowerCase().replace(/\s+/g, '');
  const dobNormalized = `${dStr}${moStr}${yStr}`;
  const normalised = (nameNormalized + dobNormalized).replace(/[^a-z0-9]/g, '');
  const newHash = await sha256Hex(normalised);

  // --- Commit family.json (the fact) first, then auth.json (the credential).
  // Each commit can fail independently; report exactly what happened rather
  // than claiming a clean success the data doesn't back up.
  try {
    const { data: family, sha } = await getFamilyData(env.GITHUB_TOKEN);
    const person = family.persons.find(p => p.id === personId);
    if (!person) {
      return json({ error: 'Person not found in family.json' }, 404, cors);
    }
    if (person.birthDate !== birthDate) {
      person.birthDate = birthDate;
      family.meta.updatedAt = new Date().toISOString().split('T')[0];
      await putFamilyData(family, sha, `Update birth date: ${entry.displayName || personId}`, env.GITHUB_TOKEN);
    }
  } catch (err) {
    console.error('family.json commit failed:', err && err.stack ? err.stack : err);
    return json({ error: 'Could not save the birth date. Please try again.' }, 502, cors);
  }

  try {
    const { data: auth, sha } = await getAuthFileData(env.GITHUB_TOKEN);
    const authEntry = (auth.entries || []).find(e => String(e.hash || '').toLowerCase() === identityHash);
    if (!authEntry) {
      return json(
        { birthDate, hash: newHash, warning: 'Birth date saved, but the login could not be updated. Tell Hitesh.' },
        200, cors
      );
    }
    authEntry.hash = newHash;
    await putAuthData(auth, sha, `Update login credentials (DOB change): ${entry.displayName || personId}`, env.GITHUB_TOKEN);
    // The cached auth.json findAuthEntry() reads from is now stale for this entry.
    authCache = null;
  } catch (err) {
    console.error('auth.json commit failed:', err && err.stack ? err.stack : err);
    return json(
      { birthDate, hash: newHash, warning: 'Birth date saved, but the login could not be updated. Tell Hitesh.' },
      200, cors
    );
  }

  return json({ ok: true, birthDate, hash: newHash }, 200, cors);
}

// --- Identity -------------------------------------------------------------

async function findAuthEntry(hash, env) {
  const now = Date.now();
  if (!authCache || now - authCachedAt > AUTH_TTL_MS) {
    const res = await fetch(
      `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${AUTH_PATH}`,
      { headers: { 'User-Agent': 'Family-Tree-Photo-Worker' }, cf: { cacheTtl: 60 } }
    );
    if (!res.ok) throw new Error(`auth.json fetch failed: ${res.status}`);
    const parsed = await res.json();
    authCache = Array.isArray(parsed.entries) ? parsed.entries : [];
    authCachedAt = now;
  }
  return authCache.find(e => String(e.hash || '').toLowerCase() === hash) || null;
}

function allowRequest(key, env, limit) {
  const cap = limit || Number(env.PHOTO_RATE_LIMIT_PER_HOUR) || 10;
  const now = Date.now();
  const hits = (rateBuckets.get(key) || []).filter(t => now - t < 3600_000);
  if (hits.length >= cap) return false;
  hits.push(now);
  rateBuckets.set(key, hits);
  return true;
}

// --- R2 -------------------------------------------------------------------

async function deleteStaleSiblings(bucket, kind, personId, currentKey, previousUrl) {
  const prefix = `${kind}_${personId.toLowerCase()}`;
  const candidates = new Set(STALE_EXTS.map(ext => `${prefix}.${ext}`));
  // Also catch a previous key that didn't follow the pattern (e.g. an older upload).
  if (previousUrl && typeof previousUrl === 'string' && previousUrl.startsWith('http')) {
    const last = previousUrl.split('?')[0].split('/').pop();
    if (last && last.startsWith(prefix)) candidates.add(last);
  }
  candidates.delete(currentKey);
  for (const stale of candidates) {
    try {
      await bucket.delete(stale);
    } catch (err) {
      console.warn(`could not delete stale key ${stale}:`, err && err.message);
    }
  }
}

// --- GitHub ---------------------------------------------------------------

async function getFamilyData(token) {
  const res = await fetch(
    `${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${FAMILY_PATH}?ref=${BRANCH}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Family-Tree-Photo-Worker',
        Accept: 'application/vnd.github+json',
      },
    }
  );
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
  const file = await res.json();
  // family.json holds Marathi names, so decode as UTF-8 rather than via atob().
  const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), c => c.charCodeAt(0));
  return { data: JSON.parse(new TextDecoder().decode(bytes)), sha: file.sha };
}

async function putFamilyData(family, sha, message, token) {
  return putJsonFile(FAMILY_PATH, family, sha, message, token);
}

async function getAuthFileData(token) {
  const res = await fetch(
    `${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${AUTH_PATH}?ref=${BRANCH}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Family-Tree-Photo-Worker',
        Accept: 'application/vnd.github+json',
      },
    }
  );
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
  const file = await res.json();
  const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), c => c.charCodeAt(0));
  return { data: JSON.parse(new TextDecoder().decode(bytes)), sha: file.sha };
}

async function putAuthData(auth, sha, message, token) {
  return putJsonFile(AUTH_PATH, auth, sha, message, token);
}

async function putJsonFile(path, data, sha, message, token) {
  const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

  const res = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Family-Tree-Photo-Worker',
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ message, content: btoa(binary), sha, branch: BRANCH }),
  });
  if (!res.ok) throw new Error(`GitHub write failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// --- Helpers --------------------------------------------------------------

// Must match index.html's client-side sha256() exactly — both hash the same
// normalised name+DOB string to the same login credential.
async function sha256Hex(message) {
  const bytes = new TextEncoder().encode(message);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Magic-number check. The browser sets Content-Type, so this confirms the bytes
// actually match what was claimed instead of taking the header's word for it.
function looksLikeImage(buf, contentType) {
  const b = new Uint8Array(buf);
  if (contentType === 'image/jpeg') {
    return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  }
  // WebP: "RIFF" .... "WEBP"
  return (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  );
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Person-Id, X-Photo-Kind, X-Identity-Hash',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
