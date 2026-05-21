/* ============================================================
   THE FAMILY TREE — Canvas app
   ============================================================ */
(function () {
  const F = window.FAMILY;
  const ME = F.ME;

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
     INITIALS HELPER
     ============================================================ */
  function initials(name) {
    return name.split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();
  }
  function thumbHtml(p, cls) {
    const cl = cls || "node-thumb";
    if (p.photo) return `<div class="${cl}"><img src="${p.photo}" alt=""></div>`;
    // Choose a soft warm tone for the bubble based on a hash of the id
    const palette = ["#7AAD7A","#A5D6A7","#9EBE9C","#C9B98E","#E0AB73","#D9886B","#B79774"];
    const idx = Math.abs(hashCode(p.id)) % palette.length;
    return `<div class="${cl}" style="background:${palette[idx]}">${initials(p.name)}</div>`;
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

  window.updateLanguage = function (lang) {
    window.CURRENT_LANG = lang;
    F.people.forEach(p => {
      const el = nodesById[p.id];
      if (el) {
        const nameDiv = el.querySelector(".node-name");
        if (nameDiv) {
          nameDiv.innerHTML = escapeHtml(getNodeDisplayName(p, lang));
        }
      }
    });
    if (lightbox.classList.contains("open") && currentPersonId) {
      const p = F.byId[currentPersonId];
      if (p) {
        const modalDisplayName = (lang === "MR" && p.nameMr) ? p.nameMr : p.name;
        document.getElementById("lb-name").innerHTML =
          escapeHtml(modalDisplayName) + (p.deceased ? '<span class="leaf" title="In memory"></span>' : "");
      }
    }
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
        ${p.me ? `<div class="node-tag-me">You</div>` : ""}
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
  function renderTags() {
    tagsRow.innerHTML = "";
    F.TAGS.forEach(tag => {
      const matches = F.tagMatches(ME, tag);
      const el = document.createElement("button");
      el.className = "tag" + (matches.length === 0 ? " disabled" : "");
      el.dataset.tag = tag;
      el.innerHTML = `${tag} <span class="tag-count">${matches.length}</span>`;
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
    statusBC.innerHTML = `<span>Filtering:</span> <span class="bc-name">${activeFilter}</span> <span style="opacity:.7">· ${n} ${n === 1 ? "match" : "matches"}</span>`;
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
        const label = id === ME ? "Me" : (i === path.length - 1 ? p.name.split(" ")[0] : shortRelative(id, path[Math.max(0, i - 1)]));
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
    if (!p || !prev) return p.name.split(" ")[0];
    if (prev.spouse === id) return p.gender === "m" ? "Husband" : "Wife";
    if (prev.parents.includes(id)) return p.gender === "m" ? "Father" : "Mother";
    if (prev.children.includes(id)) return p.gender === "m" ? "Son" : "Daughter";
    if (prev.siblings && prev.siblings.includes(id)) return p.gender === "m" ? "Brother" : "Sister";
    return p.name.split(" ")[0];
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
    if (animate) {
      setTimeout(() => world.classList.remove("animating"), 650);
    }
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
     LIGHTBOX
     ============================================================ */
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
    relEl.textContent = id === ME ? "This is you" : rel;
    relEl.classList.toggle("is-me", id === ME);

    const life = document.getElementById("lb-life");
    const lifeParts = [];
    lifeParts.push(p.birth ? `b. ${p.birth}` : "");
    if (p.deceased && p.death) lifeParts.push(`d. ${p.death}`);
    else if (!p.deceased && p.birth) {
      const age = 2026 - p.birth;
      lifeParts.push(`${age} years`);
    }
    if (p.altNames && p.altNames.length) lifeParts.push("“" + p.altNames[0] + "”");
    life.innerHTML = lifeParts.filter(Boolean).map((s, i, arr) =>
      i < arr.length - 1 ? s + '<span class="sep"></span>' : s
    ).join("");

    document.getElementById("lb-bio").textContent = p.bio || "";

    // Profile + cover photo
    const photoEl = document.getElementById("lb-profile-photo");
    photoEl.innerHTML = "";
    if (p.photo) {
      const img = document.createElement("img"); img.src = p.photo;
      photoEl.appendChild(img);
    } else {
      photoEl.textContent = initials(p.name);
    }
    const cover = document.getElementById("lb-cover");
    cover.querySelectorAll(".lb-cover-img").forEach(el => el.remove());
    // Soft sunset-toned cover. If person has a photo, show it blurred behind too.
    if (p.photo) {
      const img = document.createElement("img");
      img.className = "lb-cover-img";
      img.src = p.photo;
      img.style.filter = "blur(8px) saturate(1.05)";
      img.style.transform = "scale(1.1)";
      cover.insertBefore(img, photoEl);
    }
    // Tonal palette varies by person to give each profile a slight identity
    const tones = [
      ["#ffd9a8","#f6a96b","#b85a2a"],
      ["#d9eedd","#a5d6a7","#2d7a2d"],
      ["#f1e1c2","#d9b48a","#8a5a36"],
      ["#fbe1d2","#e6a48b","#a05a3c"],
      ["#e6dfca","#c9b98e","#7a6a4a"]
    ];
    const t = tones[Math.abs(hashCode(p.id)) % tones.length];
    cover.style.background = `linear-gradient(135deg, ${t[0]} 0%, ${t[1]} 45%, ${t[2]} 100%)`;

    // Quick relations row — show spouse, parents, children if any
    const rels = [];
    if (p.spouse)             rels.push({ id: p.spouse, label: p.gender === "m" ? "Wife" : "Husband" });
    (p.parents || []).forEach(pid => {
      const par = F.byId[pid]; if (par) rels.push({ id: pid, label: par.gender === "m" ? "Father" : "Mother" });
    });
    (p.children || []).forEach(cid => {
      const c = F.byId[cid]; if (c) rels.push({ id: cid, label: c.gender === "m" ? "Son" : "Daughter" });
    });
    (p.siblings || []).slice(0, 3).forEach(sid => {
      const s = F.byId[sid]; if (s) rels.push({ id: sid, label: s.gender === "m" ? "Brother" : "Sister" });
    });
    const relsEl = document.getElementById("lb-relations");
    relsEl.innerHTML = rels.slice(0, 6).map(r => {
      const rp = F.byId[r.id];
      return `<button class="lb-rel-chip" data-id="${r.id}">
        ${thumbHtml(rp, "lrc-thumb")}
        <span class="lrc-rel">${r.label}</span>
        <span>${escapeHtml(rp.name.split(" ")[0])}</span>
      </button>`;
    }).join("");
    relsEl.querySelectorAll(".lb-rel-chip").forEach(el => {
      el.addEventListener("click", () => {
        const targetId = el.dataset.id;
        closeLightbox();
        setTimeout(() => openPerson(targetId), 280);
      });
    });

    // Timeline title
    document.getElementById("lb-timeline-title").textContent = id === ME
      ? "Your Scrapbook" : `${p.name.split(" ")[0]}'s Scrapbook`;

    // Scrapbook
    const list = document.getElementById("lb-timeline-list");
    list.innerHTML = "";
    const entries = F.scrapbook[id] || [];
    if (!entries.length) {
      list.innerHTML = `<div class="scrap-empty">The scrapbook is still waiting for stories.<br>Tap + on the canvas to add a memory.</div>`;
    } else {
      entries.forEach(e => {
        const card = document.createElement("div");
        card.className = "scrap-card";
        const photos = (e.photos || []).slice(0, 3);
        const photosHtml = photos.length ? `
          <div class="scrap-photos count-${photos.length}">
            ${photos.map(ph => `
              <div class="scrap-photo ${ph ? "has-photo" : ""}">
                ${ph ? `<img src="${ph}" alt="">` : `
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
                <span>${escapeHtml(tp.name.split(" ")[0])}</span>
              </button>`;
            }).join("")}
          </div>` : "";
        card.innerHTML = `
          <div class="scrap-date">${e.date}</div>
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
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (lightbox.classList.contains("open")) closeLightbox();
      else if (pathTargetId) clearPath();
      else if (activeFilter) clearFilter();
    }
  });

  /* ============================================================
     MOBILE NAV
     ============================================================ */
  document.querySelectorAll(".mnav-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".mnav-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      const k = b.dataset.nav;
      if (k === "search") setTimeout(() => search.focus(), 60);
      else if (k === "profile" || k === "timeline") openPerson(ME);
      else if (k === "tree") centerOnMe();
    });
  });

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
  init();
  window.addEventListener("resize", () => updateMinimap());
})();
