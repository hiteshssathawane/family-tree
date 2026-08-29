window.buildFamilyTree = function (people, scrapbook, initialMe) {
  // Build lookup
  const byId = {};
  people.forEach(p => byId[p.id] = p);

  // Derive children arrays (one-way -> two-way)
  people.forEach(p => p.children = []);
  people.forEach(p => {
    (p.parents || []).forEach(pid => {
      if (byId[pid] && !byId[pid].children.includes(p.id)) byId[pid].children.push(p.id);
    });
  });

  function areSiblings(p, q) {
    if (p.id === q.id) return false;
    
    // 1. Check parent links if they exist
    if (p.parents && p.parents.length && q.parents && q.parents.length) {
      const shared = q.parents.filter(x => p.parents.includes(x));
      if (shared.length > 0) return true;
    }
    
    // 2. Check name-based matching
    const pf = (p.fatherName || "").trim().toLowerCase();
    const pm = (p.motherName || "").trim().toLowerCase();
    const pl = (p.lastName || "").trim().toLowerCase();
    
    const qf = (q.fatherName || "").trim().toLowerCase();
    const qm = (q.motherName || "").trim().toLowerCase();
    const ql = (q.lastName || "").trim().toLowerCase();
    
    if (pf && pm && qf && qm) {
      return pf === qf && pm === qm;
    }
    if (pf && qf && !pm && !qm) {
      return pf === qf && pl === ql;
    }
    if (pm && qm && !pf && !qf) {
      return pm === qm && pl === ql;
    }
    return false;
  }

  // Derive siblings
  people.forEach(p => {
    p.siblings = [];
    people.forEach(q => {
      if (areSiblings(p, q)) p.siblings.push(q.id);
    });
  });

  /* ============================================================
     RELATIONSHIP PATH for path-highlight
     ============================================================ */
  function ancestorPath(id, target) {
    if (id === target) return [id];
    const q = [[id, [id]]];
    const seen = new Set([id]);
    while (q.length) {
      const [cur, path] = q.shift();
      const p = byId[cur];
      if (!p) continue;
      for (const par of (p.parents || [])) {
        if (par === target) return [...path, par];
        if (!seen.has(par)) { seen.add(par); q.push([par, [...path, par]]); }
      }
    }
    return null;
  }

  function ancestorsOf(id) {
    const out = [];
    const q = [id];
    const seen = new Set([id]);
    while (q.length) {
      const cur = q.shift();
      const p = byId[cur];
      if (!p) continue;
      for (const par of (p.parents || [])) {
        if (!seen.has(par)) { seen.add(par); q.push(par); out.push(par); }
      }
    }
    return out;
  }

  function distToAncestor(id, ancId) {
    if (id === ancId) return 0;
    const q = [[id, 0]];
    const seen = new Set([id]);
    while (q.length) {
      const [cur, d] = q.shift();
      const p = byId[cur];
      if (!p) continue;
      for (const par of (p.parents || [])) {
        if (par === ancId) return d + 1;
        if (!seen.has(par)) { seen.add(par); q.push([par, d + 1]); }
      }
    }
    return Infinity;
  }

  function labelFor(viewerId, otherId) {
    if (viewerId === otherId) return "You";
    const viewer = byId[viewerId];
    const other  = byId[otherId];
    if (!viewer || !other) return "Family";

    if (viewer.spouse === otherId) {
      return other.gender === "m" ? "Husband" : "Wife";
    }

    if (viewer.spouse) {
      const sp = byId[viewer.spouse];
      if (sp && sp.parents.includes(otherId)) {
        return other.gender === "m" ? "Father-in-Law" : "Mother-in-Law";
      }
      if (sp && sp.siblings.includes(otherId)) {
        return other.gender === "m" ? "Brother-in-Law" : "Sister-in-Law";
      }
    }
    for (const sibId of viewer.siblings) {
      const sib = byId[sibId];
      if (sib && sib.spouse === otherId) {
        return other.gender === "m" ? "Brother-in-Law" : "Sister-in-Law";
      }
    }
    for (const cid of viewer.children) {
      const c = byId[cid];
      if (c && c.spouse === otherId) return other.gender === "m" ? "Son-in-Law" : "Daughter-in-Law";
    }

    const upPath = ancestorPath(viewerId, otherId);
    if (upPath && upPath.length > 1) {
      const dist = upPath.length - 1;
      if (dist === 1) {
        return other.gender === "m" ? "Father" : "Mother";
      }
      if (dist === 2) {
        const sidePar = upPath[1];
        const sideParent = byId[sidePar];
        const isPaternal = sideParent && sideParent.gender === "m";
        if (other.gender === "m") return isPaternal ? "Grandfather (Ajoba)" : "Grandfather (Aajoba)";
        return isPaternal ? "Grandmother (Aaji)" : "Grandmother (Aaji)";
      }
      if (dist === 3) {
        return other.gender === "m" ? "Great-Grandfather" : "Great-Grandmother";
      }
      return "Ancestor";
    }

    const downPath = ancestorPath(otherId, viewerId);
    if (downPath && downPath.length > 1) {
      const dist = downPath.length - 1;
      if (dist === 1) return other.gender === "m" ? "Son" : "Daughter";
      if (dist === 2) return other.gender === "m" ? "Grandson" : "Granddaughter";
      return other.gender === "m" ? "Great-Grandson" : "Great-Granddaughter";
    }

    if (viewer.siblings.includes(otherId)) {
      return other.gender === "m" ? "Brother" : "Sister";
    }

    for (const parId of viewer.parents) {
      const par = byId[parId];
      if (!par) continue;
      if (par.siblings.includes(otherId)) {
        const paternal = par.gender === "m";
        if (other.gender === "m") return paternal ? "Paternal Uncle (Kaka)" : "Maternal Uncle (Mama)";
        return paternal ? "Paternal Aunt (Aatya)" : "Maternal Aunt (Maushi)";
      }
      for (const sibId of par.siblings) {
        const sib = byId[sibId];
        if (sib && sib.spouse === otherId) {
          const paternal = par.gender === "m";
          if (other.gender === "m") return paternal ? "Uncle (Kaka)" : "Uncle (Mama)";
          return paternal ? "Aunt (Kaki)" : "Aunt (Mami)";
        }
      }
    }

    for (const sibId of viewer.siblings) {
      const sib = byId[sibId];
      if (!sib) continue;
      if (sib.children.includes(otherId)) {
        return other.gender === "m" ? "Nephew" : "Niece";
      }
    }

    for (const parId of viewer.parents) {
      const par = byId[parId];
      if (!par) continue;
      for (const sibId of par.siblings) {
        const sib = byId[sibId];
        if (sib && sib.children.includes(otherId)) {
          const paternal = par.gender === "m";
          return paternal ? "Paternal Cousin" : "Maternal Cousin";
        }
      }
    }

    const myAnc = new Set(ancestorsOf(viewerId));
    let common = null, bestDepth = Infinity;
    for (const a of ancestorsOf(otherId)) {
      if (myAnc.has(a)) {
        const d = distToAncestor(viewerId, a) + distToAncestor(otherId, a);
        if (d < bestDepth) { bestDepth = d; common = a; }
      }
    }
    if (common) return "Relative";
    return "Family";
  }

  function pathBetween(aId, bId) {
    if (aId === bId) return [aId];
    const q = [[aId, [aId]]];
    const seen = new Set([aId]);
    while (q.length) {
      const [cur, path] = q.shift();
      const p = byId[cur];
      if (!p) continue;
      const nbrs = new Set();
      (p.parents  || []).forEach(x => nbrs.add(x));
      (p.children || []).forEach(x => nbrs.add(x));
      if (p.spouse) nbrs.add(p.spouse);
      for (const n of nbrs) {
        if (n === bId) return [...path, n];
        if (!seen.has(n)) { seen.add(n); q.push([n, [...path, n]]); }
      }
    }
    return null;
  }

  /* ============================================================
     RELATIONSHIP CALCULATOR — "how are these two related?"
     ============================================================ */

  // Shortest hop chain between two people. Blood edges are queued before the
  // marriage edge so an equal-length path through a sibling wins over one
  // through a spouse, which reads better in the explanation.
  function relationPath(aId, bId) {
    if (aId === bId) return [aId];
    const q = [[aId, [aId]]];
    const seen = new Set([aId]);
    while (q.length) {
      const [cur, path] = q.shift();
      const p = byId[cur];
      if (!p) continue;
      const nbrs = [];
      (p.parents  || []).forEach(x => nbrs.push(x));
      (p.children || []).forEach(x => nbrs.push(x));
      (p.siblings || []).forEach(x => nbrs.push(x));
      if (p.spouse) nbrs.push(p.spouse);
      for (const n of nbrs) {
        if (!byId[n]) continue;
        if (n === bId) return [...path, n];
        if (!seen.has(n)) { seen.add(n); q.push([n, [...path, n]]); }
      }
    }
    return null;
  }

  // Names a single hop, e.g. "mother" for the step from a child to its mother.
  function stepName(fromId, toId) {
    const from = byId[fromId], to = byId[toId];
    if (!from || !to) return "relative";
    if (from.spouse === toId)                   return to.gender === "m" ? "husband" : "wife";
    if ((from.parents  || []).includes(toId))   return to.gender === "m" ? "father"  : "mother";
    if ((from.children || []).includes(toId))   return to.gender === "m" ? "son"     : "daughter";
    if ((from.siblings || []).includes(toId))   return to.gender === "m" ? "brother" : "sister";
    return "relative";
  }

  function ordinal(n) {
    return ["1st", "2nd", "3rd"][n - 1] || (n + "th");
  }

  // Names a blood relationship off the nearest shared ancestor: cousins when
  // both sides descend at least two generations, grand-uncles and grand-nephews
  // when one side is a child of that ancestor. Returns null for the close cases
  // (parent, sibling, uncle, nephew) — labelFor already names those, in Marathi
  // as well, and it names them better.
  function collateralLabel(aId, bId) {
    const other = byId[bId];
    if (!other) return null;

    const mine = new Set(ancestorsOf(aId));
    let best = null, bestSum = Infinity;
    ancestorsOf(bId).forEach(anc => {
      if (!mine.has(anc)) return;
      const du = distToAncestor(aId, anc);
      const dd = distToAncestor(bId, anc);
      if (du + dd < bestSum) { bestSum = du + dd; best = { du, dd }; }
    });
    if (!best) return null;

    const { du, dd } = best;
    if (du === 0 || dd === 0) return null;      // direct ancestor or descendant

    if (du >= 2 && dd >= 2) {
      const degree  = Math.min(du, dd) - 1;
      const removed = Math.abs(du - dd);
      let label = ordinal(degree) + " cousin";
      if (removed === 1) label += " once removed";
      else if (removed === 2) label += " twice removed";
      else if (removed > 2) label += ` ${removed} times removed`;
      return label;
    }

    // One side is a child of the shared ancestor, so this is an uncle/nephew
    // relationship displaced by generations. gap 0 is the plain uncle or
    // nephew that labelFor handles.
    const gap = Math.max(du, dd) - 2;
    if (gap <= 0) return null;
    const greats = gap > 1 ? "Great-".repeat(gap - 1) : "";
    const stem = greats ? "grand-" : "Grand-";
    if (dd === 1) return greats + stem + (other.gender === "m" ? "uncle" : "aunt");
    return greats + stem + (other.gender === "m" ? "nephew" : "niece");
  }

  // How is `bId` related to `aId`? Returns the term, plus the hop chain so the
  // UI can show the working rather than just asserting an answer.
  function relationshipBetween(aId, bId) {
    const a = byId[aId], b = byId[bId];
    if (!a || !b) return null;
    if (aId === bId) {
      return { label: "The same person", chain: [], viaMarriage: false, degrees: 0, connected: true };
    }

    const path = relationPath(aId, bId);
    const chain = [];
    if (path) {
      for (let i = 1; i < path.length; i++) {
        chain.push({ id: path[i], name: byId[path[i]].name, rel: stepName(path[i - 1], path[i]) });
      }
    }
    const viaMarriage = chain.some(s => s.rel === "husband" || s.rel === "wife");

    let label = labelFor(aId, bId);
    if (label === "Family" || label === "Relative") {
      const blood = collateralLabel(aId, bId);
      if (blood) label = blood;
      else if (!path) label = "No known connection";
      else if (viaMarriage) label = "Related by marriage";
    }

    return { label, chain, viaMarriage, degrees: chain.length, connected: !!path };
  }

  function tagMatches(viewerId, tag) {
    const v = byId[viewerId];
    if (!v) return [];
    const out = [];
    const add = id => { if (id && id !== viewerId && !out.includes(id)) out.push(id); };

    switch (tag) {
      case "Parents":
        (v.parents || []).forEach(add);
        break;
      case "Siblings":
        (v.siblings || []).forEach(add);
        break;
      case "Spouse":
        if (v.spouse) add(v.spouse);
        break;
      case "Children":
        (v.children || []).forEach(add);
        break;
      case "Grandparents":
        (v.parents || []).forEach(pid => {
          const p = byId[pid];
          if (p) (p.parents || []).forEach(add);
        });
        break;
      case "Uncles & Aunts":
        (v.parents || []).forEach(pid => {
          const p = byId[pid];
          if (!p) return;
          (p.siblings || []).forEach(sid => {
            add(sid);
            const sib = byId[sid];
            if (sib && sib.spouse) add(sib.spouse);
          });
        });
        break;
      case "Cousins":
        (v.parents || []).forEach(pid => {
          const p = byId[pid];
          if (!p) return;
          (p.siblings || []).forEach(sid => {
            const sib = byId[sid];
            if (!sib) return;
            (sib.children || []).forEach(add);
          });
        });
        break;
      case "Nephews & Nieces":
        (v.siblings || []).forEach(sid => {
          const s = byId[sid];
          if (s) (s.children || []).forEach(add);
        });
        break;
      case "In-Laws":
        if (v.spouse) {
          const sp = byId[v.spouse];
          if (sp) {
            (sp.parents || []).forEach(add);
            (sp.siblings || []).forEach(add);
          }
        }
        (v.siblings || []).forEach(sid => {
          const s = byId[sid];
          if (s && s.spouse) add(s.spouse);
        });
        (v.children || []).forEach(cid => {
          const c = byId[cid];
          if (c && c.spouse) add(c.spouse);
        });
        break;
      case "Grandchildren":
        (v.children || []).forEach(cid => {
          const c = byId[cid];
          if (c) (c.children || []).forEach(add);
        });
        break;
    }
    return out;
  }

  const TAGS = [
    "Parents","Siblings","Spouse","Children","Grandparents",
    "Uncles & Aunts","Cousins","Nephews & Nieces","In-Laws","Grandchildren"
  ];

  return {
    people,
    byId,
    scrapbook,
    labelFor,
    pathBetween,
    relationPath,
    relationshipBetween,
    tagMatches,
    TAGS,
    ME: initialMe
  };
};

/* ============================================================
   DYNAMIC CLIENT-SIDE LAYOUT ENGINE
   ============================================================ */
window.processRawFamilyData = function (rawData, initialMe) {
  const persons = rawData.persons;
  const relationships = rawData.relationships;

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

  // Populate children for marriages
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

  // 2. Resolve root walk from the logged-in candidate
  let primaryAncestorId = initialMe || (persons[0] && persons[0].id);
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

  // 3. Build layout nodes recursively
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

      // Sibling sorting to prevent line crossings:
      // Put siblings whose spouses have in-laws in the tree at the rightmost end.
      rawChildren.sort((a, b) => {
        if (a.hasInLaws !== b.hasInLaws) {
          return a.hasInLaws ? 1 : -1;
        }
        return getBirthYear(a.person) - getBirthYear(b.person);
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

  persons.forEach(p => {
    const hasParents = relationships.some(r => r.type === 'parent-child' && r.childId === p.id);
    const isMarried = marriages.some(m => m.husbandId === p.id || m.wifeId === p.id);
    if (!hasParents && !isMarried && !processedSingles.has(p.id)) {
      const node = buildLayoutNode(p, 'single');
      if (node) rootNodes.push(node);
    }
  });

  // 4. Calculate layout widths
  const coupleWidth = 360;
  const singleWidth = 200;
  const childGap = 100;
  const inLawExtraPadding = 560;
  const verticalLevelHeight = 450;
  const inLawGap = 190;
  const nodeHalfWidth = 85;

  function assignWidths(node) {
    if (!node) return;

    if (node.type === 'single') {
      node.width = singleWidth;
      node.relX = 0;
    } else {
      node.children.forEach(c => assignWidths(c));

      let totalChildrenWidth = 0;
      if (node.children.length > 0) {
        node.children.forEach((c, idx) => {
          totalChildrenWidth += c.width;
          if (idx < node.children.length - 1) {
            totalChildrenWidth += childGap;
          }
        });
      }

      let baseWidth = coupleWidth;
      if (node.inLaws && node.inLaws.length > 0) {
        node.inLaws.forEach(il => {
          assignWidths(il.node);
          baseWidth = Math.max(baseWidth, il.node.width + inLawExtraPadding);
        });
      }

      node.width = Math.max(baseWidth, totalChildrenWidth);

      if (node.children.length > 0) {
        let curX = -totalChildrenWidth / 2;
        node.children.forEach(c => {
          c.relX = curX + c.width / 2;
          curX += c.width + childGap;
        });
      }
      node.relX = 0;
    }
  }

  rootNodes.forEach(node => assignWidths(node));

  // 5. Absolute coordinates assignment
  const computedCoords = {};
  const levels = {};

  // Cache root nodes IDs to order ancestor branches from left to right
  const rootIds = rootNodes.map(rn => rn.id);

  function getRootMarriageId(personId) {
    let currentId = personId;
    const maxWalk = 15;
    let walk = 0;
    while (walk < maxWalk) {
      const pLinks = relationships.filter(r => r.type === 'parent-child' && r.childId === currentId);
      if (pLinks.length === 0) break;
      const fatherLink = pLinks.find(link => {
        const parent = persons.find(x => x.id === link.parentId);
        return parent && (parent.gender === 'M' || parent.gender === 'm');
      });
      currentId = fatherLink ? fatherLink.parentId : pLinks[0].parentId;
      walk++;
    }
    const m = marriages.find(mar => mar.husbandId === currentId || mar.wifeId === currentId);
    return m ? m.id : null;
  }

  // Horizontal space already claimed on each level. In-law branches are parked
  // beside the family they marry into, so without this they get dropped on top
  // of whatever is already there — which is what crossed the maternal lines.
  const levelSpans = {};

  function reserveSpan(lvl, min, max) {
    (levelSpans[lvl] = levelSpans[lvl] || []).push([min, max]);
  }

  // Widest already-claimed span on `fromLvl` or below that overlaps [min,max],
  // or null when the range is clear. An in-law branch descends, so it has to
  // clear every level from its own downwards, not just the one it sits on.
  function findConflict(fromLvl, min, max) {
    let hit = null;
    Object.keys(levelSpans).forEach(key => {
      if (Number(key) < fromLvl) return;
      levelSpans[key].forEach(span => {
        if (min < span[1] && max > span[0]) {
          hit = hit
            ? [Math.min(hit[0], span[0]), Math.max(hit[1], span[1])]
            : [span[0], span[1]];
        }
      });
    });
    return hit;
  }

  // Slide an in-law branch further out along `dir` until its whole footprint
  // clears everything already placed.
  function findFreeCenter(desiredCenter, halfWidth, dir, fromLvl) {
    let center = desiredCenter;
    for (let guard = 0; guard < 200; guard++) {
      const conflict = findConflict(fromLvl, center - halfWidth, center + halfWidth);
      if (!conflict) break;
      center = dir > 0
        ? conflict[1] + halfWidth + inLawGap
        : conflict[0] - halfWidth - inLawGap;
    }
    return center;
  }

  function assignAbsoluteCoords(node, absX, lvl) {
    if (!node) return;

    if (node.type === 'single') {
      computedCoords[node.personId] = { x: absX, y: lvl * verticalLevelHeight };
      levels[node.personId] = lvl;
      reserveSpan(lvl, absX - nodeHalfWidth, absX + nodeHalfWidth);
    } else {
      const husband = persons.find(x => x.id === node.husbandId);
      const wife = persons.find(x => x.id === node.wifeId);

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

      let swap = false;

      // 1. Compare top-level root marriage indices to align descendants with their parent branches
      const hRootId = getRootMarriageId(husband.id);
      const wRootId = getRootMarriageId(wife.id);
      const hRootIdx = hRootId ? rootIds.indexOf(hRootId) : -1;
      const wRootIdx = wRootId ? rootIds.indexOf(wRootId) : -1;

      if (hRootIdx !== -1 && wRootIdx !== -1 && hRootIdx !== wRootIdx) {
        // If husband's root branch is placed to the right of wife's root branch, swap them
        swap = hRootIdx > wRootIdx;
      } else if (hParentX !== null && wParentX !== null) {
        // 2. Default fallback: Compare direct parent coordinates if both are on canvas
        if (hParentX > wParentX) {
          swap = true;
        }
      } else if (hParentX !== null) {
        // 3. Only the husband's branch is on canvas. The wife is an in-law
        //    whose own branch has not been placed yet, so it will be parked on
        //    her side of the couple. Put her on the outward side — away from
        //    the husband's parents — so her branch lands in open space instead
        //    of being driven back through his family.
        swap = hParentX > absX;
      } else if (wParentX !== null) {
        // 4. Mirror of 3, with the husband as the in-law.
        swap = wParentX < absX;
      }

      const leftId = swap ? wife.id : husband.id;
      const rightId = swap ? husband.id : wife.id;

      computedCoords[leftId] = { x: Math.round(absX - 90), y: lvl * verticalLevelHeight };
      computedCoords[rightId] = { x: Math.round(absX + 90), y: lvl * verticalLevelHeight };
      levels[leftId] = lvl;
      levels[rightId] = lvl;
      reserveSpan(lvl, absX - 90 - nodeHalfWidth, absX + 90 + nodeHalfWidth);

      node.children.forEach(c => {
        assignAbsoluteCoords(c, absX + c.relX, lvl + 1);
      });

      if (node.inLaws && node.inLaws.length > 0) {
        node.inLaws.forEach(il => {
          const spouseCoord = computedCoords[il.spouseId];
          let spouseX = absX;
          if (spouseCoord) {
            const dir = (il.spouseId === leftId) ? -1 : 1;
            const halfWidth = il.node.width / 2;
            const desired = spouseCoord.x + dir * (halfWidth + inLawGap);
            spouseX = Math.round(findFreeCenter(desired, halfWidth, dir, lvl - 1));
            reserveSpan(lvl - 1, spouseX - halfWidth, spouseX + halfWidth);
          }
          assignAbsoluteCoords(il.node, spouseX, lvl - 1);
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

  let startX = -totalForestWidth / 2;
  rootNodes.forEach(node => {
    const nodeCenterX = startX + node.width / 2;
    assignAbsoluteCoords(node, nodeCenterX, 0);
    startX += node.width + forestGap;
  });

  persons.forEach(p => {
    if (!computedCoords[p.id]) {
      computedCoords[p.id] = { x: 0, y: 0 };
    }
  });

  // 6. Map people properties with naming conventions
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
      // getBirthYear() falls back to 1950 so the layout always has a year to
      // sort on. Only 12 of 71 members have a real DOB, so the profile panel
      // needs to know which years are real before it prints one.
      hasBirthYear: !!p.birthDate,
      death: p.status === 'deceased' && p.deathDate ? parseInt(p.deathDate.split('-')[0]) : null,
      deceased: p.status === 'deceased',
      bio: p.biography || `A valued member of our family.`,
      photo: p.profilePhoto || null,
      backgroundPhoto: p.backgroundPhoto || null,
      // Raw record fields the Bio tab renders. Kept null when absent so the
      // panel can skip the row rather than print an empty label.
      birthDate: p.birthDate || null,
      birthPlace: p.birthPlace || null,
      deathDate: p.deathDate || null,
      deathPlace: p.deathPlace || null,
      occupation: p.occupation || null,
      education: p.education || null,
      religion: p.religion || null,
      location: p.location || null,
      maritalStatus: p.maritalStatus || null,
      maidenName: p.maidenName || null,
      biography: p.biography || null,
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
      timeline.push({
        date: p.birthDate,
        caption: `${p.firstName} ${p.lastName} was born${p.birthPlace ? ' in ' + p.birthPlace : ''}.`,
        tags: [],
        photos: [null]
      });
    }

    // Merge custom scrapbook entries
    const customEntries = rawData.scrapbook && rawData.scrapbook[p.id] ? rawData.scrapbook[p.id] : [];
    customEntries.forEach(e => {
      timeline.push({
        date: e.date,
        caption: e.caption,
        photos: e.photos || [null],
        tags: e.tags || []
      });
    });

    if (p.status === 'deceased' && p.deathDate) {
      timeline.push({
        date: p.deathDate,
        caption: `${p.firstName} ${p.lastName} passed away${p.deathPlace ? ' in ' + p.deathPlace : ''}.`,
        tags: [],
        photos: [null]
      });
    }

    if (timeline.length > 0) {
      // Sort chronologically. Two things the old year-only key got wrong:
      //   - an undated entry ("Unknown Date") scored year 0 and sorted *above* the
      //     person's own birth; it has no place in the story, so it goes last.
      //   - two entries in the same year kept insertion order, so a January memory
      //     landed after a November birth. Compare the full date when we have one.
      // A bare year ("1995") sorts to the start of its year, ahead of dated entries.
      const sortKey = (d) => {
        if (!d) return Infinity;
        const s = String(d).trim();
        const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]);
        const year = s.match(/\b\d{4}\b/);
        return year ? Number(year[0]) * 10000 : Infinity;
      };
      timeline.sort((a, b) => sortKey(a.date) - sortKey(b.date));

      outputScrapbook[p.id] = timeline;
    }
  });

  return window.buildFamilyTree(outputPeople, outputScrapbook, initialMe);
};

