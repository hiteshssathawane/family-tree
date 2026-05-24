import { readFileSync } from 'fs';
import { resolve } from 'path';

global.window = {};

const helpersCode = readFileSync(resolve('tree-helpers.js'), 'utf8');
eval(helpersCode);

const familyData = JSON.parse(readFileSync(resolve('data/family.json'), 'utf8'));

console.log('--- Printing Layout Tree for Swati ---');

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

let primaryAncestorId = 'SWATI_CHAYA_BHIMRAO_BIRADAR';
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
      return 1950;
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

function printNode(node, depth = 0) {
  const indent = '  '.repeat(depth);
  if (node.type === 'single') {
    console.log(`${indent}- Single: ${node.personId}`);
  } else {
    const h = persons.find(x => x.id === node.husbandId);
    const w = persons.find(x => x.id === node.wifeId);
    console.log(`${indent}- Couple: ${h.firstName} & ${w.firstName} (${node.id})`);
    if (node.inLaws.length) {
      console.log(`${indent}  In-laws:`);
      node.inLaws.forEach(il => {
        printNode(il.node, depth + 2);
      });
    }
    if (node.children.length) {
      console.log(`${indent}  Children:`);
      node.children.forEach(c => {
        printNode(c, depth + 1);
      });
    }
  }
}

rootNodes.forEach((node, idx) => {
  console.log(`Root Node ${idx}:`);
  printNode(node);
});
