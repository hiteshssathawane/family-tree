import { readFileSync } from 'fs';
import { resolve } from 'path';

global.window = {};

const helpersCode = readFileSync(resolve('tree-helpers.js'), 'utf8');
eval(helpersCode);

const familyData = JSON.parse(readFileSync(resolve('data/family.json'), 'utf8'));

console.log('--- Tracing Layout Calculations for Swati ---');

const persons = familyData.persons;
const relationships = familyData.relationships;

// Run the layout build steps from tree-helpers.js
const marriages = [];
relationships.forEach(r => {
  if (r.type === 'marriage') {
    const p1 = persons.find(x => x.id === r.person1Id);
    const p2 = persons.find(x => x.id === r.person2Id);
    if (p1 && p2) {
      const husband = p1.gender === 'M' || p1.gender === 'm' ? p1 : p2;
      const wife = p1.gender === 'F' || p1.gender === 'f' ? p1 : p2;
      marriages.push({
        id: r.id,
        husbandId: husband.id,
        wifeId: wife.id,
        children: []
      });
    }
  }
});

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

const initialMe = 'SWATI_CHAYA_BHIMRAO_BIRADAR';
let primaryAncestorId = initialMe;
const maxWalkDepth = 15;
let walkDepth = 0;
while (walkDepth < maxWalkDepth) {
  const pLinks = relationships.filter(r => r.type === 'parent-child' && r.childId === primaryAncestorId);
  if (pLinks.length === 0) break;
  const fatherLink = pLinks.find(link => {
    const parent = persons.find(x => x.id === link.parentId);
    return parent && (parent.gender === 'M' || parent.gender === 'm');
  });
  const nextParentId = fatherLink ? fatherLink.parentId : pLinks[0].parentId;
  primaryAncestorId = nextParentId;
  walkDepth++;
}

let primaryRootMarriage = marriages.find(m => m.husbandId === primaryAncestorId || m.wifeId === primaryAncestorId);
if (!primaryRootMarriage) {
  primaryRootMarriage = marriages[0];
}

const processedMarriages = new Set();
const processedSingles = new Set();
const inLawMarriages = new Set();

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
      children: [],
      inLaws: []
    };

    const rawChildren = [...m.children].map(cId => {
      const childPerson = persons.find(x => x.id === cId);
      const childMarriage = marriages.find(mar => mar.husbandId === cId || mar.wifeId === cId);
      
      let hasInLaws = false;
      let spouseParentsMarriage = null;
      if (childMarriage) {
        const spouseId = childMarriage.husbandId === cId ? childMarriage.wifeId : childMarriage.husbandId;
        const spouseParents = relationships.filter(r => r.type === 'parent-child' && r.childId === spouseId).map(r => r.parentId);
        if (spouseParents.length > 0) {
          spouseParentsMarriage = marriages.find(mar => spouseParents.includes(mar.husbandId) || spouseParents.includes(mar.wifeId));
          if (spouseParentsMarriage) {
            hasInLaws = true;
          }
        }
      }

      return {
        id: cId,
        person: childPerson,
        marriage: childMarriage,
        hasInLaws,
        spouseParentsMarriage
      };
    });

    rawChildren.sort((a, b) => {
      if (a.hasInLaws !== b.hasInLaws) {
        return a.hasInLaws ? 1 : -1;
      }
      return 0;
    });

    rawChildren.forEach(childObj => {
      if (childObj.marriage) {
        const childNode = buildLayoutNode(childObj.marriage, 'couple');
        if (childNode) {
          node.children.push(childNode);
          if (childObj.hasInLaws && childObj.spouseParentsMarriage) {
            inLawMarriages.add(childObj.spouseParentsMarriage.id);
            const inLawNode = buildLayoutNode(childObj.spouseParentsMarriage, 'couple');
            if (inLawNode) {
              childNode.inLaws.push({
                node: inLawNode,
                spouseId: childObj.marriage.husbandId === childObj.id ? childObj.marriage.wifeId : childObj.marriage.husbandId
              });
            }
          }
        }
      } else if (childObj.person) {
        const childNode = buildLayoutNode(childObj.person, 'single');
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

const rootNodes = [];
const mainRootNode = primaryRootMarriage ? buildLayoutNode(primaryRootMarriage, 'couple') : null;
if (mainRootNode) rootNodes.push(mainRootNode);

marriages.forEach(m => {
  if (!processedMarriages.has(m.id) && !inLawMarriages.has(m.id)) {
    const node = buildLayoutNode(m, 'couple');
    if (node) rootNodes.push(node);
  }
});

// Width assignment
const childGap = 100;
const inLawExtraPadding = 560;

function assignWidths(node) {
  if (!node) return;
  if (node.type === 'single') {
    node.width = 200;
  } else {
    let baseWidth = 360; // 2 * 180 (two cards side by side)
    
    // Width of children subtree
    let childrenWidth = 0;
    if (node.children && node.children.length > 0) {
      node.children.forEach((c, idx) => {
        assignWidths(c);
        childrenWidth += c.width;
        if (idx < node.children.length - 1) {
          childrenWidth += childGap;
        }
      });
    }
    
    node.width = Math.max(baseWidth, childrenWidth);
    
    // Add extra padding for in-laws
    if (node.inLaws && node.inLaws.length > 0) {
      node.inLaws.forEach(il => {
        assignWidths(il.node);
        node.width = Math.max(node.width, il.node.width + inLawExtraPadding);
      });
    }
  }
}

rootNodes.forEach(node => assignWidths(node));

// Coordinates tracing
const computedCoords = {};
const levels = {};

function traceAssignCoords(node, absX, lvl, path = '') {
  if (!node) return;
  const currentPath = path ? `${path} -> ${node.id}` : node.id;
  
  if (node.type === 'single') {
    console.log(`[Single] ${node.id} at x = ${absX}, lvl = ${lvl} (Path: ${currentPath})`);
    computedCoords[node.personId] = { x: absX, y: lvl * 420 };
    levels[node.personId] = lvl;
  } else {
    const husband = persons.find(x => x.id === node.husbandId);
    const wife = persons.find(x => x.id === node.wifeId);
    
    // Parent coordinates check
    const hParents = relationships.filter(r => r.type === 'parent-child' && r.childId === husband.id).map(r => r.parentId);
    const wParents = relationships.filter(r => r.type === 'parent-child' && r.childId === wife.id).map(r => r.parentId);
    
    let hParentX = null, wParentX = null;
    if (hParents.length > 0) {
      const hpCoords = hParents.map(id => computedCoords[id]).filter(Boolean);
      if (hpCoords.length > 0) {
        hParentX = hpCoords.reduce((acc, c) => acc + c.x, 0) / hpCoords.length;
      }
    }
    if (wParents.length > 0) {
      const wpCoords = wParents.map(id => computedCoords[id]).filter(Boolean);
      if (wpCoords.length > 0) {
        wParentX = wpCoords.reduce((acc, c) => acc + c.x, 0) / wpCoords.length;
      }
    }
    
    let swap = false;
    if (hParentX !== null && wParentX !== null) {
      if (hParentX > wParentX) swap = true;
    } else if (hParentX !== null) {
      if (hParentX > absX) swap = true;
    } else if (wParentX !== null) {
      if (wParentX < absX) swap = true;
    }
    
    const leftId = swap ? wife.id : husband.id;
    const rightId = swap ? husband.id : wife.id;
    
    const leftName = swap ? wife.firstName : husband.firstName;
    const rightName = swap ? husband.firstName : wife.firstName;
    
    console.log(`[Couple] ${leftName} & ${rightName} (${node.id}) midpoint = ${absX}, lvl = ${lvl}`);
    console.log(`         -> Left (${leftName}): ${absX - 90}`);
    console.log(`         -> Right (${rightName}): ${absX + 90}`);
    
    computedCoords[leftId] = { x: Math.round(absX - 90), y: lvl * 420 };
    computedCoords[rightId] = { x: Math.round(absX + 90), y: lvl * 420 };
    levels[leftId] = lvl;
    levels[rightId] = lvl;
    
    // Position children
    if (node.children && node.children.length > 0) {
      let totalChildrenWidth = 0;
      node.children.forEach((c, idx) => {
        totalChildrenWidth += c.width;
        if (idx < node.children.length - 1) {
          totalChildrenWidth += childGap;
        }
      });
      
      let curX = -totalChildrenWidth / 2;
      node.children.forEach(c => {
        const cRelX = curX + c.width / 2;
        traceAssignCoords(c, absX + cRelX, lvl + 1, currentPath);
        curX += c.width + childGap;
      });
    }
    
    // Position in-laws
    if (node.inLaws && node.inLaws.length > 0) {
      node.inLaws.forEach(il => {
        const spouseCoord = computedCoords[il.spouseId];
        let spouseX = absX;
        if (spouseCoord) {
          const isLeft = (il.spouseId === leftId);
          const shift = Math.round(il.node.width / 2 + 190);
          spouseX = isLeft ? (spouseCoord.x - shift) : (spouseCoord.x + shift);
        }
        console.log(`         -> Positioning In-Law of ${il.spouseId} at spouseX = ${spouseX}`);
        traceAssignCoords(il.node, spouseX, lvl - 1, currentPath + ` (In-Law: ${il.spouseId})`);
      });
    }
  }
}

const forestGap = 260;
let totalForestWidth = 0;
rootNodes.forEach((node, idx) => {
  totalForestWidth += node.width;
  if (idx < rootNodes.length - 1) {
    totalForestWidth += forestGap;
  }
});

console.log(`Total Forest Width: ${totalForestWidth}`);
let startX = -totalForestWidth / 2;
rootNodes.forEach((node, idx) => {
  const nodeCenterX = startX + node.width / 2;
  console.log(`\n--- Root Node ${idx} at centerX = ${nodeCenterX} ---`);
  traceAssignCoords(node, nodeCenterX, 0);
  startX += node.width + forestGap;
});
