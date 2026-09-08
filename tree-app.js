/* ============================================================
   THE FAMILY TREE — Canvas app
   ============================================================ */

// ---------- i18n (T-27a/T-27b) ----------
// `t(key)` and `applyI18n()` are defined in index.html's boot script, not here:
// this file is only fetched after login in dev mode, and the login screen needs
// them first. They are globals, so the bare `t(...)` calls below resolve to them.
const t = window.t;
const applyI18n = window.applyI18n;

window.initTreeApp = function () {
  const F = window.FAMILY;
  const ME = F.ME;

  // ---------- Branch colours ----------
  // Allocated per surname at render time rather than read from a hand-kept
  // list, so a new in-law family picks up a colour the moment it appears in
  // the data. Anchored on the heritage design tokens so added branches stay
  // in the family look.
  const BRANCH_PALETTE = [
    '#4a7c59', // --family-leaf
    '#c8963e', // --family-gold
    '#5c3d1e', // --family-bark
    '#96566b', // muted rose
    '#8d5b4c', // terracotta
    '#5a789a', // slate blue
    '#7d6291', // plum
    '#a85751', // brick
    '#2f6b6b', // deep teal
    '#6d7f3f', // olive
    '#9e9080', // --family-muted
    '#4d5f8a'  // indigo
  ];
  const BRANCH_FALLBACK = '#2D7A2D';
  let branchColorMap = null;

  // Hashing gives each surname a preferred slot so it keeps its colour across
  // reloads; walking the surnames in sorted order makes the collision fallback
  // deterministic too, so the same data always paints the same colours.
  // The root person's surname is pinned to the leaf green first, so the main
  // line always reads as the family green rather than whatever it hashes to.
  function buildBranchColorMap(persons, rootSurname) {
    const map = {};
    const taken = new Set();
    const surnames = Array.from(new Set(
      (persons || []).map(p => (p.lastName || '').trim()).filter(Boolean)
    )).sort();

    const root = (rootSurname || '').trim();
    if (root && surnames.indexOf(root) !== -1) {
      map[root] = BRANCH_PALETTE[0];
      taken.add(0);
    }

    surnames.forEach(name => {
      if (map[name]) return;
      const key = name.toLowerCase();
      let h = 2166136261;
      for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      let idx = Math.abs(h) % BRANCH_PALETTE.length;
      // Past the palette size colours must repeat, so only probe while free
      // slots remain.
      if (taken.size < BRANCH_PALETTE.length) {
        while (taken.has(idx)) idx = (idx + 1) % BRANCH_PALETTE.length;
        taken.add(idx);
      }
      map[name] = BRANCH_PALETTE[idx];
    });
    return map;
  }

  function getBranchColor(lastName) {
    if (!branchColorMap) {
      const raw = window.FAMILY_DATA || window.FAMILY || {};
      const people = raw.persons || F.people || [];
      const rootId = raw.meta && raw.meta.rootPersonId;
      const root = rootId && people.find(p => p.id === rootId);
      branchColorMap = buildBranchColorMap(people, root && root.lastName);
    }
    return branchColorMap[(lastName || '').trim()] || BRANCH_FALLBACK;
  }
  window.getBranchColor = getBranchColor;

  // ---------- View state ----------
  let view = { x: 0, y: 0, scale: 0.85 };
  const minScale = 0.25, maxScale = 1.75;
  let activeFilter = null;     // current tag filter
  let pathTargetId = null;     // person at the end of the highlighted path
  let pathIds = new Set();     // ids on the current highlighted path
  let nodesById = {};          // dom refs
  let currentPersonId = null;  // lightbox open person id

  const canvas    = document.getElementById("canvas");
  const world     = document.getElementById("world");
  const linesSvg  = document.getElementById("lines");
  const search    = document.getElementById("search");
  const searchClr = document.getElementById("search-clear");
  const dropdown  = document.getElementById("search-dropdown");
  const tagsRow   = document.getElementById("tags-row");
  const statusPill= document.getElementById("status-pill");
  const statusBC  = document.getElementById("status-breadcrumb");
  const statusX   = document.getElementById("status-close");
  const lightbox  = document.getElementById("lightbox");

  /* ============================================================
     PHOTO FALLBACKS

     Most members have no photo — only a handful of the tree carries one — so the
     no-photo state is the common case, not the edge case. Both files ship in assets/
     and scripts/encrypt.js copies that folder into dist/, so the relative paths resolve
     identically in dev and in the deployed build.
     ============================================================ */
  const DEFAULT_PHOTO = "assets/profile-default.png";
  const DEFAULT_COVER = "assets/background-default.png";

  // A photo URL that 404s is the same situation as no photo at all — an R2 object that
  // was deleted, or a Drive link that never got rewritten — and without this the browser
  // draws its own broken-image glyph. Swapping the src on error lands it back on the
  // placeholder. The handler clears itself first so a missing placeholder cannot loop.
  function photoFallbackAttr(fallback) {
    const src = fallback || DEFAULT_PHOTO;
    return ` onerror="this.onerror=null;this.src='${src}';this.dataset.usedFallback='1'"`;
  }

  /* ============================================================
     INITIALS HELPER
     ============================================================ */
  function initials(name) {
    return name.split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();
  }
  function thumbHtml(p, cls) {
    const cl = cls || "node-thumb";
    const src = p.photo || DEFAULT_PHOTO;
    const isDefault = p.photo ? "" : ' data-default-photo="1"';
    return `<div class="${cl}"${isDefault}><img src="${escapeHtml(src)}" alt="" loading="lazy"${photoFallbackAttr()}></div>`;
  }
  function hashCode(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
    return h;
  }

  function getNodeDisplayName(p, lang) {
    if (lang === "MR") {
      return p.commonNameMr || p.firstNameMr || p.firstName;
    } else {
      return p.commonName || p.firstName || p.name.replace(/ Sathawane| Waghmare| Deshpande| Khedkar| Joshi| Pawar$/, "");
    }
  }

  /* ============================================================
     NAMES IN TRANSLATED TEXT

     The strings around a person's name are translated, but the name itself was
     spliced in from the English record every time — so Marathi read as English
     names wrapped in Marathi grammar ("Hitesh हे Vatsal यांचे चुलत भाऊ आहेत"),
     and the relationship chain strung Marathi hop labels between Latin names.

     Both helpers fall back per person rather than per language, so a member with
     no Marathi name still reads correctly instead of dropping out of the sentence.
     The English branch is deliberately unchanged — shortName returns the same
     first token it always did, so nothing moves in EN.
     ============================================================ */
  function isMarathi() {
    return window.CURRENT_LANG === "MR";
  }
  function shortName(p) {
    if (!p) return "";
    if (isMarathi()) return p.commonNameMr || p.firstNameMr || p.firstName || p.name.split(" ")[0];
    return p.name.split(" ")[0];
  }
  function fullName(p) {
    if (!p) return "";
    return (isMarathi() && p.nameMr) ? p.nameMr : p.name;
  }

  // Surname shown on the calendar's branch pills. Only the label translates — the English
  // surname stays the key, because it is what data-branch carries and what occ.branch is
  // compared against when filtering.
  //
  // Read off F.people rather than the raw records: processRawFamilyData already fills
  // lastNameMr from the transliteration dictionary where the sheet left the column blank,
  // so this covers more surnames than the sheet does on its own.
  const branchLabelCache = {};
  function branchLabel(surname) {
    if (!isMarathi() || !surname) return surname;
    if (!(surname in branchLabelCache)) {
      const key = String(surname).trim().toLowerCase();
      const hit = F.people.find(p =>
        String(p.lastName || "").trim().toLowerCase() === key && p.lastNameMr
      );
      branchLabelCache[surname] = hit ? hit.lastNameMr : surname;
    }
    return branchLabelCache[surname] || surname;
  }

  window.updateLanguage = function (lang) {
    window.CURRENT_LANG = lang;
    F.people.forEach(p => {
      const el = nodesById[p.id];
      if (el) {
        const nameDiv = el.querySelector(".node-name");
        if (nameDiv) {
          nameDiv.innerHTML = escapeHtml(getNodeDisplayName(p, lang));
        }
        // The relationship line under the name is resolved through i18n too, so it
        // has to be recomputed here — applyI18n() only walks data-i18n attributes.
        const relDiv = el.querySelector(".node-rel");
        if (relDiv) relDiv.textContent = F.labelFor(ME, p.id);
        const meTag = el.querySelector(".node-tag-me");
        if (meTag) meTag.textContent = t("relations.self.you", "You");
      }
    });
    if (lightbox.classList.contains("open") && currentPersonId) {
      const p = F.byId[currentPersonId];
      if (p) {
        document.getElementById("lb-name").innerHTML =
          escapeHtml(fullName(p)) + (p.deceased ? '<span class="leaf" title="In memory"></span>' : "");
        renderRelationsRow(p);
        renderBioTab(p);
        renderFamilyTab(p);
        renderTimelineTitle(p, currentPersonId);
        // The scrapbook list holds user-written captions, which do not translate — but
        // its empty state is our own sentence and has to follow the language.
        const emptyEl = document.querySelector("#lb-timeline-list .scrap-empty");
        if (emptyEl) {
          emptyEl.innerHTML = `${escapeHtml(t("profile.emptyScrapbook", "The scrapbook is still waiting for stories."))}<br>${escapeHtml(t("profile.emptyScrapbookHint", "Tap + on the canvas to add a memory."))}`;
        }
        // Keep the relationship picker on the same person, restated in the new language.
        resetRelCalc(true);
      }
    }

    // The breadcrumb names a person and the hops to them, both of which just changed.
    updateStatusFromPath();
    // Update calendar panel if it is visible
    const calendarEl = document.getElementById("calendar-panel");
    if (calendarEl && calendarEl.style.display !== "none") {
      renderCalendar();
    }
    // The filter pills are built in JS, so applyI18n() (which only walks data-i18n
    // attributes) never reaches them. Rebuild, then restore the active pill.
    renderTags();
    syncTagActiveState();
    if (activeFilter) updateStatusFromFilter();
    applyI18n();
  };

  /* ============================================================
     RENDER NODES
     ============================================================ */
  function renderNodes() {
    F.people.forEach(p => {
      const el = document.createElement("div");
      el.className = "node";
      el.dataset.id = p.id;
      if (p.deceased) el.classList.add("deceased");
      if (p.me)       el.classList.add("me");
      el.style.left = p.x + "px";
      el.style.top  = p.y + "px";

      const label = F.labelFor(ME, p.id);
      el.innerHTML = `
        <div class="node-card">
          ${thumbHtml(p)}
          <div class="node-name">${escapeHtml(getNodeDisplayName(p, window.CURRENT_LANG || "EN"))}</div>
          <div class="node-rel">${label}</div>
        </div>
        ${p.me ? `<div class="node-tag-me">${escapeHtml(t("relations.self.you", "You"))}</div>` : ""}
      `;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openPerson(p.id);
      });
      world.appendChild(el);
      nodesById[p.id] = el;
    });
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  /* ============================================================
     RENDER CONNECTING LINES
     ============================================================ */
  function renderLines() {
    linesSvg.innerHTML = "";

    // Parent→child lines (one for each parent, with a small drop)
    const seen = new Set();
    F.people.forEach(p => {
      if (!p.parents || !p.parents.length) return;
      // Find the parent pair midpoint if both parents are nodes
      const parentNodes = p.parents.map(id => F.byId[id]).filter(Boolean);
      if (parentNodes.length === 2) {
        // single line from couple midpoint to child
        const mid = midpoint(parentNodes[0], parentNodes[1]);
        addLine("parent", `M${mid.x} ${mid.y + 8} C ${mid.x} ${(mid.y + p.y) / 2}, ${p.x} ${(mid.y + p.y) / 2}, ${p.x} ${p.y - 36}`, {
          from: parentNodes[0].id + "|" + parentNodes[1].id,
          to: p.id
        });
      } else if (parentNodes.length === 1) {
        const par = parentNodes[0];
        addLine("parent", `M${par.x} ${par.y + 36} C ${par.x} ${(par.y + p.y) / 2}, ${p.x} ${(par.y + p.y) / 2}, ${p.x} ${p.y - 36}`, {
          from: par.id, to: p.id
        });
      }
    });

    // Spouse lines (one per couple)
    F.people.forEach(p => {
      if (!p.spouse) return;
      const key = [p.id, p.spouse].sort().join("|");
      if (seen.has(key)) return;
      seen.add(key);
      const q = F.byId[p.spouse];
      if (!q) return;
      const x1 = Math.min(p.x, q.x), x2 = Math.max(p.x, q.x);
      addLine("spouse", `M${x1 + 84} ${p.y} L${x2 - 84} ${p.y}`, {
        from: p.id, to: q.id, isSpouse: true
      });
      // marriage knot in the middle
      const knot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      knot.setAttribute("cx", (p.x + q.x) / 2);
      knot.setAttribute("cy", p.y);
      knot.setAttribute("r", "4");
      knot.setAttribute("class", "marriage-knot");
      knot.dataset.from = p.id;
      knot.dataset.to = q.id;
      linesSvg.appendChild(knot);
    });
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 18 };
  }

  function addLine(kind, d, meta) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "line " + kind);
    path.setAttribute("d", d);
    if (meta.from) path.dataset.from = meta.from;
    if (meta.to)   path.dataset.to   = meta.to;
    if (meta.isSpouse) path.dataset.spouse = "true";
    linesSvg.appendChild(path);
  }

  /* ============================================================
     RENDER TAGS
     ============================================================ */
  // The English tag string stays the identity — it keys data-tag, activeFilter and
  // F.tagMatches — so only the label is translated, never the value.
  function tagLabel(tag) {
    return t("tree.tags." + tag, tag);
  }

  function renderTags() {
    tagsRow.innerHTML = "";
    F.TAGS.forEach(tag => {
      const matches = F.tagMatches(ME, tag);
      const el = document.createElement("button");
      el.className = "tag" + (matches.length === 0 ? " disabled" : "");
      el.dataset.tag = tag;
      el.innerHTML = `${escapeHtml(tagLabel(tag))} <span class="tag-count">${matches.length}</span>`;
      if (matches.length > 0) {
        el.addEventListener("click", () => toggleTag(tag));
      }
      tagsRow.appendChild(el);
    });
  }
  function toggleTag(tag) {
    if (activeFilter === tag) {
      clearFilter();
    } else {
      activeFilter = tag;
      clearPath(); // a new filter dismisses any path highlight
      applyFilter();
      // auto-pan/zoom to fit matches
      const matches = F.tagMatches(ME, tag);
      if (matches.length) fitToIds([ME, ...matches], 110);
      updateStatusFromFilter();
    }
    syncTagActiveState();
  }
  function clearFilter() {
    activeFilter = null;
    document.querySelectorAll(".node").forEach(n => n.classList.remove("dim", "match"));
    document.querySelectorAll(".line").forEach(l => l.classList.remove("dimmed"));
    syncTagActiveState();
    updateStatusFromPath();
  }
  function syncTagActiveState() {
    document.querySelectorAll(".tag").forEach(t => {
      t.classList.toggle("active", t.dataset.tag === activeFilter);
    });
  }
  function applyFilter() {
    if (!activeFilter) return;
    const matches = new Set(F.tagMatches(ME, activeFilter));
    document.querySelectorAll(".node").forEach(n => {
      const id = n.dataset.id;
      if (matches.has(id) || id === ME) {
        n.classList.add("match");
        n.classList.remove("dim");
      } else {
        n.classList.remove("match");
        n.classList.add("dim");
      }
    });
    document.querySelectorAll(".line").forEach(l => l.classList.add("dimmed"));
  }

  /* ============================================================
     PATH HIGHLIGHTING
     ============================================================ */
  function highlightPath(targetId) {
    clearPathClasses();
    pathTargetId = targetId;
    const path = F.pathBetween(ME, targetId);
    if (!path) return;
    pathIds = new Set(path);
    path.forEach((id, i) => {
      const n = nodesById[id];
      if (!n) return;
      if (i === path.length - 1 && id !== ME) n.classList.add("endpoint");
      else if (id !== ME) n.classList.add("on-path");
      else n.classList.add("on-path");
    });
    // Highlight connecting lines (parent/child or spouse) between consecutive ids
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      highlightLineBetween(a, b);
    }
    updateStatusFromPath();
  }
  function clearPath() {
    pathTargetId = null;
    pathIds.clear();
    clearPathClasses();
    updateStatusFromPath();
  }
  function clearPathClasses() {
    document.querySelectorAll(".node.on-path, .node.endpoint")
      .forEach(n => n.classList.remove("on-path", "endpoint"));
    document.querySelectorAll(".line.highlighted, .marriage-knot.highlighted")
      .forEach(l => l.classList.remove("highlighted"));
  }
  function highlightLineBetween(aId, bId) {
    // try parent-line: line where data-to is the child and the parent (a or b) is mentioned in data-from
    const lines = linesSvg.querySelectorAll(".line");
    lines.forEach(ln => {
      const from = ln.dataset.from || "";
      const to   = ln.dataset.to   || "";
      const fromSet = new Set(from.split("|"));
      const isSpouse = ln.dataset.spouse === "true";
      if (isSpouse) {
        if (fromSet.has(aId) && to === bId || fromSet.has(bId) && to === aId
            || (from === aId && to === bId) || (from === bId && to === aId)) {
          ln.classList.add("highlighted");
        }
      } else {
        // parent-child: parent in from, child in to (or vice versa)
        if ((fromSet.has(aId) && to === bId) || (fromSet.has(bId) && to === aId)) {
          ln.classList.add("highlighted");
        }
      }
    });
    // marriage knot
    linesSvg.querySelectorAll(".marriage-knot").forEach(k => {
      if ((k.dataset.from === aId && k.dataset.to === bId) ||
          (k.dataset.from === bId && k.dataset.to === aId)) {
        k.classList.add("highlighted");
      }
    });
  }

  /* ============================================================
     STATUS PILL (active filter / breadcrumb path)
     ============================================================ */
  function updateStatusFromFilter() {
    if (!activeFilter) return updateStatusFromPath();
    const n = F.tagMatches(ME, activeFilter).length;
    statusPill.classList.remove("is-path");
    const unit = t(n === 1 ? "tree.status.match" : "tree.status.matches", n === 1 ? "match" : "matches");
    statusBC.innerHTML = `<span>${escapeHtml(t("tree.status.filtering", "Filtering:"))}</span> ` +
      `<span class="bc-name">${escapeHtml(tagLabel(activeFilter))}</span> ` +
      `<span style="opacity:.7">· ${n} ${escapeHtml(unit)}</span>`;
    statusPill.classList.add("visible");
  }
  function updateStatusFromPath() {
    if (!pathTargetId && !activeFilter) {
      statusPill.classList.remove("visible");
      return;
    }
    if (pathTargetId) {
      const path = F.pathBetween(ME, pathTargetId);
      if (!path) { statusPill.classList.remove("visible"); return; }
      statusPill.classList.add("is-path");
      const segs = path.map((id, i) => {
        const p = F.byId[id];
        const label = id === ME
          ? t("relations.self.you", "Me")
          : (i === path.length - 1 ? shortName(p) : shortRelative(id, path[Math.max(0, i - 1)]));
        return `<span class="bc-name">${label}</span>`;
      });
      statusBC.innerHTML = segs.join(' <span class="bc-arrow">→</span> ');
      statusPill.classList.add("visible");
    } else if (activeFilter) {
      updateStatusFromFilter();
    }
  }
  function shortRelative(id, prevId) {
    // simple short label between two adjacent path nodes
    const p = F.byId[id], prev = F.byId[prevId];
    if (!p || !prev) return shortName(p);
    // profile.terms.* already carries these eight in both languages; they were hardcoded
    // here, so the breadcrumb stayed English while every other relation label switched.
    const male = p.gender === "m";
    const term = (m, f) => male ? t("profile.terms." + m, m[0].toUpperCase() + m.slice(1))
                                : t("profile.terms." + f, f[0].toUpperCase() + f.slice(1));
    if (prev.spouse === id) return term("husband", "wife");
    if (prev.parents.includes(id)) return term("father", "mother");
    if (prev.children.includes(id)) return term("son", "daughter");
    if (prev.siblings && prev.siblings.includes(id)) return term("brother", "sister");
    return shortName(p);
  }
  statusX.addEventListener("click", () => {
    clearPath();
    clearFilter();
  });

  /* ============================================================
     SEARCH
     ============================================================ */
  let activeResult = -1;
  let lastResults = [];

  function fuzzyScore(query, name) {
    query = query.toLowerCase().trim();
    name = name.toLowerCase();
    if (!query) return 0;
    if (name.startsWith(query)) return 3;
    if (name.includes(" " + query)) return 2.5;
    if (name.includes(query)) return 2;
    // subsequence match
    let qi = 0;
    for (let i = 0; i < name.length && qi < query.length; i++) {
      if (name[i] === query[qi]) qi++;
    }
    if (qi === query.length) return 1;
    return 0;
  }

  function doSearch() {
    const q = search.value;
    if (!q) {
      dropdown.classList.remove("open");
      searchClr.classList.remove("visible");
      return;
    }
    searchClr.classList.add("visible");

    // Search by name OR by relationship label
    const results = [];
    F.people.forEach(p => {
      let s = fuzzyScore(q, p.name);
      if (p.nameMr) s = Math.max(s, fuzzyScore(q, p.nameMr));
      // also try alt names
      if (p.altNames) p.altNames.forEach(an => { s = Math.max(s, fuzzyScore(q, an)); });
      // also match against relationship label
      const rel = F.labelFor(ME, p.id);
      const relScore = fuzzyScore(q, rel);
      if (relScore > 1.5) s = Math.max(s, relScore - 0.5);
      if (s > 0) results.push({ p, s, rel });
    });
    results.sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name));
    lastResults = results;
    activeResult = results.length ? 0 : -1;
    renderResults(results, q);
  }
  function renderResults(results, q) {
    if (!results.length) {
      dropdown.innerHTML = `<div class="sr-empty">No one found for “${escapeHtml(q)}”.</div>`;
      dropdown.classList.add("open");
      return;
    }
    dropdown.innerHTML = results.slice(0, 8).map((r, i) => `
      <div class="search-result ${i === activeResult ? "active" : ""}" data-id="${r.p.id}">
        ${thumbHtml(r.p, "sr-thumb")}
        <div class="sr-meta">
          <div class="sr-name">${escapeHtml((window.CURRENT_LANG === "MR" && r.p.nameMr) ? r.p.nameMr : r.p.name)}</div>
          <div class="sr-rel">${r.rel}${r.p.deceased ? " · in memory" : ""}</div>
        </div>
      </div>
    `).join("");
    dropdown.querySelectorAll(".search-result").forEach(el => {
      el.addEventListener("click", () => selectSearchResult(el.dataset.id));
    });
    dropdown.classList.add("open");
  }
  function selectSearchResult(id) {
    clearFilter();        // selecting a result clears active filter
    closeSearch();
    panToPersonAndHighlight(id);
  }
  function closeSearch() {
    dropdown.classList.remove("open");
    search.blur();
  }

  search.addEventListener("input", doSearch);
  search.addEventListener("focus", () => { if (search.value) doSearch(); });
  search.addEventListener("keydown", (ev) => {
    if (!dropdown.classList.contains("open")) return;
    if (ev.key === "ArrowDown") {
      activeResult = Math.min(lastResults.length - 1, activeResult + 1);
      renderResults(lastResults, search.value);
      ev.preventDefault();
    } else if (ev.key === "ArrowUp") {
      activeResult = Math.max(0, activeResult - 1);
      renderResults(lastResults, search.value);
      ev.preventDefault();
    } else if (ev.key === "Enter" && activeResult >= 0) {
      selectSearchResult(lastResults[activeResult].p.id);
      ev.preventDefault();
    } else if (ev.key === "Escape") {
      closeSearch();
    }
  });
  searchClr.addEventListener("click", () => {
    search.value = "";
    dropdown.classList.remove("open");
    searchClr.classList.remove("visible");
    search.focus();
  });
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest(".search-wrap")) dropdown.classList.remove("open");
  });

  /* ============================================================
     PAN / ZOOM
     ============================================================ */
  function applyTransform(animate) {
    world.classList.toggle("animating", !!animate);
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    updateMinimap();
    updateVirtualization();
    if (animate) {
      setTimeout(() => world.classList.remove("animating"), 650);
    }
  }
  function updateVirtualization() {
    if (!F || !F.people || F.people.length <= 300) return;
    const rect = canvas.getBoundingClientRect();
    const pad = 300;
    F.people.forEach(p => {
      const n = nodesById[p.id];
      if (!n) return;
      const screenX = rect.left + rect.width / 2 + (p.x * view.scale + view.x);
      const screenY = rect.top + rect.height / 2 + (p.y * view.scale + view.y);
      const isVisible = (
        screenX >= -pad &&
        screenX <= window.innerWidth + pad &&
        screenY >= -pad &&
        screenY <= window.innerHeight + pad
      );
      n.style.display = isVisible ? '' : 'none';
    });
  }
  function setView(v, animate) {
    view.x = v.x; view.y = v.y;
    view.scale = Math.max(minScale, Math.min(maxScale, v.scale ?? view.scale));
    applyTransform(animate);
  }

  function panToPerson(id, opts) {
    const p = F.byId[id];
    if (!p) return;
    const scale = (opts && opts.scale) || Math.max(0.95, view.scale);
    // We want the person's canvas coords to land at viewport center.
    // world origin is at viewport center (left:50%, top:50%).
    // After transform: screen = center + (worldXY * scale + translate)
    // We want screen = center → worldXY * scale + translate = 0 → translate = -worldXY * scale
    setView({ x: -p.x * scale, y: -p.y * scale, scale }, true);
  }
  function panToPersonAndHighlight(id) {
    highlightPath(id);
    panToPerson(id, { scale: Math.max(view.scale, 1.0) });
    // brief flash
    const n = nodesById[id];
    if (n) {
      n.classList.add("endpoint");
      setTimeout(() => {
        // remove only if path target moved on
        if (pathTargetId !== id) n.classList.remove("endpoint");
      }, 2000);
    }
  }
  function fitToIds(ids, pad) {
    pad = pad || 80;
    const pts = ids.map(id => F.byId[id]).filter(Boolean);
    if (!pts.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(p => {
      minX = Math.min(minX, p.x - 100); maxX = Math.max(maxX, p.x + 100);
      minY = Math.min(minY, p.y - 100); maxY = Math.max(maxY, p.y + 100);
    });
    const w = maxX - minX, h = maxY - minY;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const isMobile = window.innerWidth <= 768;
    const topChrome = isMobile ? 130 : 150;
    const bottomChrome = isMobile ? 70 : 0;
    const vw = canvas.clientWidth  - pad * 2;
    const vh = canvas.clientHeight - topChrome - bottomChrome - pad * 2;
    const scale = Math.max(minScale, Math.min(maxScale, Math.min(vw / w, vh / h)));
    setView({ x: -cx * scale, y: -cy * scale, scale }, true);
  }
  function fitAll() {
    fitToIds(F.people.map(p => p.id), 120);
  }
  function centerOnMe() { panToPerson(ME, { scale: 1.0 }); }

  // Mouse drag
  let dragging = false, dragStart = null, viewStart = null;
  canvas.addEventListener("mousedown", (ev) => {
    if (ev.target.closest(".node") || ev.target.closest(".lightbox") || ev.target.closest(".top-chrome")) return;
    dragging = true;
    dragStart = { x: ev.clientX, y: ev.clientY };
    viewStart = { x: view.x, y: view.y };
    canvas.classList.add("dragging");
  });
  window.addEventListener("mousemove", (ev) => {
    if (!dragging) return;
    view.x = viewStart.x + (ev.clientX - dragStart.x);
    view.y = viewStart.y + (ev.clientY - dragStart.y);
    applyTransform(false);
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    canvas.classList.remove("dragging");
  });

  // Wheel zoom
  canvas.addEventListener("wheel", (ev) => {
    if (ev.target.closest(".lightbox")) return;
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    const mx = ev.clientX - cx;   // mouse in canvas-centered coords
    const my = ev.clientY - cy;
    // world point under cursor before zoom
    const wx = (mx - view.x) / view.scale;
    const wy = (my - view.y) / view.scale;
    const factor = ev.deltaY < 0 ? 1.1 : (1 / 1.1);
    const newScale = Math.max(minScale, Math.min(maxScale, view.scale * factor));
    // adjust translate so the world point stays under cursor
    view.x = mx - wx * newScale;
    view.y = my - wy * newScale;
    view.scale = newScale;
    applyTransform(false);
  }, { passive: false });

  // Touch: single = pan, two-finger = pinch
  let touchState = null;
  canvas.addEventListener("touchstart", (ev) => {
    if (ev.target.closest(".lightbox") || ev.target.closest(".top-chrome")) return;
    if (ev.touches.length === 1) {
      touchState = {
        mode: "pan",
        sx: ev.touches[0].clientX, sy: ev.touches[0].clientY,
        vx: view.x, vy: view.y
      };
    } else if (ev.touches.length === 2) {
      const a = ev.touches[0], b = ev.touches[1];
      const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      touchState = {
        mode: "pinch",
        sx: cx, sy: cy, sd: dist,
        vx: view.x, vy: view.y, vs: view.scale
      };
    }
  }, { passive: true });
  canvas.addEventListener("touchmove", (ev) => {
    if (!touchState) return;
    if (touchState.mode === "pan" && ev.touches.length === 1) {
      view.x = touchState.vx + (ev.touches[0].clientX - touchState.sx);
      view.y = touchState.vy + (ev.touches[0].clientY - touchState.sy);
      applyTransform(false);
      ev.preventDefault();
    } else if (touchState.mode === "pinch" && ev.touches.length === 2) {
      const a = ev.touches[0], b = ev.touches[1];
      const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const factor = dist / touchState.sd;
      const newScale = Math.max(minScale, Math.min(maxScale, touchState.vs * factor));
      // pinch center stays anchored
      const rect = canvas.getBoundingClientRect();
      const rx = touchState.sx - (rect.left + rect.width / 2);
      const ry = touchState.sy - (rect.top  + rect.height / 2);
      const wx = (rx - touchState.vx) / touchState.vs;
      const wy = (ry - touchState.vy) / touchState.vs;
      view.x = (cx - (rect.left + rect.width / 2)) - wx * newScale;
      view.y = (cy - (rect.top  + rect.height / 2)) - wy * newScale;
      view.scale = newScale;
      applyTransform(false);
      ev.preventDefault();
    }
  }, { passive: false });
  canvas.addEventListener("touchend", () => { touchState = null; });

  // Zoom buttons
  document.getElementById("zoom-in").addEventListener("click", () => {
    setView({ ...view, scale: Math.min(maxScale, view.scale * 1.2) }, true);
  });
  document.getElementById("zoom-out").addEventListener("click", () => {
    setView({ ...view, scale: Math.max(minScale, view.scale / 1.2) }, true);
  });
  document.getElementById("zoom-fit").addEventListener("click", fitAll);
  document.getElementById("zoom-me").addEventListener("click", centerOnMe);
  document.getElementById("me-chip").addEventListener("click", () => openPerson(ME));

  // Clicking blank canvas clears path highlight
  canvas.addEventListener("click", (ev) => {
    if (ev.target === canvas || ev.target === world || ev.target.classList.contains("lines")) {
      if (pathTargetId) clearPath();
    }
  });

  /* ============================================================
     MINIMAP
     ============================================================ */
  const minimapCanvas = document.getElementById("minimap-canvas");
  const minimapVp     = document.getElementById("minimap-viewport");
  function updateMinimap() {
    const mc = minimapCanvas;
    const ctx = mc.getContext("2d");
    const w = mc.width, h = mc.height;
    ctx.clearRect(0, 0, w, h);
    // bounds of all people
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    F.people.forEach(p => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    const pad = 120;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    const bw = maxX - minX, bh = maxY - minY;
    const s = Math.min(w / bw, h / bh);
    const ox = (w - bw * s) / 2 - minX * s;
    const oy = (h - bh * s) / 2 - minY * s;

    // draw lines first
    ctx.strokeStyle = "rgba(122,90,50,0.5)";
    ctx.lineWidth = 1;
    F.people.forEach(p => {
      if (!p.parents) return;
      p.parents.forEach(pid => {
        const par = F.byId[pid];
        if (!par) return;
        ctx.beginPath();
        ctx.moveTo(par.x * s + ox, par.y * s + oy);
        ctx.lineTo(p.x * s + ox, p.y * s + oy);
        ctx.stroke();
      });
    });
    // dots
    F.people.forEach(p => {
      const id = p.id;
      let color = "#7AAD7A";
      if (p.me) color = "#b85a2a";
      else if (p.deceased) color = "#5C3317";
      if (activeFilter) {
        const matches = new Set(F.tagMatches(ME, activeFilter));
        if (!matches.has(id) && id !== ME) color = "rgba(170,160,135,0.6)";
        else if (id !== ME) color = "#2D7A2D";
      }
      ctx.fillStyle = color;
      const r = p.me ? 4 : (p.deceased ? 2.5 : 3);
      ctx.beginPath();
      ctx.arc(p.x * s + ox, p.y * s + oy, r, 0, Math.PI * 2);
      ctx.fill();
    });

    // viewport rectangle: figure out what world coords are visible
    const vw = canvas.clientWidth, vh = canvas.clientHeight;
    const wLeft   = (-vw / 2 - view.x) / view.scale;
    const wRight  = ( vw / 2 - view.x) / view.scale;
    const wTop    = (-vh / 2 - view.y) / view.scale;
    const wBottom = ( vh / 2 - view.y) / view.scale;
    const left   = wLeft   * s + ox;
    const top    = wTop    * s + oy;
    const wid    = (wRight - wLeft) * s;
    const hgt    = (wBottom - wTop) * s;
    minimapVp.style.left   = Math.max(0, left) + "px";
    minimapVp.style.top    = Math.max(0, top)  + "px";
    minimapVp.style.width  = Math.min(w, wid)  + "px";
    minimapVp.style.height = Math.min(h, hgt)  + "px";
  }

  /* ============================================================
     PROFILE TABS — Timeline | Bio | Family
     ============================================================ */
  const MONTH_NAMES = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"];

  // family.json dates are ISO. Anything else (a bare year, a hand-typed value)
  // is passed through rather than mangled into an invalid Date.
  function formatFullDate(iso) {
    if (!iso) return null;
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(iso);
    const month = parseInt(m[2], 10);
    if (month < 1 || month > 12) return String(iso);
    return `${parseInt(m[3], 10)} ${MONTH_NAMES[month - 1]} ${m[1]}`;
  }

  function sentenceCase(s) {
    if (!s) return null;
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  // Quick relations row under the name — spouse, parents, children, a few siblings.
  // Extracted so a language switch can redraw it without reopening the panel, which
  // would re-pan the canvas and throw the reader back to the Timeline tab. Its labels
  // used to be hardcoded English while the Family tab right below used profile.terms.*,
  // so the same relation appeared twice on one screen in two languages.
  function renderRelationsRow(p) {
    const rels = [];
    const term = (male, m, f) => t("profile.terms." + (male ? m : f), male ? m : f);
    if (p.spouse) rels.push({ id: p.spouse, label: term(p.gender !== "m", "husband", "wife") });
    (p.parents || []).forEach(pid => {
      const par = F.byId[pid];
      if (par) rels.push({ id: pid, label: term(par.gender === "m", "father", "mother") });
    });
    (p.children || []).forEach(cid => {
      const c = F.byId[cid];
      if (c) rels.push({ id: cid, label: term(c.gender === "m", "son", "daughter") });
    });
    (p.siblings || []).slice(0, 3).forEach(sid => {
      const s = F.byId[sid];
      if (s) rels.push({ id: sid, label: term(s.gender === "m", "brother", "sister") });
    });

    const relsEl = document.getElementById("lb-relations");
    relsEl.innerHTML = rels.slice(0, 6).map(r => {
      const rp = F.byId[r.id];
      return `<button class="lb-rel-chip" data-id="${r.id}">
        ${thumbHtml(rp, "lrc-thumb")}
        <span class="lrc-rel">${escapeHtml(r.label)}</span>
        <span>${escapeHtml(shortName(rp))}</span>
      </button>`;
    }).join("");
    bindPersonChips(relsEl);
  }

  // Overwrites the data-i18n heading in the markup, so it carries its own translation —
  // otherwise the panel reverted to English the moment it opened.
  function renderTimelineTitle(p, id) {
    document.getElementById("lb-timeline-title").textContent = id === ME
      ? t("profile.scrapbookOwn", "Your Scrapbook")
      : t("profile.scrapbookOf", "{name}'s Scrapbook").replace("{name}", shortName(p));
  }

  function personChipHtml(id, label) {
    const p = F.byId[id];
    if (!p) return "";
    // An empty label means the surrounding heading already carries the relation.
    const relHtml = label ? `<span class="lrc-rel">${escapeHtml(label)}</span>` : "";
    return `<button class="lb-rel-chip" data-id="${id}">
      ${thumbHtml(p, "lrc-thumb")}
      ${relHtml}
      <span>${escapeHtml(shortName(p))}</span>
    </button>`;
  }

  // Every chip in the panel navigates the same way: close, then reopen on the
  // target once the sheet has finished sliding out.
  function bindPersonChips(root) {
    root.querySelectorAll(".lb-rel-chip").forEach(el => {
      el.addEventListener("click", () => {
        const targetId = el.dataset.id;
        closeLightbox();
        setTimeout(() => openPerson(targetId), 280);
      });
    });
  }

  function renderBioTab(p) {
    const facts = [];
    const push = (label, value) => { if (value) facts.push([label, value]); };

    if (p.hasBirthYear) push(t("profile.fields.born"), formatFullDate(p.birthDate));
    push(t("profile.fields.birthplace"), p.birthPlace);
    if (p.deceased) {
      push(t("profile.fields.died"), formatFullDate(p.deathDate));
      push(t("profile.fields.deathPlace"), p.deathPlace);
    }
    push(t("profile.fields.livesIn"), p.location);
    push(t("profile.fields.occupation"), p.occupation);
    push(t("profile.fields.education"), p.education);
    push(t("profile.fields.religion"), p.religion);
    push(t("profile.fields.maritalStatus"), sentenceCase(p.maritalStatus));
    push(t("profile.fields.maidenName"), p.maidenName);
    push(t("profile.fields.knownAs"), p.commonName);

    const factsEl = document.getElementById("lb-facts");
    factsEl.innerHTML = facts
      .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`)
      .join("");

    renderDobEditor(p);

    const storyEl = document.getElementById("lb-story");
    if (p.biography) {
      storyEl.innerHTML = `<h4 class="lb-sec-title">${escapeHtml(t("profile.lifeStory"))}</h4>${escapeHtml(p.biography)}`;
    } else {
      storyEl.innerHTML = "";
    }

    if (!facts.length && !p.biography) {
      factsEl.innerHTML = "";
      const emptyMsg = t("profile.emptyState").replace("{name}", shortName(p));
      storyEl.innerHTML = `<div class="lb-empty">${escapeHtml(emptyMsg)}</div>`;
      storyEl.style.borderTop = "none";
      storyEl.style.paddingTop = "0";
    } else {
      storyEl.style.borderTop = "";
      storyEl.style.paddingTop = "";
    }
  }

  function renderFamilyTab(p) {
    const groups = [];

    if (p.spouse && F.byId[p.spouse]) {
      // The group heading already says Wife/Husband and there is only ever one chip
      // under it, so repeating the word on the chip just reads as "HUSBAND HUSBAND
      // Hitesh". Parents/Children keep their chip labels because those distinguish
      // members within the group (Father vs Mother, Son vs Daughter).
      groups.push({
        title: p.gender === "m" ? t("profile.terms.wife") : t("profile.terms.husband"),
        members: [[p.spouse, ""]]
      });
    }

    const parents = (p.parents || []).filter(id => F.byId[id]);
    if (parents.length) {
      groups.push({
        title: t("profile.terms.parents"),
        members: parents.map(id => [id, F.byId[id].gender === "m" ? t("profile.terms.father") : t("profile.terms.mother")])
      });
    }

    const siblings = (p.siblings || []).filter(id => F.byId[id]);
    if (siblings.length) {
      groups.push({
        title: siblings.length === 1 ? t("profile.terms.sibling") : t("profile.terms.siblings"),
        members: siblings.map(id => [id, F.byId[id].gender === "m" ? t("profile.terms.brother") : t("profile.terms.sister")])
      });
    }

    const children = (p.children || []).filter(id => F.byId[id]);
    if (children.length) {
      groups.push({
        title: children.length === 1 ? t("profile.terms.child") : t("profile.terms.children"),
        members: children.map(id => [id, F.byId[id].gender === "m" ? t("profile.terms.son") : t("profile.terms.daughter")])
      });
    }

    const groupsEl = document.getElementById("lb-fam-groups");
    if (!groups.length) {
      const noLinks = t("profile.noFamilyLinks").replace("{name}", shortName(p));
      groupsEl.innerHTML = `<div class="lb-empty">${escapeHtml(noLinks)}</div>`;
    } else {
      groupsEl.innerHTML = groups.map(g => `
        <div class="lb-fam-group">
          <h4 class="lb-sec-title">${escapeHtml(g.title)}</h4>
          <div class="lb-fam-chips">
            ${g.members.map(([id, label]) => personChipHtml(id, label)).join("")}
          </div>
        </div>`).join("");
      bindPersonChips(groupsEl);
    }
  }

  /* ============================================================
     RELATIONSHIP CALCULATOR (T-18)
     ============================================================ */
  const relCalcInput  = document.getElementById("lb-relcalc-input");
  const relCalcList   = document.getElementById("lb-relcalc-list");
  const relCalcClear  = document.getElementById("lb-relcalc-clear");
  const relCalcResult = document.getElementById("lb-relcalc-result");
  let relCalcChoice   = "";   // id of the person currently answered about
  let relCalcMatches  = [];   // people shown in the open list
  let relCalcActive   = -1;   // keyboard cursor into relCalcMatches

  // The picker is a combobox rather than a <select> because the tree is past 70
  // members: scrolling a native option list to find one person is the slow way.
  function relCalcName(p) {
    return fullName(p);
  }

  // Matching stays deliberately loose — a member searching in English should still
  // find a person whose card reads in Marathi, and vice versa.
  function relCalcHaystack(p) {
    return [p.name, p.nameMr, p.firstName, p.lastName, p.firstNameMr, p.lastNameMr, p.commonName, p.commonNameMr]
      .filter(Boolean).join(" ").toLowerCase();
  }

  function relCalcSorted() {
    return F.people.slice().sort((a, b) => relCalcName(a).localeCompare(relCalcName(b)));
  }

  function closeRelCalcList() {
    if (!relCalcList) return;
    relCalcList.hidden = true;
    relCalcList.innerHTML = "";
    relCalcActive = -1;
    relCalcMatches = [];
    if (relCalcInput) relCalcInput.setAttribute("aria-expanded", "false");
  }

  function openRelCalcList(query) {
    if (!relCalcList || !relCalcInput) return;
    const q = (query || "").trim().toLowerCase();
    relCalcMatches = relCalcSorted().filter(p => !q || relCalcHaystack(p).includes(q));
    relCalcActive = -1;

    if (!relCalcMatches.length) {
      relCalcList.innerHTML = `<li class="lb-relcalc-empty" role="presentation">${escapeHtml(t("profile.relCalc.noMatch"))}</li>`;
    } else {
      relCalcList.innerHTML = relCalcMatches.map((p, i) => `
        <li class="lb-relcalc-opt" role="option" id="lb-relcalc-opt-${i}"
            aria-selected="${p.id === relCalcChoice ? "true" : "false"}" data-id="${escapeHtml(p.id)}">
          ${thumbHtml(p, "sr-thumb")}
          <span class="lb-relcalc-optname">${escapeHtml(relCalcName(p))}</span>
        </li>`).join("");
    }
    relCalcList.hidden = false;
    relCalcInput.setAttribute("aria-expanded", "true");
    fitRelCalcList();
  }

  // The picker sits near the bottom of the Family tab, and .lightbox-sheet is
  // overflow:hidden — so a list long enough to reach past the sheet was simply cut off,
  // taking its own scrollbar with it. Nothing was scrollable and the last names in the
  // tree were unreachable.
  //
  // Rather than let it escape the sheet (which would need the list re-parented to the
  // body and kept in sync with two scrolling ancestors), give it only the room that
  // actually exists: measure the gap to the viewport edge, open upwards when there is
  // more room above, and cap max-height to whichever side won.
  function fitRelCalcList() {
    if (!relCalcList || relCalcList.hidden || !relCalcInput) return;
    const GAP = 6;         // matches the CSS offset from the input
    const MARGIN = 12;     // breathing room against the viewport edge
    const MAX = 260;       // the design cap; never grow past it

    const rect = relCalcInput.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - GAP - MARGIN;
    const above = rect.top - GAP - MARGIN;
    const openUp = below < 160 && above > below;

    relCalcList.classList.toggle("up", openUp);
    relCalcList.style.maxHeight = Math.max(120, Math.min(MAX, openUp ? above : below)) + "px";
  }

  // Both the panel scrolling under the open list and a resize invalidate the measurement.
  lightbox.addEventListener("scroll", fitRelCalcList, { passive: true });
  window.addEventListener("resize", fitRelCalcList);

  function highlightRelCalcOption(idx) {
    if (!relCalcList || !relCalcMatches.length) return;
    const opts = relCalcList.querySelectorAll(".lb-relcalc-opt");
    if (!opts.length) return;
    relCalcActive = (idx + opts.length) % opts.length;
    opts.forEach((el, i) => el.classList.toggle("active", i === relCalcActive));
    opts[relCalcActive].scrollIntoView({ block: "nearest" });
    if (relCalcInput) relCalcInput.setAttribute("aria-activedescendant", `lb-relcalc-opt-${relCalcActive}`);
  }

  function chooseRelCalc(id) {
    const p = F.byId[id];
    if (!p) return;
    relCalcChoice = id;
    if (relCalcInput) relCalcInput.value = relCalcName(p);
    if (relCalcClear) relCalcClear.hidden = false;
    closeRelCalcList();
    renderRelCalc(id);
  }

  // Called when the profile panel switches person, and when the language flips.
  function resetRelCalc(keepChoice) {
    if (!keepChoice) relCalcChoice = "";
    const p = relCalcChoice && F.byId[relCalcChoice];
    if (relCalcInput) relCalcInput.value = p ? relCalcName(p) : "";
    if (relCalcClear) relCalcClear.hidden = !p;
    closeRelCalcList();
    renderRelCalc(p ? relCalcChoice : "");
  }

  function renderRelCalc(otherId) {
    if (!relCalcResult) return;
    if (!otherId || !currentPersonId) { relCalcResult.innerHTML = ""; return; }

    const subject = F.byId[currentPersonId];
    const other   = F.byId[otherId];
    const result  = F.relationshipBetween(currentPersonId, otherId);
    if (!subject || !other || !result) { relCalcResult.innerHTML = ""; return; }

    const subjectFirst = escapeHtml(shortName(subject));
    const otherFirst   = escapeHtml(shortName(other));

    let answer;
    if (currentPersonId === otherId) {
      answer = escapeHtml(t("profile.relCalc.samePerson").replace("{name}", shortName(subject)));
    } else if (!result.connected) {
      answer = escapeHtml(t("profile.relCalc.noLink"))
        .replace("{other}", `<strong>${otherFirst}</strong>`)
        .replace("{subject}", `<strong>${subjectFirst}</strong>`);
    } else if (!result.isNounPhrase) {
      // "Related by marriage" is a statement about the pair, not a name for the person,
      // so it gets its own sentence instead of being slotted in after the possessive.
      // Lower-casing only applies to English; Devanagari has no case to fold.
      const phrase = window.CURRENT_LANG === "MR" ? result.label : result.label.toLowerCase();
      answer = t("profile.relCalc.answerPair", "{other} and {subject} are {label}.")
        .replace("{other}",   `<strong>${otherFirst}</strong>`)
        .replace("{subject}", `<strong>${subjectFirst}</strong>`)
        .replace("{label}",   `<strong>${escapeHtml(phrase)}</strong>`);
    } else {
      answer = t("profile.relCalc.answer", "{other} is {subject}'s {label}.")
        .replace("{other}",   `<strong>${otherFirst}</strong>`)
        .replace("{subject}", `<strong>${subjectFirst}</strong>`)
        .replace("{label}",   `<strong>${escapeHtml(result.label)}</strong>`);
    }

    // Show the working: the hop chain the answer was derived from. Each hop carries the
    // person's id, so the names are resolved here rather than taken from the chain's
    // pre-baked English `h.name` — the hop relations were already translated, which left
    // Marathi labels strung between Latin names.
    let chainHtml = "";
    const hops = result.chain.slice(0, 8);
    if (hops.length > 1) {
      const hopName = h => relCalcName(F.byId[h.id] || { name: h.name, nameMr: null });
      chainHtml = `<div class="lb-relcalc-chain">${escapeHtml(relCalcName(subject))}` +
        hops.map(h => `<span class="arrow">→</span><span class="hop-rel">${escapeHtml(h.rel)}</span>${escapeHtml(hopName(h))}`).join("") +
        (result.chain.length > hops.length ? `<span class="arrow">→</span>…` : "") +
        `</div>`;
    }

    relCalcResult.innerHTML = `<div class="lb-relcalc-answer">${answer}</div>${chainHtml}`;
  }

  if (relCalcInput && relCalcList) {
    relCalcInput.addEventListener("focus", () => openRelCalcList(""));
    relCalcInput.addEventListener("click", () => {
      if (relCalcList.hidden) openRelCalcList(relCalcInput.value === (relCalcChoice && F.byId[relCalcChoice] ? relCalcName(F.byId[relCalcChoice]) : "") ? "" : relCalcInput.value);
    });
    relCalcInput.addEventListener("input", () => {
      // Typing over a chosen name drops the old answer rather than leaving a
      // result on screen that no longer matches what the box says.
      relCalcChoice = "";
      relCalcClear.hidden = !relCalcInput.value;
      relCalcResult.innerHTML = "";
      openRelCalcList(relCalcInput.value);
    });
    relCalcInput.addEventListener("keydown", ev => {
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        if (relCalcList.hidden) openRelCalcList(relCalcInput.value);
        highlightRelCalcOption(relCalcActive + 1);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        if (relCalcList.hidden) openRelCalcList(relCalcInput.value);
        highlightRelCalcOption(relCalcActive - 1);
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        const pick = relCalcActive >= 0 ? relCalcMatches[relCalcActive] : relCalcMatches[0];
        if (pick) chooseRelCalc(pick.id);
      } else if (ev.key === "Escape") {
        // Swallowed so the profile panel does not close out from under a search.
        if (!relCalcList.hidden) { ev.stopPropagation(); closeRelCalcList(); }
      }
    });
    relCalcList.addEventListener("mousedown", ev => {
      const opt = ev.target.closest(".lb-relcalc-opt");
      if (!opt) return;
      ev.preventDefault();          // keep focus in the input
      chooseRelCalc(opt.dataset.id);
    });
    relCalcClear.addEventListener("click", () => {
      resetRelCalc(false);
      relCalcInput.focus();
    });
    document.addEventListener("click", ev => {
      if (!ev.target.closest("#lb-relcalc-combo")) closeRelCalcList();
    });
  }

  function switchProfileTab(name) {
    document.querySelectorAll(".lb-tab").forEach(btn => {
      const on = btn.dataset.lbtab === name;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".lb-tabpanel").forEach(panel => {
      const on = panel.id === `lb-tab-${name}`;
      panel.classList.toggle("active", on);
      panel.hidden = !on;
    });
  }
  document.querySelectorAll(".lb-tab").forEach(btn => {
    btn.addEventListener("click", () => switchProfileTab(btn.dataset.lbtab));
  });

  /* ============================================================
     LIGHTBOX
     ============================================================ */
  // Extracted so a DOB self-edit can refresh just this line without re-running
  // the rest of openPerson() (which would reset the active tab to Timeline).
  function renderLifeLine(p) {
    const life = document.getElementById("lb-life");
    if (!life) return;
    const lifeParts = [];
    // p.birth carries a 1950 placeholder when the record has no DOB, so the
    // year and the age are only printed when the birth date is real.
    lifeParts.push(p.hasBirthYear ? `b. ${p.birth}` : "");
    if (p.deceased && p.death) lifeParts.push(`d. ${p.death}`);
    else if (!p.deceased && p.hasBirthYear) {
      const age = 2026 - p.birth;
      lifeParts.push(`${age} years`);
    }
    if (p.altNames && p.altNames.length) lifeParts.push("“" + p.altNames[0] + "”");
    life.innerHTML = lifeParts.filter(Boolean).map((s, i, arr) =>
      i < arr.length - 1 ? s + '<span class="sep"></span>' : s
    ).join("");
  }

  function openPerson(id) {
    const p = F.byId[id];
    if (!p) return;
    currentPersonId = id;
    highlightPath(id);
    panToPerson(id, { scale: Math.max(view.scale, 1.0) });

    const modalDisplayName = (window.CURRENT_LANG === "MR" && p.nameMr) ? p.nameMr : p.name;
    document.getElementById("lb-name").innerHTML =
      escapeHtml(modalDisplayName) + (p.deceased ? '<span class="leaf" title="In memory"></span>' : "");
    const relEl = document.getElementById("lb-rel");
    const rel = F.labelFor(ME, id);
    relEl.textContent = id === ME ? t("relations.self.thisIsYou", "This is you") : rel;
    relEl.classList.toggle("is-me", id === ME);

    renderLifeLine(p);

    document.getElementById("lb-bio").textContent = p.bio || "";

    // Profile + cover photo
    const photoEl = document.getElementById("lb-profile-photo");
    photoEl.innerHTML = "";
    const avatarImg = document.createElement("img");
    avatarImg.src = p.photo || DEFAULT_PHOTO;
    avatarImg.loading = "lazy";
    avatarImg.alt = "";
    avatarImg.onerror = () => { avatarImg.onerror = null; avatarImg.src = DEFAULT_PHOTO; };
    // Marks the placeholder so it is not offered to the photo viewer and does not
    // advertise itself as clickable — there is nothing to enlarge.
    photoEl.toggleAttribute("data-default-photo", !p.photo);
    photoEl.appendChild(avatarImg);
    const cover = document.getElementById("lb-cover");
    const coverMedia = document.getElementById("lb-cover-media");
    coverMedia.innerHTML = "";
    // If person has a background cover photo, render it in full resolution. Otherwise, blur profile photo.
    // Only a real cover opens in the viewer — the blurred fallback is the avatar again,
    // and the avatar is already clickable in its own right.
    if (p.backgroundPhoto) {
      const img = document.createElement("img");
      img.className = "lb-cover-img";
      img.src = p.backgroundPhoto;
      img.loading = "lazy";
      img.dataset.viewerSrc = p.backgroundPhoto;
      coverMedia.appendChild(img);
    } else if (p.photo) {
      const img = document.createElement("img");
      img.className = "lb-cover-img";
      img.src = p.photo;
      img.loading = "lazy";
      img.style.filter = "blur(8px) saturate(1.05)";
      img.style.transform = "scale(1.1)";
      img.style.cursor = "default";
      coverMedia.appendChild(img);
    } else {
      // Neither photo. The default cover is the same silhouette as the avatar, so it is
      // blurred hard and dropped to a whisper — otherwise the panel shows one grey face
      // behind another. What survives is a soft wash that reads as "no photo yet" while
      // the per-person tonal gradient underneath still carries the colour.
      const img = document.createElement("img");
      img.className = "lb-cover-img";
      img.src = DEFAULT_COVER;
      img.loading = "lazy";
      img.style.filter = "blur(18px) saturate(0.6)";
      img.style.transform = "scale(1.2)";
      img.style.opacity = "0.35";
      img.style.cursor = "default";
      coverMedia.appendChild(img);
    }
    // Tonal palette varies by person to give each profile a slight identity
    const tones = [
      ["#ffd9a8","#f6a96b","#b85a2a"],
      ["#d9eedd","#a5d6a7","#2d7a2d"],
      ["#f1e1c2","#d9b48a","#8a5a36"],
      ["#fbe1d2","#e6a48b","#a05a3c"],
      ["#e6dfca","#c9b98e","#7a6a4a"]
    ];
    // Named `tone`, not `t`: `t` is the module-wide translate function, and a local of
    // that name shadowed it for the whole of openPerson — every t("…") call further down
    // this function threw "t is not a function", which is what blanked the scrapbook's
    // empty state.
    const tone = tones[Math.abs(hashCode(p.id)) % tones.length];
    cover.style.background = `linear-gradient(135deg, ${tone[0]} 0%, ${tone[1]} 45%, ${tone[2]} 100%)`;

    // Photo edit buttons — own profile only, and only when a Worker is configured.
    // The Worker re-checks both, so this is presentation, not the security boundary.
    const canEdit = canEditPhotos(id);
    const editAvatar = document.getElementById("lb-edit-avatar");
    const editCover  = document.getElementById("lb-edit-cover");
    if (editAvatar) editAvatar.hidden = !canEdit;
    if (editCover)  editCover.hidden  = !canEdit;

    renderRelationsRow(p);

    // Bio + Family tabs, and the relationship calculator seeded on this person
    renderBioTab(p);
    renderFamilyTab(p);
    resetRelCalc(false);
    switchProfileTab("timeline");

    renderTimelineTitle(p, id);

    // Scrapbook
    const list = document.getElementById("lb-timeline-list");
    list.innerHTML = "";
    const entries = F.scrapbook[id] || [];
    if (!entries.length) {
      list.innerHTML = `<div class="scrap-empty">${escapeHtml(t("profile.emptyScrapbook", "The scrapbook is still waiting for stories."))}<br>${escapeHtml(t("profile.emptyScrapbookHint", "Tap + on the canvas to add a memory."))}</div>`;
    } else {
      entries.forEach(e => {
        const card = document.createElement("div");
        card.className = e.remembrance ? "scrap-card remembrance" : "scrap-card";
        const memorialChip = e.remembrance
          ? `<span class="scrap-memorial-chip">🕯 ${window.CURRENT_LANG === "MR" ? "स्मरणार्थ" : "In Memory"}</span>`
          : "";
        const photos = (e.photos || []).slice(0, 3);
        const photosHtml = photos.length ? `
          <div class="scrap-photos count-${photos.length}">
            ${photos.map(ph => `
              <div class="scrap-photo ${ph ? "has-photo" : ""}">
                ${ph ? `<img src="${ph}" alt="" loading="lazy">` : `
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="color:#8a5a36">
                    <rect x="3" y="5" width="18" height="14" rx="2"/>
                    <circle cx="9" cy="11" r="1.5"/>
                    <path d="M3 17l5-5 4 4 3-3 6 6"/>
                  </svg>
                `}
              </div>
            `).join("")}
          </div>` : "";
        const tagsHtml = e.tags && e.tags.length ? `
          <div class="scrap-tags">
            <span class="label">With</span>
            ${e.tags.map(tid => {
              const tp = F.byId[tid]; if (!tp) return "";
              return `<button class="scrap-tag" data-id="${tid}">
                ${thumbHtml(tp, "st-thumb")}
                <span>${escapeHtml(shortName(tp))}</span>
              </button>`;
            }).join("")}
          </div>` : "";
        card.innerHTML = `
          <div class="scrap-date">${formatScrapDate(e.date)}${memorialChip}</div>
          ${photosHtml}
          <p class="scrap-caption">${escapeHtml(e.caption)}</p>
          ${tagsHtml}
        `;
        list.appendChild(card);
      });
      list.querySelectorAll(".scrap-tag").forEach(el => {
        el.addEventListener("click", () => {
          const targetId = el.dataset.id;
          closeLightbox();
          setTimeout(() => openPerson(targetId), 280);
        });
      });
    }

    lightbox.classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeLightbox() {
    currentPersonId = null;
    lightbox.classList.remove("open");
    document.body.style.overflow = "";
  }
  document.getElementById("lb-close").addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (ev) => {
    if (ev.target === lightbox) closeLightbox();
  });

  /* ============================================================
     PHOTO VIEWER — the profile panel shows both photos cropped (the avatar to a
     116px circle, the cover to a 220px band). Clicking either opens the source
     image whole, which is the only way to actually see a photo someone uploaded.
     ============================================================ */
  const photoViewer = document.getElementById("photo-viewer");
  const pvImg       = document.getElementById("pv-img");
  const pvCaption   = document.getElementById("pv-caption");

  function openPhotoViewer(src, caption) {
    if (!src) return;
    pvImg.src = src;
    pvImg.alt = caption || "";
    pvCaption.textContent = caption || "";
    photoViewer.classList.add("open");
    document.getElementById("pv-close").focus();
  }
  function closePhotoViewer() {
    photoViewer.classList.remove("open");
    // Drop the source so a large image is not held decoded behind the profile panel,
    // and so the next open never flashes the previous person's face.
    pvImg.removeAttribute("src");
    pvCaption.textContent = "";
  }
  document.getElementById("pv-close").addEventListener("click", closePhotoViewer);
  photoViewer.addEventListener("click", (ev) => {
    // The figure is the photo itself; only the surrounding backdrop dismisses.
    if (!ev.target.closest(".pv-figure")) closePhotoViewer();
  });

  document.getElementById("lb-cover").addEventListener("click", (ev) => {
    // The edit buttons sit on top of the cover; they own their own clicks.
    if (ev.target.closest(".lb-photo-edit")) return;

    if (ev.target.closest("#lb-profile-photo")) {
      // No photo means the avatar is the grey placeholder, and there is nothing to enlarge.
      if (lbPersonPhoto()) openPhotoViewer(lbPersonPhoto(), lbPersonName());
      return;
    }
    // Anywhere else on the cover. The click cannot be read off ev.target: .lb-cover::after
    // is a full-bleed gradient painted over the image, so the image is never the target.
    const coverImg = document.querySelector("#lb-cover-media .lb-cover-img[data-viewer-src]");
    if (coverImg) openPhotoViewer(coverImg.dataset.viewerSrc, lbPersonName());
  });
  function lbPerson() { return currentPersonId ? F.byId[currentPersonId] : null; }
  function lbPersonPhoto() { const p = lbPerson(); return p && p.photo; }
  function lbPersonName()  { const p = lbPerson(); return p ? fullName(p) : ""; }

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      // Innermost layer first, or Escape would close the panel out from under the photo.
      if (photoViewer.classList.contains("open")) closePhotoViewer();
      else if (lightbox.classList.contains("open")) closeLightbox();
      else if (pathTargetId) clearPath();
      else if (activeFilter) clearFilter();
    }
  });

  /* ============================================================
     VIEW SWITCHING & CALENDAR LOGIC (PHASE 6)
     ============================================================ */
  let activeCalBranch = "all";
  let activeCalType = "all";
  let calSearchQuery = "";

  function switchView(viewName) {
    const canvasEl = document.getElementById("canvas");
    const zoomEl = document.querySelector(".zoom-ctrls");
    const minimapEl = document.getElementById("minimap-container") || document.getElementById("minimap");
    const calendarEl = document.getElementById("calendar-panel");
    const tagsRowEl = document.getElementById("tags-row");

    // Sync Desktop Tabs
    document.querySelectorAll(".top-tabs button").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tab === viewName);
    });

    // Sync Mobile Tabs
    document.querySelectorAll(".mnav-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.nav === viewName);
    });

    if (viewName === "calendar") {
      if (canvasEl) canvasEl.style.display = "none";
      if (zoomEl) zoomEl.style.display = "none";
      if (minimapEl) minimapEl.style.display = "none";
      if (tagsRowEl) tagsRowEl.style.display = "none";
      if (calendarEl) {
        calendarEl.style.display = "flex";
        renderCalendar();
      }
    } else {
      // Default to "tree"
      if (calendarEl) calendarEl.style.display = "none";
      if (canvasEl) canvasEl.style.display = "block";
      if (zoomEl) zoomEl.style.display = "flex";
      if (minimapEl) minimapEl.style.display = "block";
      if (tagsRowEl) tagsRowEl.style.display = "flex";
      
      setTimeout(() => {
        centerOnMe();
      }, 50);
    }
  }

  // Desktop Tabs Click Listener
  document.querySelectorAll(".top-tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab) switchView(tab);
    });
  });

  // Mobile Bottom Nav Listener
  document.querySelectorAll(".mnav-btn").forEach(b => {
    b.addEventListener("click", () => {
      const k = b.dataset.nav;
      if (k === "search") {
        switchView("tree");
        setTimeout(() => search.focus(), 60);
      } else if (k === "profile") {
        openPerson(ME);
      } else if (k === "calendar") {
        switchView("calendar");
      } else if (k === "tree") {
        switchView("tree");
      }
    });
  });

  // Calendar render functions
  function calculateNextOccur(dateStr, startYear) {
    if (!dateStr) return null;
    const parts = String(dateStr).split("-").map(Number);
    if (parts.length < 3) return null;
    const [year, month, day] = parts;
    // A hand-typed sheet value can survive the importer as something like "2-july-",
    // which splits into three parts but yields NaN for the month. Without this the card
    // rendered "In NaN days" on a date of "NaN undefined".
    if (!Number.isFinite(month) || !Number.isFinite(day) ||
        month < 1 || month > 12 || day < 1 || day > 31) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let nextOcc = new Date(today.getFullYear(), month - 1, day);
    nextOcc.setHours(0, 0, 0, 0);
    
    if (nextOcc.getTime() < today.getTime()) {
      nextOcc.setFullYear(today.getFullYear() + 1);
    }
    
    const diffMs = nextOcc.getTime() - today.getTime();
    const daysLeft = Math.round(diffMs / (1000 * 60 * 60 * 24));
    
    // No milestone when the year is a placeholder: the day and month are real, so the
    // countdown stands, but "how many years" is not something the data knows.
    const knownStart = Number.isFinite(startYear) && startYear !== window.UNKNOWN_YEAR;
    const milestone = knownStart ? (nextOcc.getFullYear() - startYear) : null;

    return { nextOcc, daysLeft, milestone };
  }

  function renderCalendar() {
    const listEl = document.getElementById("calendar-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    const rawData = window.FAMILY_DATA || window.FAMILY;
    if (!rawData) {
      listEl.innerHTML = `<div class="cal-empty">Could not load family data.</div>`;
      return;
    }

    // Set header translations
    const panelTitle = document.getElementById("cal-panel-title");
    const exportText = document.getElementById("cal-export-text");
    const searchInput = document.getElementById("cal-search-input");
    const typeAll = document.getElementById("cal-type-all");
    const typeBirthdays = document.getElementById("cal-type-birthdays");
    const typeAnniversaries = document.getElementById("cal-type-anniversaries");
    const typeRemembrance = document.getElementById("cal-type-remembrance");

    if (window.CURRENT_LANG === "MR") {
      if (panelTitle) panelTitle.textContent = "कुटुंब दिनदर्शिका";
      if (exportText) exportText.textContent = "दिनदर्शिका डाउनलोड करा (.ics)";
      if (searchInput) searchInput.placeholder = "कार्यक्रम शोधा...";
      if (typeAll) typeAll.textContent = "सर्व";
      if (typeBirthdays) typeBirthdays.textContent = "वाढदिवस";
      if (typeAnniversaries) typeAnniversaries.textContent = "लग्नाचे वाढदिवस";
      if (typeRemembrance) typeRemembrance.textContent = "पुण्यतिथी";
      const mnavCal = document.getElementById("mnav-calendar-label");
      if (mnavCal) mnavCal.textContent = "दिनदर्शिका";
    } else {
      if (panelTitle) panelTitle.textContent = "Upcoming Occasions";
      if (exportText) exportText.textContent = "Export Calendar (.ics)";
      if (searchInput) searchInput.placeholder = "Search occasions...";
      if (typeAll) typeAll.textContent = "All";
      if (typeBirthdays) typeBirthdays.textContent = "Birthdays";
      if (typeAnniversaries) typeAnniversaries.textContent = "Anniversaries";
      if (typeRemembrance) typeRemembrance.textContent = "Remembrance";
      const mnavCal = document.getElementById("mnav-calendar-label");
      if (mnavCal) mnavCal.textContent = "Calendar";
    }

    // Gather branch filter options (major last names with >= 3 members)
    const counts = {};
    rawData.persons.forEach(p => {
      if (p.lastName) counts[p.lastName] = (counts[p.lastName] || 0) + 1;
    });
    const majorBranches = Object.keys(counts).filter(k => counts[k] >= 3).sort((a,b) => counts[b] - counts[a]);

    // Build branch filter pills UI
    const branchFiltersEl = document.getElementById("cal-branch-filters");
    if (branchFiltersEl) {
      let pillsHtml = `<button class="cal-pill ${activeCalBranch === 'all' ? 'active' : ''}" data-branch="all">${window.CURRENT_LANG === "MR" ? "सर्व शाखा" : "All Branches"}</button>`;
      majorBranches.forEach(b => {
        pillsHtml += `<button class="cal-pill ${activeCalBranch === b ? 'active' : ''}" data-branch="${escapeHtml(b)}">${escapeHtml(branchLabel(b))} (${counts[b]})</button>`;
      });
      branchFiltersEl.innerHTML = pillsHtml;
      
      branchFiltersEl.querySelectorAll(".cal-pill").forEach(pill => {
        pill.addEventListener("click", () => {
          branchFiltersEl.querySelectorAll(".cal-pill").forEach(x => x.classList.remove("active"));
          pill.classList.add("active");
          activeCalBranch = pill.dataset.branch;
          filterAndRenderList();
        });
      });
    }

    // Gather occasions
    const occasions = [];

    // 1. Birthdays — deceased members included, flagged so the card can mark them and
    //    never offer a birthday wish. A deceased person's entry reads as a birth
    //    anniversary rather than a birthday. The 1674-06-06 login placeholder is not a
    //    birth date and must never surface as one.
    rawData.persons.forEach(p => {
      if (p.birthDate && !isUnknownBirthDate(p.birthDate)) {
        const startYear = parseInt(p.birthDate.split("-")[0]);
        const calc = calculateNextOccur(p.birthDate, startYear);
        if (calc) {
          const gone = p.status === "deceased";
          occasions.push({
            id: p.id,
            person: p,
            type: "birthday",
            isDeceased: gone,
            dateStr: p.birthDate,
            daysLeft: calc.daysLeft,
            milestone: calc.milestone,
            branch: p.lastName,
            titleEn: gone
              ? `${p.firstName} ${p.lastName}'s ${ordEn(calc.milestone)}Birth Anniversary`
              : `${p.firstName} ${p.lastName}'s ${ordEn(calc.milestone)}Birthday`,
            titleMr: gone
              ? `${p.firstNameMr || p.firstName} ${p.lastNameMr || p.lastName} यांची ${ordMr(calc.milestone,'वी')}जयंती`
              : `${p.firstNameMr || p.firstName} ${p.lastNameMr || p.lastName} यांचा ${ordMr(calc.milestone,'वा')}वाढदिवस`,
            dateLabel: formatDateLabel(calc.nextOcc)
          });
        }
      }
    });

    // 1b. Death anniversaries (punyatithi). Owner's call: shown as an alert in red,
    //     never exported to .ics and never given a "send wish" action.
    rawData.persons.forEach(p => {
      // The login placeholder reached the Sheet as a typed Death Date on a few records,
      // so it has to be screened here exactly as it is for birthdays — otherwise those
      // members get a 6 June remembrance for a day nobody died on.
      if (p.status === "deceased" && p.deathDate && !isUnknownBirthDate(p.deathDate)) {
        const startYear = parseInt(p.deathDate.split("-")[0]);
        const calc = calculateNextOccur(p.deathDate, startYear);
        if (calc) {
          occasions.push({
            id: `death_${p.id}`,
            person: p,
            type: "remembrance",
            isDeceased: true,
            dateStr: p.deathDate,
            daysLeft: calc.daysLeft,
            milestone: calc.milestone,
            branch: p.lastName,
            titleEn: `${p.firstName} ${p.lastName} — ${ordEn(calc.milestone)}Remembrance`,
            titleMr: `${p.firstNameMr || p.firstName} ${p.lastNameMr || p.lastName} यांची ${ordMr(calc.milestone,'वी')}पुण्यतिथी`,
            dateLabel: formatDateLabel(calc.nextOcc)
          });
        }
      }
    });

    // 2. Anniversaries
    rawData.relationships.forEach(r => {
      const wedDate = marriageDateOf(r);
      if (r.type === "marriage" && wedDate) {
        const p1 = rawData.persons.find(x => x.id === r.person1Id);
        const p2 = rawData.persons.find(x => x.id === r.person2Id);
        if (p1 && p2) {
          const startYear = parseInt(wedDate.split("-")[0]);
          const calc = calculateNextOccur(wedDate, startYear);
          if (calc) {
            const branch = p1.lastName || p2.lastName;
            const p1NameMr = p1.firstNameMr || p1.firstName.split(" ")[0];
            const p2NameMr = p2.firstNameMr || p2.firstName.split(" ")[0];
            // Same rule the birthday cards follow: once a spouse has died the couple's
            // date is a remembrance of the marriage. The card stays and can still be
            // added to a calendar; what it loses is the "Send Wish" button.
            const widowed = p1.status === "deceased" || p2.status === "deceased";

            occasions.push({
              id: r.id,
              relationship: r,
              person1: p1,
              person2: p2,
              type: "anniversary",
              isDeceased: widowed,
              dateStr: wedDate,
              daysLeft: calc.daysLeft,
              milestone: calc.milestone,
              branch: branch,
              titleEn: `${p1.firstName} & ${p2.firstName}'s ${ordEn(calc.milestone)}Anniversary`,
              titleMr: `${p1NameMr} आणि ${p2NameMr} यांचा ${ordMr(calc.milestone,'वा')}लग्नाचा वाढदिवस`,
              dateLabel: formatDateLabel(calc.nextOcc)
            });
          }
        }
      }
    });

    // Sort occasions by daysLeft
    occasions.sort((a, b) => a.daysLeft - b.daysLeft);
    window.CALENDAR_OCCASIONS = occasions;
    filterAndRenderList();
  }

  function filterAndRenderList() {
    const listEl = document.getElementById("calendar-list");
    if (!listEl || !window.CALENDAR_OCCASIONS) return;
    listEl.innerHTML = "";
    
    const filtered = window.CALENDAR_OCCASIONS.filter(occ => {
      // 1. Type
      if (activeCalType !== "all" && occ.type !== activeCalType) return false;

      // 2. Branch
      if (activeCalBranch !== "all") {
        if ((occ.type === "birthday" || occ.type === "remembrance") && occ.branch !== activeCalBranch) return false;
        if (occ.type === "anniversary") {
          const p1Branch = occ.person1.lastName === activeCalBranch;
          const p2Branch = occ.person2.lastName === activeCalBranch;
          if (!p1Branch && !p2Branch) return false;
        }
      }

      // 3. Search query
      if (calSearchQuery) {
        const query = calSearchQuery.toLowerCase();
        const enTitle = occ.titleEn.toLowerCase();
        const mrTitle = occ.titleMr.toLowerCase();
        if (!enTitle.includes(query) && !mrTitle.includes(query)) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="cal-empty">${window.CURRENT_LANG === "MR" ? "कोणतेही कार्यक्रम आढळले नाहीत." : "No occasions found."}</div>`;
      return;
    }

    filtered.forEach(occ => {
      const card = document.createElement("div");
      // A remembrance is styled in red and keeps the branch colour off the card, so it
      // never reads as a celebration alongside the birthdays it sits between.
      card.className = occ.type === "remembrance" ? "cal-event-card cal-remembrance" : "cal-event-card";

      card.style.setProperty('--branch-color', occ.type === "remembrance" ? "#9b2c2c" : getBranchColor(occ.branch));

      const isToday = occ.daysLeft === 0 || occ.daysLeft === 365;
      const countdownClass = isToday ? "cal-countdown today" : "cal-countdown";

      // 🎂 is wrong on any card for someone who has died — both the remembrance and the
      // birth anniversary of a deceased member.
      const todayIcon = occ.isDeceased ? "🕯" : "🎂";
      let countdownText = "";
      if (window.CURRENT_LANG === "MR") {
        countdownText = isToday ? `आज! ${todayIcon}` : `${mrDigits(occ.daysLeft)} दिवसात`;
      } else {
        countdownText = isToday ? `Today! ${todayIcon}` : `In ${occ.daysLeft} days`;
      }

      // mrDigits on the way out only — occ.titleMr itself stays ASCII for the .ics summary
      // and the search filter above.
      const title = window.CURRENT_LANG === "MR" ? mrDigits(occ.titleMr) : occ.titleEn;
      
      // Thumbnail representation
      let thumbHtml = "";
      if (occ.type === "birthday" || occ.type === "remembrance") {
        thumbHtml = getPersonThumbHtml(occ.person);
      } else {
        thumbHtml = `
          <div class="cal-card-thumb" style="position:relative; width:48px; height:48px; background:#eef1ea">
            <span style="font-size: 20px;">💑</span>
          </div>
        `;
      }

      const [dsYear, dsMonth, dsDay] = occ.dateStr.split("-");
      // The parenthetical spells out the original date, so it is only printed when that
      // date has a year. Otherwise it would read "(02/07/1900)" for a "2 July" the sheet
      // gave no year for.
      const fullDate = window.hasKnownYear(occ.dateStr) ? ` (${dsDay}/${dsMonth}/${dsYear})` : "";
      const dateText = window.CURRENT_LANG === "MR"
        ? mrDigits(`दिनांक: ${occ.dateLabel}${fullDate}`)
        : `Date: ${occ.dateLabel}${fullDate}`;

      // No "Send Wish" for anyone who has died — not on a remembrance, and not on a
      // birth anniversary either. A WhatsApp "Happy Birthday" to a deceased relative is
      // the single worst thing this calendar could do.
      const canWish = !occ.isDeceased;
      const wishText = canWish ? getWishMessage(occ) : "";
      const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(wishText)}`;

      const typeChip = occ.type === "remembrance"
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:12px; height:12px;"><path d="M12 3c1.5 2 3 3.5 3 5.5a3 3 0 0 1-6 0C9 6.5 10.5 5 12 3zM8 21h8M12 14v7"/></svg> ${window.CURRENT_LANG === "MR" ? "पुण्यतिथी" : "Remembrance"}`
        : occ.type === "birthday"
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:12px; height:12px;"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> ${occ.isDeceased ? (window.CURRENT_LANG === "MR" ? "जयंती" : "Birth Anniversary") : (window.CURRENT_LANG === "MR" ? "वाढदिवस" : "Birthday")}`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:12px; height:12px;"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12h8"/></svg> ${window.CURRENT_LANG === "MR" ? "लग्नाचा वाढदिवस" : "Anniversary"}`;

      // The marker the owner asked for: every card about a deceased member says so.
      const memorialChip = occ.isDeceased
        ? `<span class="cal-memorial-chip">🕯 ${window.CURRENT_LANG === "MR" ? "स्मरणार्थ" : "In Memory"}</span>`
        : "";

      card.innerHTML = `
        <div class="cal-card-top">
          ${thumbHtml}
          <div class="cal-card-meta">
            <h3 class="cal-card-name">${escapeHtml(title)}</h3>
            <div class="cal-card-type">${typeChip}${memorialChip}</div>
          </div>
          <div class="${countdownClass}">${countdownText}</div>
        </div>
        <p class="cal-card-details">${escapeHtml(dateText)}</p>
        <div class="cal-card-actions">
          ${!canWish ? "" : `
          <a class="cal-action-btn wish-btn" href="${whatsappUrl}" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px; height:14px;">
              <path d="M12.012 2c-5.506 0-9.989 4.478-9.99 9.984a9.96 9.96 0 0 0 1.333 4.966L2 22l5.222-1.37a9.954 9.954 0 0 0 4.79 1.222h.004c5.505 0 9.987-4.479 9.988-9.986.002-2.67-1.037-5.178-2.927-7.067C17.19 3.012 14.683 2 12.012 2zm5.72 13.916c-.244.686-1.42 1.26-1.95 1.343-.482.077-1.11.134-3.23-.746-2.716-1.125-4.464-3.896-4.6-4.077-.134-.18-1.096-1.458-1.096-2.781s.686-1.972.93-2.233c.244-.26 1.488-.26 1.626-.26.138 0 .285.01.408.03.122.02.285.04.448.43.163.39.57 1.385.62 1.484.05.1.08.21.01.34-.07.13-.105.21-.21.34l-.325.38c-.105.115-.215.24-.092.45.122.21.54.89 1.156 1.44.79.7 1.458.92 1.66 1.02.2.1.32.08.44-.06.12-.14.52-.61.66-.82.14-.2.285-.17.48-.1.196.07 1.238.58 1.452.69s.356.16.407.25c.052.09.052.53-.193 1.216z"/>
            </svg>
            <span>${window.CURRENT_LANG === "MR" ? "शुभेच्छा पाठवा" : "Send Wish"}</span>
          </a>`}
          <button class="cal-action-btn ics-single-btn" data-id="${occ.id}" data-type="${occ.type}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px; height:14px;">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            <span>.ics</span>
          </button>
        </div>
      `;

      // Both action buttons are conditional now, so this listener must not assume one.
      card.querySelector(".ics-single-btn")?.addEventListener("click", () => {
        downloadSingleICS(occ);
      });

      listEl.appendChild(card);
    });
  }

  // Supporting Helper Functions

  // The wedding date on a marriage relationship. The schema field is `startDate` and
  // that is the only one the Sheet → csv-import pipeline ever writes; the calendar and
  // the .ics export both used to read a `marriageDate` that no record has, so every
  // anniversary in the tree was silently invisible. `marriageDate` is still accepted
  // second for any hand-authored or GEDCOM-imported record that carries it.
  function marriageDateOf(r) {
    if (!r) return null;
    const d = r.startDate || r.marriageDate || null;
    // One screening point for every anniversary the app raises — card and .ics alike.
    return d && !isUnknownBirthDate(d) ? d : null;
  }

  // "40th " when the year behind the date is known, "" when it is not — so a card reads
  // "Aarti & Vishal's Anniversary" instead of inventing a number the data does not have.
  // The trailing space is part of the prefix so the noun still reads right without it.
  function ordEn(milestone) {
    return milestone == null ? "" : getOrdinal(milestone) + " ";
  }
  // Marathi puts the ordinal suffix on the digits (४०वा), and the suffix differs by the
  // gender of the noun that follows, so the caller passes it.
  function ordMr(milestone, suffix) {
    return milestone == null ? "" : `${milestone}${suffix} `;
  }

  function getOrdinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // Marathi has no separate short form in use here, so it serves both lengths.
  const MONTHS_SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG_EN  = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MONTHS_MR       = ["जानेवारी", "फेब्रुवारी", "मार्च", "एप्रिल", "मे", "जून", "जुलै", "ऑगस्ट", "सप्टेंबर", "ऑक्टोबर", "नोव्हेंबर", "डिसेंबर"];

  function formatDateLabel(date) {
    const months = window.CURRENT_LANG === "MR" ? MONTHS_MR : MONTHS_SHORT_EN;
    return `${date.getDate()} ${months[date.getMonth()]}`;
  }

  // A scrapbook entry is a dated moment, so unlike the calendar's formatDateLabel — which
  // omits the year because an occasion recurs every one — it spells the year out:
  // "1985-12-29" reads as "29 December 1985".
  //
  // Parsed off the ISO string rather than through `new Date(iso)`, which treats a bare date
  // as UTC midnight and would render the day before anywhere west of Greenwich. Anything
  // that is not a plain YYYY-MM-DD (a year alone, a hand-typed sheet value) is shown as it
  // was written rather than guessed at, and escaped — custom entries come from the Sheet.
  function formatScrapDate(raw) {
    const s = String(raw == null ? "" : raw);
    // A value we cannot parse — a bare year, a hand-typed sheet entry — is shown as written,
    // but its digits still localize so "1985" alone does not sit in ASCII next to a
    // "२९ डिसेंबर १९८५" above it. mrDigits runs BEFORE escapeHtml, never after: escapeHtml
    // emits &#39; for an apostrophe, and converting those digits would produce &#३९; and
    // break the entity.
    const asWritten = () => escapeHtml(window.CURRENT_LANG === "MR" ? mrDigits(s) : s);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return asWritten();
    const year = +m[1], monthIndex = +m[2] - 1, day = +m[3];
    if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return asWritten();
    if (window.CURRENT_LANG === "MR") {
      return `${mrDigits(day)} ${MONTHS_MR[monthIndex]} ${mrDigits(year)}`;
    }
    return `${day} ${MONTHS_LONG_EN[monthIndex]} ${year}`;
  }

  // Marathi writes its own numerals, so a date read in Marathi should be "२९ डिसेंबर १९८५",
  // not "29 डिसेंबर 1985" — half-translated.
  //
  // Only ever called on a string about to be displayed. The stored values keep ASCII digits
  // on purpose: occ.dateStr becomes the DTSTART of an .ics file, occ.titleMr becomes its
  // SUMMARY, and the occasion search box matches against titleMr — so a family member
  // typing "12" still finds the 12th anniversary.
  function mrDigits(value) {
    return String(value).replace(/[0-9]/g, d => "०१२३४५६७८९"[+d]);
  }

  function getWishMessage(occ) {
    if (occ.type === "birthday") {
      const name = occ.person.firstName;
      const nameMr = occ.person.firstNameMr || name;
      return window.CURRENT_LANG === "MR"
        ? `प्रिय ${nameMr}, वाढदिवसाच्या खूप खूप शुभेच्छा! 🎂 देव तुम्हाला उदंड आयुष्य देवो हीच प्रार्थना!`
        : `Happy Birthday, ${name}! 🎂 Wishing you a wonderful year ahead filled with joy, health, and success!`;
    } else {
      const name1 = occ.person1.firstName;
      const name2 = occ.person2.firstName;
      const name1Mr = occ.person1.firstNameMr || name1;
      const name2Mr = occ.person2.firstNameMr || name2;
      return window.CURRENT_LANG === "MR"
        ? `प्रिय ${name1Mr} आणि ${name2Mr}, लग्नाच्या वाढदिवसाच्या हार्दिक शुभेच्छा! 💑 तुमची जोडी अशीच कायम आनंदी राहो हीच प्रार्थना!`
        : `Happy Wedding Anniversary, ${name1} & ${name2}! 💑 Wishing you both a lifetime of love and happiness together!`;
    }
  }

  function getPersonThumbHtml(p) {
    const cl = "cal-card-thumb";
    if (p.profilePhoto) {
      // Used as-is, exactly like thumbHtml does for the tree nodes. This used to prepend
      // `window.PHOTO_BASE_URL || "Family/Cropped/"`, but photos live in R2 and family.json
      // stores absolute https://pub-….r2.dev/… URLs, so the prefix produced
      // "Family/Cropped/https://…" and broke every calendar photo. PHOTO_BASE_URL was never
      // defined anywhere either, so the fallback always won — and Family/ is gitignored and
      // never deployed, so there was nothing behind it to find.
      return `<img src="${escapeHtml(p.profilePhoto)}" class="${cl}" alt="" loading="lazy"${photoFallbackAttr()}>`;
    }
    return `<img src="${DEFAULT_PHOTO}" class="${cl}" alt="" loading="lazy" data-default-photo="1">`;
  }

  // DTSTART for a yearly event. A date the sheet gave no year for is stamped
  // UNKNOWN_YEAR, and starting the series there makes a calendar client materialise a
  // century of past occurrences before it reaches today. The recurrence is what matters,
  // not the origin, so an undated series starts at its next real occurrence.
  function icsDateFor(dateStr) {
    if (window.hasKnownYear(dateStr)) return String(dateStr).replace(/-/g, "");
    const calc = calculateNextOccur(dateStr, null);
    if (!calc) return String(dateStr).replace(/-/g, "");
    const d = calc.nextOcc;
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }

  function downloadSingleICS(occ) {
    let dateStr = icsDateFor(occ.dateStr);
    let summary = window.CURRENT_LANG === "MR" ? occ.titleMr : occ.titleEn;
    // A remembrance carries `person`, not `person1`/`person2`, and the old ternary
    // reached straight for `occ.person1.firstName` on anything that was not a birthday.
    let desc;
    if (occ.type === "remembrance") {
      desc = `Remembrance for ${occ.person.firstName} ${occ.person.lastName}`;
    } else if (occ.type === "birthday") {
      desc = occ.isDeceased
        ? `Birth anniversary of ${occ.person.firstName}`
        : `Birthday celebration for ${occ.person.firstName}`;
    } else {
      desc = `Wedding Anniversary for ${occ.person1.firstName} & ${occ.person2.firstName}`;
    }
    let uid = `${occ.type}_${occ.id}@familytree`;

    let icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//The Family Tree//NONSGML Calendar//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
      `DTSTART;VALUE=DATE:${dateStr}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${desc}`,
      "RRULE:FREQ=YEARLY",
      "END:VEVENT",
      "END:VCALENDAR"
    ];

    const blob = new Blob([icsContent.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${summary.toLowerCase().replace(/[^a-z0-9]/g, "_")}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function exportToICS() {
    const rawData = window.FAMILY_DATA || window.FAMILY;
    if (!rawData) return;
    
    let icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//The Family Tree//NONSGML Calendar//EN",
      "CALSCALE:GREGORIAN"
    ];
    
    const events = [];
    
    // 1. Birthdays. Living members only, and never the 1674-06-06 login placeholder.
    //    A deceased member's date reaches the feed through section 3 as a remembrance,
    //    so it is never phrased as a birthday here.
    rawData.persons.forEach(p => {
      if (p.status !== "deceased" && p.birthDate && !isUnknownBirthDate(p.birthDate)) {
        const dateStr = icsDateFor(p.birthDate);
        const name = p.name || `${p.firstName} ${p.lastName}`;
        const nameMr = (window.CURRENT_LANG === "MR" && p.firstNameMr && p.lastNameMr) ? `${p.firstNameMr} ${p.lastNameMr}` : name;
        const displayName = window.CURRENT_LANG === "MR" ? nameMr : name;
        
        events.push({
          uid: `birth_${p.id}@familytree`,
          start: dateStr,
          summary: window.CURRENT_LANG === "MR" ? `🎂 ${displayName} - वाढदिवस` : `🎂 ${displayName}'s Birthday`,
          description: `Family Tree birthday anniversary for ${displayName}`
        });
      }
    });
    
    // 2. Anniversaries. Two bugs lived here: the date was read from `marriageDate`,
    //    which the pipeline never writes, and `start` referenced a `dateStr` that only
    //    exists inside the birthday callback above — so the day this block ever did run
    //    it would have thrown a ReferenceError instead of exporting anything.
    rawData.relationships.forEach(r => {
      const wedDate = marriageDateOf(r);
      if (r.type === "marriage" && wedDate) {
        const p1 = rawData.persons.find(x => x.id === r.person1Id);
        const p2 = rawData.persons.find(x => x.id === r.person2Id);
        if (p1 && p2 && p1.status !== "deceased" && p2.status !== "deceased") {
          const dateStr = icsDateFor(wedDate);
          const name1Mr = (window.CURRENT_LANG === "MR" && p1.firstNameMr) ? p1.firstNameMr : p1.firstName.split(" ")[0];
          const name2Mr = (window.CURRENT_LANG === "MR" && p2.firstNameMr) ? p2.firstNameMr : p2.firstName.split(" ")[0];

          const displayName = window.CURRENT_LANG === "MR"
            ? `${name1Mr} आणि ${name2Mr}`
            : `${p1.firstName} & ${p2.firstName}`;

          events.push({
            uid: `marriage_${r.id}@familytree`,
            start: dateStr,
            summary: window.CURRENT_LANG === "MR" ? `💑 ${displayName} - लग्नाचा वाढदिवस` : `💑 ${displayName}'s Wedding Anniversary`,
            description: `Family Tree wedding anniversary for ${displayName}`
          });
        }
      }
    });

    // 3. Remembrances (punyatithi). A quiet yearly reminder is the whole point of the
    //    date, so it belongs in the feed — what a deceased member must never get is a
    //    "Send Wish" button, and that stays suppressed on the card.
    rawData.persons.forEach(p => {
      // Same screen as the on-screen remembrance card: a placeholder death date writes
      // no .ics event.
      if (p.status === "deceased" && p.deathDate && !isUnknownBirthDate(p.deathDate)) {
        const dateStr = icsDateFor(p.deathDate);
        const name = p.name || `${p.firstName} ${p.lastName}`;
        const nameMr = (p.firstNameMr && p.lastNameMr) ? `${p.firstNameMr} ${p.lastNameMr}` : name;
        const displayName = window.CURRENT_LANG === "MR" ? nameMr : name;

        events.push({
          uid: `death_${p.id}@familytree`,
          start: dateStr,
          summary: window.CURRENT_LANG === "MR" ? `🕯 ${displayName} - पुण्यतिथी` : `🕯 ${displayName} — Remembrance`,
          description: `Family Tree remembrance for ${displayName}`
        });
      }
    });

    events.forEach(e => {
      icsContent.push("BEGIN:VEVENT");
      icsContent.push(`UID:${e.uid}`);
      icsContent.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`);
      icsContent.push(`DTSTART;VALUE=DATE:${e.start}`);
      icsContent.push(`SUMMARY:${e.summary}`);
      icsContent.push(`DESCRIPTION:${e.description}`);
      icsContent.push("RRULE:FREQ=YEARLY");
      icsContent.push("END:VEVENT");
    });
    
    icsContent.push("END:VCALENDAR");
    
    const blob = new Blob([icsContent.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `family_occasions_${window.CURRENT_LANG.toLowerCase()}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Setup search input and filter buttons listeners
  const calSearchInput = document.getElementById("cal-search-input");
  if (calSearchInput) {
    calSearchInput.addEventListener("input", (e) => {
      calSearchQuery = e.target.value;
      filterAndRenderList();
    });
  }

  document.querySelectorAll(".cal-type-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cal-type-btn").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      activeCalType = btn.dataset.type;
      filterAndRenderList();
    });
  });

  const exportAllBtn = document.getElementById("cal-export-all-btn");
  if (exportAllBtn) {
    exportAllBtn.addEventListener("click", exportToICS);
  }

  /* ============================================================
     INIT
     ============================================================ */
  function init() {
    renderLines();
    renderNodes();
    renderTags();
    generateStars();
    // Initial view: center on Me at a comfortable fixed scale.
    // Ancestors (parents are visible just above, grandparents/great-grandparents
    // require panning up) stay outside the chrome zone naturally.
    setTimeout(() => {
      const isMobile = window.innerWidth <= 768;
      panToPerson(ME, { scale: isMobile ? 1.0 : 0.95 });
    }, 80);
  }

  function generateStars() {
    const layer = document.getElementById("stars");
    if (!layer) return;
    const count = 80;
    for (let i = 0; i < count; i++) {
      const s = document.createElement("span");
      s.className = "star";
      s.style.left = (Math.random() * 100) + "%";
      s.style.top  = (Math.random() * 65) + "%";
      const size = 1.2 + Math.random() * 1.8;
      s.style.width = s.style.height = size + "px";
      s.style.animationDelay = (-Math.random() * 3) + "s";
      s.style.animationDuration = (2 + Math.random() * 2.5) + "s";
      layer.appendChild(s);
    }
  }
  /* ============================================================
     PHOTO EDITOR — own profile + background
     ------------------------------------------------------------
     Crops to a fixed frame, re-encodes to WebP, POSTs to the Cloudflare
     Worker (worker/photo-upload.js), which writes the object to R2.

     Fixed R2 keys (profile_<id>.webp / background_<id>.webp) mean a re-upload
     overwrites in place, so storage stays at two objects per person. The Worker
     sets Cache-Control: max-age=60; we append ?t= locally so the person who just
     uploaded sees their change immediately rather than waiting out that minute.

     No cropper library: CLAUDE.md rule 1 forbids CDNs and rule 6 forbids a fifth
     runtime file, so the pan/zoom is hand-rolled on a canvas below.
     ============================================================ */

  const PHOTO_KINDS = {
    profile:    { field: "profilePhoto",    title: "Update your profile photo" },
    background: { field: "backgroundPhoto", title: "Update your cover photo" }
  };

  // Crop state for the open session. `img` is the decoded source bitmap; offsetX/Y
  // and zoom describe which part of it the fixed frame is showing.
  const photoEditor = {
    kind: null, img: null, zoom: 1, minZoom: 1,
    offsetX: 0, offsetY: 0, dragging: false, lastX: 0, lastY: 0, busy: false
  };

  // Self-service DOB edit. Much lighter than photoEditor — one field, no crop
  // stage — but the save must also update the login hash, since identity is
  // SHA-256(name + DDMMYYYY). See saveDob().
  const dobEditor = { busy: false };

  function photoConfig() {
    return window.PHOTO_CONFIG || {};
  }

  // Editing is possible only when a Worker is configured AND the open profile is
  // the logged-in member's own. Both halves matter: without the first the button
  // would do nothing, without the second it would offer an action the Worker rejects.
  function canEditPhotos(personId) {
    const cfg = photoConfig();
    return Boolean(
      cfg.workerUrl &&
      window.CURRENT_IDENTITY &&
      window.CURRENT_IDENTITY.hash &&
      personId === ME &&
      window.CURRENT_IDENTITY.personId === ME
    );
  }

  function targetSize(kind) {
    const cfg = photoConfig();
    if (kind === "background") {
      return { w: cfg.backgroundW || 1600, h: cfg.backgroundH || 534 };
    }
    return { w: cfg.profilePx || 800, h: cfg.profilePx || 800 };
  }

  function pmEl(id) { return document.getElementById(id); }

  function showPhotoError(msg) {
    const el = pmEl("pm-error");
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function openPhotoEditor(kind) {
    if (!PHOTO_KINDS[kind] || !canEditPhotos(ME)) return;
    photoEditor.kind = kind;
    photoEditor.img = null;
    photoEditor.busy = false;

    pmEl("pm-title").textContent = PHOTO_KINDS[kind].title;
    const size = targetSize(kind);
    pmEl("pm-hint").textContent =
      `Drag to reposition · pinch or use the slider to zoom · saved at ${size.w}×${size.h}`;
    pmEl("pm-drop-sub").textContent =
      `or drag one here · JPEG, PNG or WebP up to ${photoConfig().maxUploadMB || 5} MB`;

    pmEl("pm-pick").hidden = false;
    pmEl("pm-crop").hidden = true;
    pmEl("pm-rechoose").hidden = true;
    pmEl("pm-save").disabled = true;
    pmEl("pm-save").textContent = "Save photo";
    pmEl("pm-file").value = "";
    showPhotoError("");
    pmEl("photo-modal").hidden = false;
    pmEl("pm-drop").focus();
  }

  function closePhotoEditor() {
    if (photoEditor.busy) return;   // don't abandon an upload mid-flight
    const modal = pmEl("photo-modal");
    if (modal) modal.hidden = true;
    if (photoEditor.img && photoEditor.img.close) photoEditor.img.close();
    photoEditor.img = null;
    photoEditor.kind = null;
  }

  async function loadPhotoFile(file) {
    if (!file) return;
    const cfg = photoConfig();
    const allowed = cfg.allowedTypes || ["image/jpeg", "image/png", "image/webp"];
    const maxBytes = (cfg.maxUploadMB || 5) * 1024 * 1024;

    if (!allowed.includes(file.type)) {
      // HEIC is the common case here — iPhones shoot it by default and no browser
      // engine but Safari can decode it. Say so specifically instead of "wrong type".
      const isHeic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
      showPhotoError(isHeic
        ? "iPhone HEIC photos can't be read by this browser. On your iPhone open Settings → Camera → Formats and choose “Most Compatible”, then take the photo again — or send the photo to yourself on WhatsApp and pick the copy it saves."
        : "Please choose a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > maxBytes) {
      showPhotoError(`That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${cfg.maxUploadMB || 5} MB.`);
      return;
    }

    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (err) {
      showPhotoError("That image could not be opened. Try a different photo.");
      return;
    }

    showPhotoError("");
    photoEditor.img = bitmap;
    setupCropStage();
    pmEl("pm-pick").hidden = true;
    pmEl("pm-crop").hidden = false;
    pmEl("pm-rechoose").hidden = false;
    pmEl("pm-save").disabled = false;
  }

  function setupCropStage() {
    const canvas = pmEl("pm-canvas");
    const size = targetSize(photoEditor.kind);
    // Size the frame to the space actually available rather than a fixed width.
    // A fixed width lets CSS max-width shrink it on a phone while the inline height
    // stays put — which squashed the square crop into a tall rectangle (and the
    // circular mask into an ellipse). The export re-renders at the full target size,
    // so what you see here is the same framing at a lower resolution.
    const body = pmEl("pm-crop");
    const avail = Math.max(200, Math.floor(body.clientWidth - 40));
    const displayW = Math.min(size.w, 480, avail);
    const displayH = Math.round(displayW * (size.h / size.w));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(displayW * dpr);
    canvas.height = Math.round(displayH * dpr);
    canvas.style.width = displayW + "px";
    canvas.style.height = displayH + "px";

    // Start at "cover": the smallest zoom that still fills the frame, centred.
    const img = photoEditor.img;
    photoEditor.minZoom = Math.max(displayW / img.width, displayH / img.height);
    photoEditor.zoom = photoEditor.minZoom;
    photoEditor.offsetX = (displayW - img.width * photoEditor.zoom) / 2;
    photoEditor.offsetY = (displayH - img.height * photoEditor.zoom) / 2;

    const zoomInput = pmEl("pm-zoom");
    zoomInput.min = String(photoEditor.minZoom);
    zoomInput.max = String(photoEditor.minZoom * 4);
    zoomInput.step = String(photoEditor.minZoom / 100);
    zoomInput.value = String(photoEditor.zoom);

    drawCropStage();
  }

  // Keep the image covering the frame at all times, so no crop can include blank space.
  function clampOffsets(frameW, frameH) {
    const img = photoEditor.img;
    const w = img.width * photoEditor.zoom;
    const h = img.height * photoEditor.zoom;
    photoEditor.offsetX = Math.min(0, Math.max(frameW - w, photoEditor.offsetX));
    photoEditor.offsetY = Math.min(0, Math.max(frameH - h, photoEditor.offsetY));
  }

  function drawCropStage() {
    const canvas = pmEl("pm-canvas");
    if (!canvas || !photoEditor.img) return;
    const dpr = window.devicePixelRatio || 1;
    const frameW = canvas.width / dpr;
    const frameH = canvas.height / dpr;
    clampOffsets(frameW, frameH);

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, frameW, frameH);
    ctx.drawImage(
      photoEditor.img,
      photoEditor.offsetX, photoEditor.offsetY,
      photoEditor.img.width * photoEditor.zoom,
      photoEditor.img.height * photoEditor.zoom
    );

    // A circular mask on the avatar crop, so the framing shown matches the round
    // avatar the photo will actually appear in.
    if (photoEditor.kind === "profile") {
      ctx.save();
      ctx.fillStyle = "rgba(20,12,5,0.45)";
      ctx.beginPath();
      ctx.rect(0, 0, frameW, frameH);
      ctx.arc(frameW / 2, frameH / 2, Math.min(frameW, frameH) / 2, 0, Math.PI * 2, true);
      ctx.fill("evenodd");
      ctx.restore();
    }
  }

  // Render the visible region again at full target resolution and encode it.
  // WebP is ~6x smaller than the PNGs the Form pipeline produced; if the browser
  // can't encode it (very old Safari) toBlob hands back a PNG, and we retry as JPEG.
  function exportCrop() {
    const size = targetSize(photoEditor.kind);
    const canvas = pmEl("pm-canvas");
    const dpr = window.devicePixelRatio || 1;
    const scale = size.w / (canvas.width / dpr);

    const out = document.createElement("canvas");
    out.width = size.w;
    out.height = size.h;
    const ctx = out.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      photoEditor.img,
      photoEditor.offsetX * scale, photoEditor.offsetY * scale,
      photoEditor.img.width * photoEditor.zoom * scale,
      photoEditor.img.height * photoEditor.zoom * scale
    );

    const quality = photoConfig().webpQuality || 0.82;
    return new Promise(resolve => {
      out.toBlob(blob => {
        if (blob && blob.type === "image/webp") return resolve(blob);
        out.toBlob(jpeg => resolve(jpeg), "image/jpeg", quality);
      }, "image/webp", quality);
    });
  }

  async function savePhoto() {
    if (!photoEditor.img || photoEditor.busy) return;
    const kind = photoEditor.kind;
    const cfg = photoConfig();
    const saveBtn = pmEl("pm-save");

    photoEditor.busy = true;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    showPhotoError("");

    try {
      const blob = await exportCrop();
      if (!blob) throw new Error("Could not encode the image");

      const res = await fetch(cfg.workerUrl.replace(/\/+$/, "") + "/photo", {
        method: "POST",
        headers: {
          "Content-Type": blob.type,
          "X-Person-Id": ME,
          "X-Photo-Kind": kind,
          "X-Identity-Hash": window.CURRENT_IDENTITY.hash
        },
        body: blob
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Upload failed (${res.status})`);

      // Cache-Control is 60s, so bust it locally for the person who just uploaded.
      const freshUrl = payload.url + "?t=" + Date.now();
      const person = F.byId[ME];
      if (person) {
        if (kind === "profile") person.photo = freshUrl;
        else person.backgroundPhoto = freshUrl;
      }
      applyPhotoToDom(kind, freshUrl);

      photoEditor.busy = false;
      closePhotoEditor();

      if (payload.warning) {
        // The object reached R2 but family.json didn't get updated. Say so rather
        // than reporting a clean success the data doesn't back up.
        alert(payload.warning);
      }
    } catch (err) {
      photoEditor.busy = false;
      saveBtn.disabled = false;
      saveBtn.textContent = "Save photo";
      showPhotoError(err.message || "Upload failed. Please try again.");
    }
  }

  // Repaint the open profile panel (and the tree node) without a reload.
  function applyPhotoToDom(kind, url) {
    if (kind === "profile") {
      const holder = document.getElementById("lb-profile-photo");
      if (holder) {
        holder.innerHTML = "";
        const img = document.createElement("img");
        img.src = url;
        holder.appendChild(img);
      }
      document.querySelectorAll(`.node[data-id="${CSS.escape(ME)}"] .node-thumb`).forEach(el => {
        el.innerHTML = `<img src="${escapeHtml(url)}" alt="" loading="lazy">`;
        el.style.background = "";
      });
    } else {
      const coverMedia = document.getElementById("lb-cover-media");
      if (coverMedia) {
        coverMedia.innerHTML = "";
        const img = document.createElement("img");
        img.className = "lb-cover-img";
        img.src = url;
        img.dataset.viewerSrc = url;
        coverMedia.appendChild(img);
      }
    }
  }

  // Same gate as photos — own profile, Worker configured — because /dob lives on
  // the same Worker as /photo and shares its identity check.
  function canEditDob(personId) {
    return canEditPhotos(personId);
  }

  function renderDobEditor(p) {
    const wrap = pmEl("lb-dob-edit");
    if (!wrap) return;
    if (!canEditDob(p.id)) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    pmEl("lb-dob-form").hidden = true;
    pmEl("lb-dob-note").hidden = true;
    showDobError("");
    pmEl("lb-dob-edit-label").textContent = p.hasBirthYear
      ? "Edit date of birth" : "Add your date of birth";
    pmEl("lb-dob-input").value = p.hasBirthYear ? p.birthDate : "";
  }

  function showDobError(msg) {
    const el = pmEl("lb-dob-error");
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  async function saveDob() {
    if (dobEditor.busy) return;
    const input = pmEl("lb-dob-input");
    const saveBtn = pmEl("lb-dob-save");
    const value = input.value; // "YYYY-MM-DD" from <input type="date">
    if (!value) { showDobError("Please choose a date."); return; }

    dobEditor.busy = true;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    showDobError("");

    try {
      const cfg = photoConfig();
      const res = await fetch(cfg.workerUrl.replace(/\/+$/, "") + "/dob", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Person-Id": ME,
          "X-Identity-Hash": window.CURRENT_IDENTITY.hash
        },
        body: JSON.stringify({ birthDate: value })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Save failed (${res.status})`);

      // The login hash is derived from name+DOB, so it just changed. Keep the
      // current session working with the new hash; next login needs the new date.
      window.CURRENT_IDENTITY.hash = payload.hash;

      const person = F.byId[ME];
      if (person) {
        person.birthDate = value;
        person.hasBirthYear = !window.isUnknownBirthDate(value);
        person.birth = parseInt(value.split("-")[0], 10);
        renderBioTab(person);   // rebuilds #lb-facts and re-renders this editor
        renderLifeLine(person); // header "b. <year> · N years" line
      }

      pmEl("lb-dob-note").hidden = false;
      if (payload.warning) alert(payload.warning);
    } catch (err) {
      showDobError(err.message || "Could not save. Please try again.");
    } finally {
      dobEditor.busy = false;
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  }

  function bindDobEditor() {
    const wrap = pmEl("lb-dob-edit");
    if (!wrap) return;
    const form = pmEl("lb-dob-form");

    pmEl("lb-dob-edit-btn").addEventListener("click", () => {
      pmEl("lb-dob-note").hidden = true;
      form.hidden = false;
      pmEl("lb-dob-input").focus();
    });
    pmEl("lb-dob-cancel").addEventListener("click", () => {
      form.hidden = true;
      showDobError("");
    });
    form.addEventListener("submit", e => {
      e.preventDefault();
      saveDob();
    });
  }

  function bindPhotoEditor() {
    const modal = pmEl("photo-modal");
    if (!modal) return;

    pmEl("lb-edit-avatar").addEventListener("click", () => openPhotoEditor("profile"));
    pmEl("lb-edit-cover").addEventListener("click", () => openPhotoEditor("background"));
    pmEl("pm-close").addEventListener("click", closePhotoEditor);
    pmEl("pm-cancel").addEventListener("click", closePhotoEditor);
    modal.addEventListener("click", e => { if (e.target === modal) closePhotoEditor(); });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !modal.hidden) closePhotoEditor();
    });

    const drop = pmEl("pm-drop");
    const fileInput = pmEl("pm-file");
    drop.addEventListener("click", () => fileInput.click());
    drop.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
    });
    fileInput.addEventListener("change", e => loadPhotoFile(e.target.files[0]));
    ["dragenter", "dragover"].forEach(ev =>
      drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("is-dragover"); }));
    ["dragleave", "drop"].forEach(ev =>
      drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("is-dragover"); }));
    drop.addEventListener("drop", e => loadPhotoFile(e.dataTransfer.files[0]));

    pmEl("pm-rechoose").addEventListener("click", () => {
      pmEl("pm-pick").hidden = false;
      pmEl("pm-crop").hidden = true;
      pmEl("pm-rechoose").hidden = true;
      pmEl("pm-save").disabled = true;
      pmEl("pm-file").value = "";
      showPhotoError("");
    });
    pmEl("pm-save").addEventListener("click", savePhoto);

    pmEl("pm-zoom").addEventListener("input", e => {
      if (!photoEditor.img) return;
      const canvas = pmEl("pm-canvas");
      const dpr = window.devicePixelRatio || 1;
      const frameW = canvas.width / dpr, frameH = canvas.height / dpr;
      const prev = photoEditor.zoom;
      photoEditor.zoom = Number(e.target.value);
      // Zoom about the frame centre so the subject doesn't drift off-frame.
      const ratio = photoEditor.zoom / prev;
      photoEditor.offsetX = frameW / 2 - (frameW / 2 - photoEditor.offsetX) * ratio;
      photoEditor.offsetY = frameH / 2 - (frameH / 2 - photoEditor.offsetY) * ratio;
      drawCropStage();
    });

    // Pointer events cover mouse and touch in one path — the app is mostly used
    // on phones, so the drag must work with a finger.
    const canvas = pmEl("pm-canvas");
    canvas.addEventListener("pointerdown", e => {
      if (!photoEditor.img) return;
      photoEditor.dragging = true;
      photoEditor.lastX = e.clientX;
      photoEditor.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", e => {
      if (!photoEditor.dragging) return;
      // Offsets live in frame units. If CSS ever renders the canvas at a different
      // size than the frame, a raw client delta would drag at the wrong speed.
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const k = rect.width ? (canvas.width / dpr) / rect.width : 1;
      photoEditor.offsetX += (e.clientX - photoEditor.lastX) * k;
      photoEditor.offsetY += (e.clientY - photoEditor.lastY) * k;
      photoEditor.lastX = e.clientX;
      photoEditor.lastY = e.clientY;
      drawCropStage();
    });
    ["pointerup", "pointercancel"].forEach(ev =>
      canvas.addEventListener(ev, e => {
        photoEditor.dragging = false;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      }));
  }

  bindPhotoEditor();
  bindDobEditor();
  init();
  window.addEventListener("resize", () => updateMinimap());
};
