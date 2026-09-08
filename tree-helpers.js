// A member with no known date of birth still needs a login, because identity is
// SHA-256(name + DDMMYYYY). csv-import.js writes this placeholder so a hash can exist
// at all. It is a login token, NOT a fact about the person — nothing may render it as a
// birth date, raise it as a birthday or a remembrance, or export it to a calendar.
//
// It is not confined to birthDate either: the value reached the Sheet as a typed answer
// and came back in Death Date too, which is how "d. 1674" appeared under a name. So the
// test is on the value, wherever it turns up — hence isPlaceholderDate, with the old
// birth-specific name kept as an alias for callers that already use it.
window.UNKNOWN_BIRTH_DATE = '1674-06-06';
window.isPlaceholderDate = function (d) {
  return !!d && String(d).slice(0, 10) === window.UNKNOWN_BIRTH_DATE;
};
window.isUnknownBirthDate = window.isPlaceholderDate;
const isUnknownBirthDate = window.isPlaceholderDate;
const isPlaceholderDate = window.isPlaceholderDate;

// Strips the placeholder to null so no consumer has to remember to check. Every date
// entering the view model goes through this.
const realDate = (d) => (d && !isPlaceholderDate(d) ? d : null);

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

  // Translation shim. index.html's i18n core defines window.t before this file's
  // functions are ever called, but the raw-data path can be exercised without it
  // (scripts, tests), so fall back to the English literal when it is absent.
  function tr(key, fallback) {
    return (typeof window !== "undefined" && typeof window.t === "function")
      ? window.t(key, fallback)
      : fallback;
  }

  // Names `other` as seen from `viewer`, as { key, en } so the caller translates at
  // the point of display. The two non-answers ("Family", "Relative") come back
  // marked `weak`: relationshipBetween treats those as a miss and hands the pair on
  // to the collateral resolver rather than showing them.
  //
  // Several branches split finer than the English they produce, because Marathi
  // keeps distinctions English collapses — a brother's son is पुतण्या where a
  // sister's son is भाचा, and each of the four parent-sibling lines has its own
  // cousin term. The English string stays one word; only the key forks.
  function labelPair(viewerId, otherId) {
    if (viewerId === otherId) return { key: "relations.self.you", en: "You" };
    const viewer = byId[viewerId];
    const other  = byId[otherId];
    if (!viewer || !other) return { key: "relations.fallbacks.family", en: "Family", weak: true };

    if (viewer.spouse === otherId) {
      return other.gender === "m"
        ? { key: "relations.spouse.husband", en: "Husband" }
        : { key: "relations.spouse.wife",    en: "Wife" };
    }

    if (viewer.spouse) {
      const sp = byId[viewer.spouse];
      if (sp && sp.parents.includes(otherId)) {
        return other.gender === "m"
          ? { key: "relations.inLaws.fatherInLaw", en: "Father-in-Law" }
          : { key: "relations.inLaws.motherInLaw", en: "Mother-in-Law" };
      }
      // दीर / नणंद through a husband, मेहुणा / मेहुणी through a wife.
      if (sp && sp.siblings.includes(otherId)) {
        const viaHusband = sp.gender === "m";
        if (other.gender === "m") {
          return viaHusband
            ? { key: "relations.inLaws.husbandsBrother", en: "Brother-in-Law" }
            : { key: "relations.inLaws.wifesBrother",    en: "Brother-in-Law" };
        }
        return viaHusband
          ? { key: "relations.inLaws.husbandsSister", en: "Sister-in-Law" }
          : { key: "relations.inLaws.wifesSister",    en: "Sister-in-Law" };
      }
    }
    // A sibling's spouse: भावोजी for a sister's husband, वहिनी for a brother's wife,
    // so the discriminator is the blood sibling's gender. Where the data does not
    // carry it, the spouse's own gender implies it.
    for (const sibId of viewer.siblings) {
      const sib = byId[sibId];
      if (!sib || sib.spouse !== otherId) continue;
      const sibIsBrother = sib.gender ? sib.gender === "m" : other.gender !== "m";
      return sibIsBrother
        ? { key: "relations.inLaws.brothersWife",   en: "Sister-in-Law" }
        : { key: "relations.inLaws.sistersHusband", en: "Brother-in-Law" };
    }
    for (const cid of viewer.children) {
      const c = byId[cid];
      if (c && c.spouse === otherId) {
        return other.gender === "m"
          ? { key: "relations.inLaws.sonInLaw",      en: "Son-in-Law" }
          : { key: "relations.inLaws.daughterInLaw", en: "Daughter-in-Law" };
      }
    }

    const upPath = ancestorPath(viewerId, otherId);
    if (upPath && upPath.length > 1) {
      const dist = upPath.length - 1;
      if (dist === 1) {
        return other.gender === "m"
          ? { key: "relations.ancestors.father", en: "Father" }
          : { key: "relations.ancestors.mother", en: "Mother" };
      }
      if (dist === 2) {
        const sideParent = byId[upPath[1]];
        const paternal = !!(sideParent && sideParent.gender === "m");
        if (other.gender === "m") {
          return paternal
            ? { key: "relations.ancestors.grandfatherPaternal", en: "Grandfather (Ajoba)" }
            : { key: "relations.ancestors.grandfatherMaternal", en: "Grandfather (Ajoba)" };
        }
        return paternal
          ? { key: "relations.ancestors.grandmotherPaternal", en: "Grandmother (Aaji)" }
          : { key: "relations.ancestors.grandmotherMaternal", en: "Grandmother (Aaji)" };
      }
      if (dist === 3) {
        return other.gender === "m"
          ? { key: "relations.ancestors.greatGrandfather", en: "Great-Grandfather" }
          : { key: "relations.ancestors.greatGrandmother", en: "Great-Grandmother" };
      }
      return { key: "relations.ancestors.ancestor", en: "Ancestor" };
    }

    const downPath = ancestorPath(otherId, viewerId);
    if (downPath && downPath.length > 1) {
      const dist = downPath.length - 1;
      if (dist === 1) {
        return other.gender === "m"
          ? { key: "relations.descendants.son",      en: "Son" }
          : { key: "relations.descendants.daughter", en: "Daughter" };
      }
      if (dist === 2) {
        return other.gender === "m"
          ? { key: "relations.descendants.grandson",      en: "Grandson" }
          : { key: "relations.descendants.granddaughter", en: "Granddaughter" };
      }
      return other.gender === "m"
        ? { key: "relations.descendants.greatGrandson",      en: "Great-Grandson" }
        : { key: "relations.descendants.greatGranddaughter", en: "Great-Granddaughter" };
    }

    if (viewer.siblings.includes(otherId)) {
      return other.gender === "m"
        ? { key: "relations.siblings.brother", en: "Brother" }
        : { key: "relations.siblings.sister",  en: "Sister" };
    }

    for (const parId of viewer.parents) {
      const par = byId[parId];
      if (!par) continue;
      const paternal = par.gender === "m";
      if (par.siblings.includes(otherId)) {
        if (other.gender === "m") {
          return paternal
            ? { key: "relations.unclesAunts.fathersBrother", en: "Paternal Uncle (Kaka)" }
            : { key: "relations.unclesAunts.mothersBrother", en: "Maternal Uncle (Mama)" };
        }
        return paternal
          ? { key: "relations.unclesAunts.fathersSister", en: "Paternal Aunt (Aatya)" }
          : { key: "relations.unclesAunts.mothersSister", en: "Maternal Aunt (Maushi)" };
      }
      // Married into that generation. The term turns on the *blood* sibling's
      // gender, not the in-law's: father's brother's wife is काकू, father's
      // sister's husband is a different word again.
      for (const sibId of par.siblings) {
        const sib = byId[sibId];
        if (!sib || sib.spouse !== otherId) continue;
        const sibIsBrother = sib.gender ? sib.gender === "m" : other.gender !== "m";
        if (paternal) {
          return sibIsBrother
            ? { key: "relations.unclesAunts.fathersBrotherWife",   en: "Aunt (Kaki)" }
            : { key: "relations.unclesAunts.fathersSisterHusband", en: "Uncle (Kaka)" };
        }
        return sibIsBrother
          ? { key: "relations.unclesAunts.mothersBrotherWife",   en: "Aunt (Mami)" }
          : { key: "relations.unclesAunts.mothersSisterHusband", en: "Uncle (Mama)" };
      }
    }

    // A sibling's child: पुतण्या / पुतणी from a brother, भाचा / भाची from a sister.
    for (const sibId of viewer.siblings) {
      const sib = byId[sibId];
      if (!sib || !sib.children.includes(otherId)) continue;
      const fromBrother = sib.gender === "m";
      if (other.gender === "m") {
        return fromBrother
          ? { key: "relations.siblings.nephewFromBrother", en: "Nephew" }
          : { key: "relations.siblings.nephewFromSister",  en: "Nephew" };
      }
      return fromBrother
        ? { key: "relations.siblings.nieceFromBrother", en: "Niece" }
        : { key: "relations.siblings.nieceFromSister",  en: "Niece" };
    }

    // A parent's sibling's child. All four lines are one word in English but four
    // in Marathi (चुलत / आत्ये / मामे / मावस), so both the parent's gender and the
    // linking sibling's gender select the key.
    for (const parId of viewer.parents) {
      const par = byId[parId];
      if (!par) continue;
      const paternal = par.gender === "m";
      for (const sibId of par.siblings) {
        const sib = byId[sibId];
        if (!sib || !sib.children.includes(otherId)) continue;
        const line = paternal
          ? (sib.gender === "m" ? "fathersBrother" : "fathersSister")
          : (sib.gender === "m" ? "mothersBrother" : "mothersSister");
        return {
          key: "relations.cousins." + line + (other.gender === "m" ? "M" : "F"),
          en: paternal ? "Paternal Cousin" : "Maternal Cousin"
        };
      }
    }

    const myAnc = new Set(ancestorsOf(viewerId));
    for (const a of ancestorsOf(otherId)) {
      if (myAnc.has(a)) return { key: "relations.fallbacks.relative", en: "Relative", weak: true };
    }
    return { key: "relations.fallbacks.family", en: "Family", weak: true };
  }

  function labelFor(viewerId, otherId) {
    const pair = labelPair(viewerId, otherId);
    return tr(pair.key, pair.en);
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
  // `spouse` flags the marriage hop, which relationshipBetween still has to spot
  // once the visible label has been translated out of English.
  function stepPair(fromId, toId) {
    const from = byId[fromId], to = byId[toId];
    const miss = { key: "relations.steps.relative", en: "relative" };
    if (!from || !to) return miss;
    if (from.spouse === toId) {
      return to.gender === "m"
        ? { key: "relations.steps.husband", en: "husband", spouse: true }
        : { key: "relations.steps.wife",    en: "wife",    spouse: true };
    }
    if ((from.parents || []).includes(toId)) {
      return to.gender === "m"
        ? { key: "relations.steps.father", en: "father" }
        : { key: "relations.steps.mother", en: "mother" };
    }
    if ((from.children || []).includes(toId)) {
      return to.gender === "m"
        ? { key: "relations.steps.son",      en: "son" }
        : { key: "relations.steps.daughter", en: "daughter" };
    }
    if ((from.siblings || []).includes(toId)) {
      return to.gender === "m"
        ? { key: "relations.steps.brother", en: "brother" }
        : { key: "relations.steps.sister",  en: "sister" };
    }
    return miss;
  }

  function ordinal(n) {
    return ["1st", "2nd", "3rd"][n - 1] || (n + "th");
  }

  // Numbers inside a built label. English carries the ordinal in the token itself
  // ("2nd cousin"); Marathi carries it in the pattern ("{n}वा चुलत भाऊ"), so there
  // the token is just the digit, in Devanagari numerals.
  function mrNum(n) {
    return String(n).replace(/[0-9]/g, d => "०१२३४५६७८९"[+d]);
  }
  function isMR() {
    return typeof window !== "undefined" && window.CURRENT_LANG === "MR";
  }
  function degreeToken(n) { return isMR() ? mrNum(n) : ordinal(n); }
  function countToken(n)  { return isMR() ? mrNum(n) : String(n); }

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
      const pattern = other.gender === "m"
        ? tr("relations.patterns.cousinM", "{n} cousin")
        : tr("relations.patterns.cousinF", "{n} cousin");
      let label = pattern.replace("{n}", degreeToken(degree));
      if (removed === 1) {
        label += " " + tr("relations.patterns.onceRemoved", "once removed");
      } else if (removed === 2) {
        label += " " + tr("relations.patterns.twiceRemoved", "twice removed");
      } else if (removed > 2) {
        label += " " + tr("relations.patterns.timesRemoved", "{n} times removed")
                         .replace("{n}", countToken(removed));
      }
      return label;
    }

    // One side is a child of the shared ancestor, so this is an uncle/nephew
    // relationship displaced by generations. gap 0 is the plain uncle or
    // nephew that labelFor handles.
    const gap = Math.max(du, dd) - 2;
    if (gap <= 0) return null;
    const greats = gap > 1
      ? tr("relations.patterns.greatPrefix", "Great-").repeat(gap - 1)
      : "";
    if (dd === 1) {
      return greats + (other.gender === "m"
        ? tr("relations.distant.grandUncle", "Grand-uncle")
        : tr("relations.distant.grandAunt",  "Grand-aunt"));
    }
    return greats + (other.gender === "m"
      ? tr("relations.distant.grandNephew", "Grand-nephew")
      : tr("relations.distant.grandNiece",  "Grand-niece"));
  }

  // The best *blood* term for b as seen from a, or null when the two share no
  // ancestor. labelFor's own fallbacks ("Family", "Relative") are not answers, so
  // they are treated as a miss and handed to collateralLabel.
  function bloodLabel(aId, bId) {
    const pair = labelPair(aId, bId);
    if (pair && !pair.weak) return tr(pair.key, pair.en);
    return collateralLabel(aId, bId);
  }

  // T-18a. Both blood resolvers key off a shared ancestor, so for anyone who married
  // into the tree — Swati, whose Biradar line shares no ancestor with the Sathawanes —
  // every answer used to collapse to "Related by marriage". Compose *through* the
  // marriage hop instead: describe the person relative to the spouse, then say whose
  // spouse that is.
  //
  //   a married in    → "<husband|wife>'s <label(spouse, b)>"   e.g. husband's maternal cousin
  //   b married in    → "<label(a, b's spouse)>'s <husband|wife>" e.g. maternal cousin's wife
  //
  // `depth` caps how many marriage hops a single answer may cross. At 2 it covers
  // "my husband's brother's wife" and stops before the chain stops being a relationship
  // anyone would recognise. Recursion can bounce back to the original pair, but that
  // call only ever finds the same blood miss and unwinds, so it terminates on depth.
  function composedLabel(aId, bId, depth) {
    const direct = bloodLabel(aId, bId);
    if (direct) return direct;
    if (depth <= 0) return null;

    const a = byId[aId], b = byId[bId];

    // Marathi has no bare possessive 's: the possessor takes an oblique form and a
    // postposition (चा / ची / चे) that agrees with the *possessed* — i.e. with b.
    // The spouse side is a closed set of two words, so its oblique forms are held
    // literally in the strings (नवऱ्याचा / नवऱ्याची). The other direction would have
    // to inflect an arbitrary kinship term, which is not something we can compute,
    // so it uses the honorific particle instead — "मामे भाऊ यांची बायको" — which is
    // grammatical without touching the noun.
    if (a && a.spouse && a.spouse !== bId && byId[a.spouse]) {
      const inner = composedLabel(a.spouse, bId, depth - 1);
      if (inner) {
        const g = (b && b.gender === "m") ? "M" : "F";
        const term = byId[a.spouse].gender === "m"
          ? tr("relations.possessive.husbandPossessor" + g, "Husband")
          : tr("relations.possessive.wifePossessor" + g, "Wife");
        return tr("relations.possessive.viaSpouse", "{spouse}'s {relation}")
          .replace("{spouse}", term)
          .replace("{relation}", inner);
      }
    }

    if (b && b.spouse && b.spouse !== aId && byId[b.spouse]) {
      const inner = composedLabel(aId, b.spouse, depth - 1);
      if (inner) {
        const term = b.gender === "m"
          ? tr("relations.possessive.spouseTermM", "Husband")
          : tr("relations.possessive.spouseTermF", "Wife");
        return tr("relations.possessive.spouseOf", "{relation}'s {spouse}")
          .replace("{relation}", inner)
          .replace("{spouse}", term);
      }
    }

    return null;
  }

  // How is `bId` related to `aId`? Returns the term, plus the hop chain so the
  // UI can show the working rather than just asserting an answer.
  //
  // `isNounPhrase` is false when the answer is a statement about the pair rather
  // than a name for b — "Related by marriage" and friends. Slotting one of those
  // into the sentence template gives "Aarti is Swati's Related by marriage.", so
  // the UI phrases them separately. It is tracked as a flag rather than derived by
  // comparing the label against a list of English strings, because by this point
  // the label may well be in Marathi.
  function relationshipBetween(aId, bId) {
    const a = byId[aId], b = byId[bId];
    if (!a || !b) return null;
    if (aId === bId) {
      return {
        label: tr("relations.self.samePerson", "The same person"),
        chain: [], viaMarriage: false, isNounPhrase: false, degrees: 0, connected: true
      };
    }

    const path = relationPath(aId, bId);
    const chain = [];
    if (path) {
      for (let i = 1; i < path.length; i++) {
        const step = stepPair(path[i - 1], path[i]);
        chain.push({
          id: path[i],
          name: byId[path[i]].name,
          rel: tr(step.key, step.en),
          spouseHop: !!step.spouse
        });
      }
    }
    const viaMarriage = chain.some(s => s.spouseHop);

    const pair = labelPair(aId, bId);
    let label, isNounPhrase = true;
    if (pair && !pair.weak) {
      label = tr(pair.key, pair.en);
    } else {
      const composed = composedLabel(aId, bId, 2);
      if (composed) {
        label = composed;
      } else if (!path) {
        label = tr("relations.fallbacks.noKnownConnection", "No known connection");
        isNounPhrase = false;
      } else if (viaMarriage) {
        label = tr("relations.fallbacks.relatedByMarriage", "Related by marriage");
        isNounPhrase = false;
      } else {
        label = tr(pair.key, pair.en);   // Family / Relative
        isNounPhrase = false;
      }
    }

    return { label, chain, viaMarriage, isNounPhrase, degrees: chain.length, connected: !!path };
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

  // Generation levelling.
  //
  // The recursion below descends one row per parent-child hop *within a branch*, and every
  // root marriage starts at row 0 — so two branches of unequal depth put their youngest
  // members on different rows, and an in-law family grafted in at `lvl - 1` inherits the
  // depth of whatever it married into rather than its own. That is why Riyan sat a row
  // above Takshita, Yashmit, Virika and Daksh even though all five are the same generation.
  //
  // Generation is a property of the whole graph, not of one branch, so solve it as one.
  // Every parent-child edge fixes a difference of exactly 1 and every marriage a difference
  // of 0; walking the graph from the root person and honouring those differences gives one
  // consistent row index for everybody. Where two routes to the same person disagree — data
  // saying someone is both an uncle and a brother-in-law, say — the first level assigned
  // wins and the clash is reported, because averaging would move BOTH of them wrongly.
  const generation = (function solveGenerations() {
    const adj = {};
    persons.forEach(p => { adj[p.id] = []; });
    const link = (a, b, delta) => {
      if (!adj[a] || !adj[b]) return;
      adj[a].push([b, delta]);
      adj[b].push([a, -delta]);
    };
    relationships.forEach(r => {
      if (r.type === 'parent-child') link(r.parentId, r.childId, 1);
      else if (r.type === 'marriage') link(r.person1Id, r.person2Id, 0);
    });

    const lvl = {};
    const clashes = new Set();
    // Anchor on the root person so the main line keeps its rows as data around it changes.
    // Anything the root cannot reach forms its own component and anchors on itself.
    const starts = [rawData.meta && rawData.meta.rootPersonId].concat(persons.map(p => p.id));
    starts.forEach(start => {
      if (!start || !adj[start] || lvl[start] !== undefined) return;
      lvl[start] = 0;
      const queue = [start];
      while (queue.length) {
        const u = queue.shift();
        adj[u].forEach(([v, delta]) => {
          const want = lvl[u] + delta;
          if (lvl[v] === undefined) { lvl[v] = want; queue.push(v); }
          else if (lvl[v] !== want) clashes.add(v);
        });
      }
    });

    if (clashes.size) {
      console.warn(
        `[tree-helpers] ${clashes.size} person(s) are reachable at two different generations; ` +
        `kept the first row for each:`, Array.from(clashes).slice(0, 10)
      );
    }

    // Rows are used as indices (y = row * verticalLevelHeight), so slide the oldest
    // generation to 0 rather than leaving the root person's ancestors on negative rows.
    const values = Object.values(lvl);
    const min = values.length ? Math.min.apply(null, values) : 0;
    Object.keys(lvl).forEach(id => { lvl[id] -= min; });
    return lvl;
  })();

  // The row a node belongs on. `fallback` is the recursion's own depth, used only for a
  // node the solver never saw (a person absent from every relationship).
  function nodeLevel(node, fallback) {
    if (!node) return fallback;
    const id = node.type === 'single' ? node.personId : node.husbandId;
    const lvl = generation[id];
    return lvl === undefined ? fallback : lvl;
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

  function assignAbsoluteCoords(node, absX, depth) {
    if (!node) return;

    // The recursion's depth only decides where to look next; the row itself comes from
    // the global generation solve, so every branch lands its generations on the same rows.
    const lvl = nodeLevel(node, depth);

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
          // An in-law's parents are one generation up from the couple only when the
          // in-law is themselves this couple's generation — which the solver already
          // knows, and which lvl - 1 merely assumed. Reserve on the row they will
          // actually occupy, or the collision check clears the wrong row.
          const ilLvl = nodeLevel(il.node, lvl - 1);
          if (spouseCoord) {
            const dir = (il.spouseId === leftId) ? -1 : 1;
            const halfWidth = il.node.width / 2;
            const desired = spouseCoord.x + dir * (halfWidth + inLawGap);
            spouseX = Math.round(findFreeCenter(desired, halfWidth, dir, ilLvl));
            reserveSpan(ilLvl, spouseX - halfWidth, spouseX + halfWidth);
          }
          assignAbsoluteCoords(il.node, spouseX, ilLvl);
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

    // Joins only the parts that exist. A blank surname used to leave a trailing space on
    // the name — invisible in the card but real in the search index, the picker list and
    // the .ics summaries — and the Marathi side dropped the name entirely rather than
    // falling back to the first name alone.
    const joinName = (...parts) => parts.map(s => (s || '').trim()).filter(Boolean).join(' ');

    let displayName = joinName(p.firstName, p.lastName);
    let fNameMr = p.firstNameMr || getMarathiTranslation(p.firstName);
    let lNameMr = p.lastNameMr || getMarathiTranslation(p.lastName);
    let displayNameMr = fNameMr ? joinName(fNameMr, lNameMr) : null;

    if ((p.gender === 'F' || p.gender === 'f') && spouse) {
      const hLastName = spouse.lastName ? spouse.lastName.trim() : '';
      const wLastName = p.lastName ? p.lastName.trim() : '';

      if (hLastName && wLastName && hLastName.toLowerCase() !== wLastName.toLowerCase()) {
        displayName = `${joinName(p.firstName, hLastName)} (${wLastName})`;
      } else if (hLastName && !wLastName) {
        // Her maiden name is unknown — show the married name plainly rather than
        // "Name ()", which is what an empty maiden surname would otherwise print.
        displayName = joinName(p.firstName, hLastName);
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
      // UNKNOWN_BIRTH_DATE is a login placeholder, not a fact about the person, so it
      // must read as "no birth year" everywhere the UI states one.
      hasBirthYear: !!realDate(p.birthDate),
      death: p.status === 'deceased' && realDate(p.deathDate)
        ? parseInt(p.deathDate.split('-')[0])
        : null,
      deceased: p.status === 'deceased',
      bio: p.biography || `A valued member of our family.`,
      photo: p.profilePhoto || null,
      backgroundPhoto: p.backgroundPhoto || null,
      // Raw record fields the Bio tab renders. Kept null when absent so the
      // panel can skip the row rather than print an empty label.
      // Nulled rather than passed through when they hold the placeholder, so the Bio tab,
      // the calendar and the .ics feed cannot print it however they read the record.
      birthDate: realDate(p.birthDate),
      birthPlace: p.birthPlace || null,
      deathDate: realDate(p.deathDate),
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
    // UNKNOWN_BIRTH_DATE is a login placeholder, not a fact — must not surface as an entry.
    if (p.birthDate && !isUnknownBirthDate(p.birthDate)) {
      timeline.push({
        date: p.birthDate,
        caption: `${p.firstName} ${p.lastName} was born${p.birthPlace ? ' in ' + p.birthPlace : ''}.`,
        tags: [],
        photos: [null]
      });
    }

    const spouseRel = relationships.find(r =>
      r.type === 'marriage' &&
      (r.person1Id === p.id || r.person2Id === p.id)
    );
    if (spouseRel && spouseRel.startDate) {
      const spouseId = spouseRel.person1Id === p.id ? spouseRel.person2Id : spouseRel.person1Id;
      const spouse = persons.find(x => x.id === spouseId);
      if (spouse) {
        timeline.push({
          date: spouseRel.startDate,
          caption: `${p.firstName} ${p.lastName} married ${spouse.firstName} ${spouse.lastName}${spouseRel.place ? ' in ' + spouseRel.place : ''}.`,
          tags: [],
          photos: [null]
        });
      }
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

    // Same rule as the birth entry above: the placeholder is a login token, not a date
    // anyone died on, so it must not become a timeline entry either.
    if (p.status === 'deceased' && realDate(p.deathDate)) {
      timeline.push({
        date: p.deathDate,
        caption: `${p.firstName} ${p.lastName} passed away${p.deathPlace ? ' in ' + p.deathPlace : ''}.`,
        tags: [],
        photos: [null],
        // Styled distinctly downstream — same "remembrance" treatment as the
        // calendar's punyatithi cards, not a plain life-event entry.
        remembrance: true
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

