#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const familyPath = resolve('data/family.json');
const outputPath = resolve('tree-data.js');

console.log('🌳 Generating tree-data.js with Auto-Layout...');

const family = JSON.parse(readFileSync(familyPath, 'utf8'));
const persons = family.persons;
const relationships = family.relationships;

const rootId = family.meta.rootPersonId || (persons[0] && persons[0].id);
if (!rootId) {
  console.error('No root person found!');
  process.exit(1);
}

const levels = {};
const queue = [{ id: rootId, level: 0 }];
levels[rootId] = 0;

while (queue.length > 0) {
  const { id, level } = queue.shift();

  const spouses = relationships
    .filter(r => r.type === 'marriage' && (r.person1Id === id || r.person2Id === id))
    .map(r => r.person1Id === id ? r.person2Id : r.person1Id);

  const children = relationships
    .filter(r => r.type === 'parent-child' && r.parentId === id)
    .map(r => r.childId);

  const parents = relationships
    .filter(r => r.type === 'parent-child' && r.childId === id)
    .map(r => r.parentId);

  const siblings = [];
  parents.forEach(pId => {
    relationships
      .filter(r => r.type === 'parent-child' && r.parentId === pId && r.childId !== id)
      .forEach(r => {
        if (!siblings.includes(r.childId)) siblings.push(r.childId);
      });
  });

  spouses.forEach(sId => {
    if (levels[sId] === undefined) {
      levels[sId] = level;
      queue.push({ id: sId, level });
    }
  });

  siblings.forEach(sibId => {
    if (levels[sibId] === undefined) {
      levels[sibId] = level;
      queue.push({ id: sibId, level });
    }
  });

  children.forEach(cId => {
    if (levels[cId] === undefined) {
      levels[cId] = level + 1;
      queue.push({ id: cId, level: level + 1 });
    }
  });

  parents.forEach(pId => {
    if (levels[pId] === undefined) {
      levels[pId] = level - 1;
      queue.push({ id: pId, level: level - 1 });
    }
  });
}

persons.forEach(p => {
  if (levels[p.id] === undefined) {
    levels[p.id] = 0;
  }
});

const computedCoords = {};

function getBirthYear(p) {
  if (p.birthDate) {
    const yr = parseInt(p.birthDate.split('-')[0]);
    if (!isNaN(yr)) return yr;
  }
  return 1950;
}

// 1. Identify marriages
const marriages = [];
relationships.forEach(r => {
  if (r.type === 'marriage') {
    const p1 = persons.find(x => x.id === r.person1Id);
    const p2 = persons.find(x => x.id === r.person2Id);
    if (p1 && p2) {
      const husband = p1.gender === 'M' ? p1 : p2;
      const wife = p1.gender === 'F' ? p1 : p2;
      marriages.push({
        id: r.id,
        husbandId: husband.id,
        wifeId: wife.id,
        children: []
      });
    }
  }
});

// 2. Populate children for marriages
persons.forEach(p => {
  const parents = relationships
    .filter(r => r.type === 'parent-child' && r.childId === p.id)
    .map(r => r.parentId);
  if (parents.length > 0) {
    const m = marriages.find(mar => 
      parents.includes(mar.husbandId) || parents.includes(mar.wifeId)
    );
    if (m) {
      m.children.push(p.id);
    }
  }
});

// 3. Build Layout Tree Nodes
const processedMarriages = new Set();
const processedSingles = new Set();

function buildLayoutNode(item, type) {
  if (type === 'couple') {
    const m = item;
    if (processedMarriages.has(m.id)) return null;
    processedMarriages.add(m.id);
    
    const node = {
      type: 'couple',
      id: m.id,
      husbandId: m.husbandId,
      wifeId: m.wifeId,
      children: []
    };
    
    // Sort children by birth date to keep order consistent
    const sortedChildrenIds = [...m.children].sort((a, b) => {
      const pa = persons.find(x => x.id === a);
      const pb = persons.find(x => x.id === b);
      return getBirthYear(pa) - getBirthYear(pb);
    });
    
    // Process children
    sortedChildrenIds.forEach(cId => {
      const childPerson = persons.find(x => x.id === cId);
      if (!childPerson) return;
      
      const childMarriage = marriages.find(mar => mar.husbandId === cId || mar.wifeId === cId);
      if (childMarriage) {
        const childNode = buildLayoutNode(childMarriage, 'couple');
        if (childNode) node.children.push(childNode);
      } else {
        const childNode = buildLayoutNode(childPerson, 'single');
        if (childNode) node.children.push(childNode);
      }
    });
    return node;
  } else {
    const p = item;
    if (processedSingles.has(p.id)) return null;
    processedSingles.add(p.id);
    
    return {
      type: 'single',
      id: p.id,
      personId: p.id,
      children: []
    };
  }
}

// 4. Identify Root nodes
const rootNodes = [];

// First, start with marriages where neither spouse has parents in the database
marriages.forEach(m => {
  const hHasParents = relationships.some(r => r.type === 'parent-child' && r.childId === m.husbandId);
  const wHasParents = relationships.some(r => r.type === 'parent-child' && r.childId === m.wifeId);
  if (!hHasParents && !wHasParents) {
    const node = buildLayoutNode(m, 'couple');
    if (node) rootNodes.push(node);
  }
});

// Then, add remaining single people who have no parents and no marriages
persons.forEach(p => {
  const hasParents = relationships.some(r => r.type === 'parent-child' && r.childId === p.id);
  const isMarried = marriages.some(m => m.husbandId === p.id || m.wifeId === p.id);
  if (!hasParents && !isMarried) {
    const node = buildLayoutNode(p, 'single');
    if (node) rootNodes.push(node);
  }
});

// In case some disconnected component was not covered
marriages.forEach(m => {
  if (!processedMarriages.has(m.id)) {
    const node = buildLayoutNode(m, 'couple');
    if (node) rootNodes.push(node);
  }
});

// 5. Recursively compute widths and relative offsets of subtrees
const coupleWidth = 360;
const singleWidth = 200;
const childGap = 100;

function assignWidths(node) {
  if (!node) return;
  
  if (node.type === 'single') {
    node.width = singleWidth;
    node.relX = 0;
  } else {
    node.children.forEach(c => assignWidths(c));
    
    if (node.children.length === 0) {
      node.width = coupleWidth;
      node.relX = 0;
    } else {
      let totalChildrenWidth = 0;
      node.children.forEach((c, idx) => {
        totalChildrenWidth += c.width;
        if (idx < node.children.length - 1) {
          totalChildrenWidth += childGap;
        }
      });
      
      node.width = Math.max(coupleWidth, totalChildrenWidth);
      
      // Lay out children relative to this node's center
      let curX = -totalChildrenWidth / 2;
      node.children.forEach(c => {
        c.relX = curX + c.width / 2;
        curX += c.width + childGap;
      });
      node.relX = 0;
    }
  }
}

// 6. Recursively assign absolute coordinates
function assignAbsoluteCoords(node, absX) {
  if (!node) return;
  
  if (node.type === 'single') {
    computedCoords[node.personId] = { x: absX };
  } else {
    // Symmetrical positioning of couple members
    const husband = persons.find(x => x.id === node.husbandId);
    const wife = persons.find(x => x.id === node.wifeId);
    
    // Find average parent X coordinate for a person
    function getAverageParentX(person) {
      const pLinks = relationships.filter(r => r.type === 'parent-child' && r.childId === person.id);
      if (!pLinks.length) return null;
      let sum = 0, count = 0;
      pLinks.forEach(link => {
        const parentCoord = computedCoords[link.parentId];
        if (parentCoord && parentCoord.x !== undefined) {
          sum += parentCoord.x;
          count++;
        }
      });
      return count > 0 ? sum / count : null;
    }
    
    const hParentX = getAverageParentX(husband);
    const wParentX = getAverageParentX(wife);
    
    let swap = false; // default: husband on left, wife on right
    
    if (hParentX !== null && wParentX !== null) {
      if (hParentX > wParentX) {
        swap = true;
      }
    } else if (hParentX !== null) {
      // Husband is descendant. Put husband closer to his parents.
      if (hParentX > absX) {
        swap = true; // husband on right
      }
    } else if (wParentX !== null) {
      // Wife is descendant. Put wife closer to her parents.
      if (wParentX < absX) {
        swap = true; // wife on left (husband on right)
      }
    }
    
    const leftId = swap ? wife.id : husband.id;
    const rightId = swap ? husband.id : wife.id;
    
    computedCoords[leftId] = { x: Math.round(absX - 90) };
    computedCoords[rightId] = { x: Math.round(absX + 90) };
    
    node.children.forEach(c => {
      assignAbsoluteCoords(c, absX + c.relX);
    });
  }
}

// Compute widths for all root subtrees
rootNodes.forEach(node => assignWidths(node));

// Position roots side-by-side in the forest
const forestGap = 260;
let totalForestWidth = 0;
rootNodes.forEach((node, idx) => {
  totalForestWidth += node.width;
  if (idx < rootNodes.length - 1) {
    totalForestWidth += forestGap;
  }
});

let startX = -totalForestWidth / 2;
rootNodes.forEach(node => {
  const nodeCenterX = startX + node.width / 2;
  assignAbsoluteCoords(node, nodeCenterX);
  startX += node.width + forestGap;
});

// 7. Assign Y-coordinate based on the generation level
persons.forEach(p => {
  const lvl = levels[p.id] !== undefined ? levels[p.id] : 0;
  if (!computedCoords[p.id]) {
    computedCoords[p.id] = { x: 0 };
  }
  computedCoords[p.id].y = lvl * 420; // 420px vertical level height for spacing
});

const MARATHI_DICTIONARY = {
  // Last Names
  'sathawane': 'साठवणे',
  'waghmare': 'वाघमारे',
  'bhirud': 'भिरूड',
  'bavankar': 'बावनकर',
  'kalembe': 'कळंबे',
  'bisne': 'बिसने',
  'pahune': 'पाहुणे',
  'lanjewar': 'लांजेवार',
  'deshpande': 'देशपांडे',
  'khedkar': 'खेडकर',
  'joshi': 'जोशी',
  'pawar': 'पवार',
  'khonde': 'खोंडे',
  'biradar': 'बिरादार',
  
  // First Names
  'hitesh': 'हितेश',
  'swati': 'स्वाती',
  'shankar': 'शंकर',
  'jyoti': 'ज्योती',
  'saurabhi': 'सौरभी',
  'gaurav': 'गौरव',
  'sudhakar': 'सुधाकर',
  'meenakshi': 'मीनाक्षी',
  'ajay': 'अजय',
  'sangeeta': 'संगीता',
  'ratnakr': 'रत्नाकर',
  'kalpana': 'कल्पना',
  'alka': 'अलका',
  'dhashrath': 'दशरथ',
  'prakash': 'प्रकाश',
  'kalindi': 'कालिंदी',
  'vijay': 'विजय',
  'heera': 'हीरा',
  'shashi': 'शशी',
  'bhavana': 'भावना',
  'shirikanth': 'श्रीकांत',
  'yashmak': 'यश्मक',
  'virika': 'विरिका',
  'daksh': 'दक्ष',
  'aarti': 'आरती',
  'amit': 'अमित',
  'vishal': 'विशाल',
  'shresht': 'श्रेष्ठ',
  'shrimei': 'श्रीमेई',
  'ananya': 'अनन्या',
  'vivan': 'विवान',
  'sumeet': 'सुमीत',
  'susmit': 'सुस्मित',
  'riyan': 'रियान',
  'aishwarya': 'ऐश्वर्या',
  'vedant': 'वेदांत',
  'aryan': 'आरियन',
  'shriya': 'श्रिया',
  'bhimrao': 'भीमराव',
  'chaya': 'छाया',
  'sampathrao': 'संपतराव',
  'vatsala': 'वत्सला',
  'bhaskarrao': 'भास्करराव',
  'manaroma': 'मनोरमा',
  'shaila': 'शैला',
  'mahadeo': 'महादेव',
  'rahul': 'राहुल',
  'shruti': 'श्रुती',
  'mrunal': 'मृणाल',
  'takshita': 'तक्षिता',
  'siddharth': 'सिद्धार्थ',
  'sameer': 'समीर',
  'vatsal': 'वत्सल',
  'shwetal': 'श्वेताळ',
  'shivani': 'शिवानी',
  'trushali': 'तृषाली',
  'maithali': 'मैथिली',
  'mayuri': 'मयुरी'
};

function getMarathiTranslation(word) {
  if (!word) return '';
  const key = word.trim().toLowerCase();
  return MARATHI_DICTIONARY[key] || word;
}

const outputPeople = persons.map(p => {
  const coords = computedCoords[p.id] || { x: 0, y: 0 };
  
  const parents = relationships
    .filter(r => r.type === 'parent-child' && r.childId === p.id)
    .map(r => r.parentId);
    
  const spouseRel = relationships.find(r => 
    r.type === 'marriage' && 
    (r.person1Id === p.id || r.person2Id === p.id)
  );
  const spouseId = spouseRel ? (spouseRel.person1Id === p.id ? spouseRel.person2Id : spouseRel.person1Id) : null;
  const spouse = spouseId ? persons.find(x => x.id === spouseId) : null;

  // 1. Married women name formatting logic
  let displayName = `${p.firstName} ${p.lastName}`;
  let fNameMr = p.firstNameMr || getMarathiTranslation(p.firstName);
  let lNameMr = p.lastNameMr || getMarathiTranslation(p.lastName);
  let displayNameMr = (fNameMr && lNameMr) ? `${fNameMr} ${lNameMr}` : null;
  
  if ((p.gender === 'F' || p.gender === 'f') && spouse) {
    const hLastName = spouse.lastName ? spouse.lastName.trim() : '';
    const wLastName = p.lastName ? p.lastName.trim() : '';
    
    if (hLastName && wLastName && hLastName.toLowerCase() !== wLastName.toLowerCase()) {
      displayName = `${p.firstName} ${hLastName} (${wLastName})`;
    }
    
    const hLastNameMr = spouse.lastNameMr || getMarathiTranslation(spouse.lastName);
    const wLastNameMr = p.lastNameMr || getMarathiTranslation(p.lastName);
    const wFirstNameMr = p.firstNameMr || getMarathiTranslation(p.firstName);
    
    if (wFirstNameMr && wLastNameMr && hLastNameMr && hLastNameMr.toLowerCase() !== wLastNameMr.toLowerCase()) {
      displayNameMr = `${wFirstNameMr} ${hLastNameMr} (${wLastNameMr})`;
    }
  }

  return {
    id: p.id,
    name: displayName,
    nameMr: displayNameMr,
    firstName: p.firstName,
    lastName: p.lastName,
    fatherName: p.fatherName || null,
    motherName: p.motherName || null,
    gender: (p.gender || 'm').toLowerCase(),
    birth: getBirthYear(p),
    death: p.status === 'deceased' && p.deathDate ? parseInt(p.deathDate.split('-')[0]) : null,
    deceased: p.status === 'deceased',
    bio: p.biography || `A valued member of our family.`,
    photo: p.profilePhoto || null,
    x: coords.x,
    y: coords.y,
    parents,
    spouse: spouseId,
    commonName: p.commonName || null,
    commonNameMr: p.commonNameMr || null,
    firstNameMr: fNameMr || null,
    lastNameMr: lNameMr || null
  };
});

const outputScrapbook = {};
persons.forEach(p => {
  const timeline = [];
  if (p.birthDate) {
    const dateStr = p.birthDate;
    timeline.push({
      date: dateStr,
      caption: `${p.firstName} ${p.lastName} was born${p.birthPlace ? ' in ' + p.birthPlace : ''}.`,
      tags: [],
      photos: [null]
    });
  }
  if (p.status === 'deceased' && p.deathDate) {
    const dateStr = p.deathDate;
    timeline.push({
      date: dateStr,
      caption: `${p.firstName} ${p.lastName} passed away${p.deathPlace ? ' in ' + p.deathPlace : ''}.`,
      tags: [],
      photos: [null]
    });
  }
  if (timeline.length > 0) {
    outputScrapbook[p.id] = timeline;
  }
});

const jsContent = `/* ============================================================
   FAMILY TREE DATA (AUTO-GENERATED)
   ----------------------------------------------------------------
   Generated on: ${new Date().toISOString().split('T')[0]}
   ============================================================ */

window.FAMILY_DATA = ${JSON.stringify(family, null, 2)};
`;

writeFileSync(outputPath, jsContent);
console.log('✅ Successfully wrote tree-data.js!');
