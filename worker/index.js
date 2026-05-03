/*
 * Family Tree Cloudflare Worker - GitHub API Integration
 *
 * DEPLOY INSTRUCTIONS:
 * 1. Install Wrangler: npm install -g wrangler
 * 2. Login to Cloudflare: wrangler login
 * 3. Deploy worker: wrangler deploy
 * 4. Set GitHub token: wrangler secret put GITHUB_TOKEN
 *    (Generate token at github.com/settings/tokens with repo permissions)
 * 5. Update allowed origin in ALLOWED_ORIGIN below
 * 6. Copy worker URL to config.json workerUrl field
 */

const ALLOWED_ORIGIN = 'https://hiteshssathawane.github.io';
const GITHUB_API = 'https://api.github.com';
const OWNER = 'hiteshssathawane'; // Update with your GitHub username
const REPO = 'family-tree';
const BRANCH = 'main';
const FILE_PATH = 'data/family.json';

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Only allow POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Validate origin
    const origin = request.headers.get('Origin');
    if (origin !== ALLOWED_ORIGIN) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const { type, data } = await request.json();

      switch (type) {
        case 'addMember':
          return await addMemberToFamily(data, env.GITHUB_TOKEN);
        case 'bulkImport':
          return await bulkImportMembers(data, env.GITHUB_TOKEN);
        default:
          return new Response('Invalid request type', { status: 400 });
      }
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        },
      });
    }
  },
};

async function addMemberToFamily(memberData, token) {
  // Get current family.json
  const familyData = await getCurrentFamilyData(token);

  // Generate new person ID
  const existingIds = familyData.persons.map(p => parseInt(p.id.substring(1)));
  const newId = Math.max(...existingIds) + 1;
  const personId = `P${newId.toString().padStart(3, '0')}`;

  // Create new person object
  const newPerson = {
    id: personId,
    firstName: memberData.firstName,
    middleName: '',
    lastName: memberData.lastName,
    maidenName: null,
    gender: memberData.gender,
    status: memberData.status,
    birthDate: parseDateDDMMYYYY(memberData.dob),
    birthPlace: null,
    birthPlaceCoords: null,
    deathDate: null,
    deathPlace: null,
    deathCause: null,
    occupation: '',
    religion: '',
    education: '',
    biography: '',
    profilePhoto: memberData.photoUrl || null,
    tags: [],
    contactInfo: null,
    private: false
  };

  // Add person to family data
  familyData.persons.push(newPerson);

  // Add relationship if specified
  if (memberData.relationshipTo && memberData.relationshipType) {
    const relationshipId = `R${String(familyData.relationships.length + 1).padStart(3, '0')}`;

    let relationship;
    if (memberData.relationshipType === 'parent-child') {
      relationship = {
        id: relationshipId,
        type: 'parent-child',
        parentId: memberData.relationshipTo,
        childId: personId,
        startDate: null,
        endDate: null,
        place: null
      };
    } else if (memberData.relationshipType === 'marriage') {
      relationship = {
        id: relationshipId,
        type: 'marriage',
        person1Id: memberData.relationshipTo,
        person2Id: personId,
        startDate: null,
        endDate: null,
        place: null
      };
    }

    if (relationship) {
      familyData.relationships.push(relationship);
    }
  }

  // Update metadata
  familyData.meta.updatedAt = new Date().toISOString().split('T')[0];

  // Commit to GitHub
  await updateFamilyData(familyData, `Add new member: ${memberData.firstName} ${memberData.lastName}`, token);

  return new Response(JSON.stringify({
    success: true,
    personId: personId
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    },
  });
}

async function bulkImportMembers(csvData, token) {
  const familyData = await getCurrentFamilyData(token);
  const lines = csvData.trim().split('\n');
  const headers = lines[0].split(',');
  const addedMembers = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const memberData = {};

    headers.forEach((header, index) => {
      memberData[header.trim()] = values[index]?.trim();
    });

    if (memberData.firstName && memberData.lastName) {
      const existingIds = familyData.persons.map(p => parseInt(p.id.substring(1)));
      const newId = Math.max(...existingIds) + 1;
      const personId = `P${newId.toString().padStart(3, '0')}`;

      const newPerson = {
        id: personId,
        firstName: memberData.firstName,
        middleName: memberData.middleName || '',
        lastName: memberData.lastName,
        maidenName: memberData.maidenName || null,
        gender: memberData.gender || 'M',
        status: memberData.status || 'living',
        birthDate: memberData.birthDate || null,
        birthPlace: memberData.birthPlace || null,
        birthPlaceCoords: null,
        deathDate: memberData.deathDate || null,
        deathPlace: memberData.deathPlace || null,
        deathCause: null,
        occupation: memberData.occupation || '',
        religion: memberData.religion || '',
        education: memberData.education || '',
        biography: memberData.biography || '',
        profilePhoto: null,
        tags: [],
        contactInfo: null,
        private: false
      };

      familyData.persons.push(newPerson);
      addedMembers.push(`${memberData.firstName} ${memberData.lastName}`);
    }
  }

  familyData.meta.updatedAt = new Date().toISOString().split('T')[0];
  await updateFamilyData(familyData, `Bulk import: ${addedMembers.length} members`, token);

  return new Response(JSON.stringify({
    success: true,
    count: addedMembers.length,
    members: addedMembers
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    },
  });
}

async function getCurrentFamilyData(token) {
  const response = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Family-Tree-Worker',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const fileData = await response.json();
  const content = atob(fileData.content.replace(/\n/g, ''));
  return JSON.parse(content);
}

async function updateFamilyData(familyData, message, token) {
  // Get current file to get SHA
  const fileResponse = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Family-Tree-Worker',
    },
  });

  const fileData = await fileResponse.json();
  const content = btoa(JSON.stringify(familyData, null, 2));

  const updateResponse = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Family-Tree-Worker',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: message,
      content: content,
      sha: fileData.sha,
      branch: BRANCH,
    }),
  });

  if (!updateResponse.ok) {
    throw new Error(`Failed to update GitHub: ${updateResponse.status}`);
  }

  return updateResponse.json();
}

function parseDateDDMMYYYY(dateStr) {
  if (!dateStr || dateStr.length < 8) return null;

  const cleaned = dateStr.replace(/\D/g, '');
  if (cleaned.length === 8) {
    const day = cleaned.substring(0, 2);
    const month = cleaned.substring(2, 4);
    const year = cleaned.substring(4, 8);
    return `${year}-${month}-${day}`;
  }

  return dateStr; // Return as-is if can't parse
}