/* ============================================================
   FAMILY TREE DATA
   ----------------------------------------------------------------
   A connected graph spanning four generations of the
   Sathawane / Khedkar / Waghmare / Deshpande / Joshi / Pawar family.
   The logged-in user (`me: true`) is Manisha Waghmare.
   Relationship labels are computed live by relationship.js from the
   graph itself — never hardcoded per person.
   ============================================================ */

window.FAMILY = (function () {

  // --- People: { id, name, gender, birth, death, deceased, bio, photo, x, y, parents, spouse } ---
  // x, y are layout positions on the canvas (in canvas units).
  const people = [

    /* ---------- GEN -3: great-grandparents (paternal Sathawane line) ---------- */
    { id: "ramesh_s",   name: "Ramesh Sathawane",   gender: "m", birth: 1898, death: 1962, deceased: true,
      bio: "A village schoolmaster in Wardha who could recite Tukaram by heart and grew tomatoes in coffee tins.",
      x: -700, y: -1380, parents: [], spouse: "shanta_s" },
    { id: "shanta_s",   name: "Shanta Sathawane",   gender: "f", birth: 1902, death: 1968, deceased: true,
      bio: "Kept hens, healed neighbours with neem and turmeric, and outlived her husband by six monsoons.",
      x: -500, y: -1380, parents: [], spouse: "ramesh_s" },

    /* ---------- GEN -2: grandparents ---------- */
    { id: "pandurang_s", name: "Pandurang Sathawane", gender: "m", birth: 1928, death: 1998, deceased: true,
      bio: "Stationmaster at Nagpur Junction for thirty-one years. Wrote letters in three scripts.",
      x: -600, y: -940, parents: ["ramesh_s","shanta_s"], spouse: "kamala_s" },
    { id: "kamala_s",   name: "Kamala Sathawane",   gender: "f", birth: 1932, death: null, deceased: false,
      bio: "Ninety-four this year. Still drinks her chai with two spoons of sugar and corrects everyone's Marathi.",
      x: -400, y: -940, parents: [], spouse: "pandurang_s" },
    { id: "vasant_k",   name: "Vasant Khedkar",     gender: "m", birth: 1925, death: 2002, deceased: true,
      bio: "A cotton-mill foreman from Akola. He kept a small notebook of every loan he ever lent.",
      x: 400, y: -940, parents: [], spouse: "sushila_k" },
    { id: "sushila_k",  name: "Sushila Khedkar",    gender: "f", birth: 1930, death: 2010, deceased: true,
      bio: "Made puran poli that drew the whole gully to her doorstep. Sang Marathi bhajans every Thursday.",
      x: 600, y: -940, parents: [], spouse: "vasant_k" },

    /* ---------- GEN -1: parents, aunts, uncles ---------- */
    // Father's side (children of Pandurang & Kamala)
    { id: "suman_j",    name: "Suman Joshi",        gender: "f", birth: 1955, death: null, deceased: false,
      bio: "Eldest of the Sathawane children, married into the Joshi family in Pune. A piano teacher.",
      x: -1100, y: -500, parents: ["pandurang_s","kamala_s"], spouse: null },
    { id: "prakash_s",  name: "Prakash Sathawane",  gender: "m", birth: 1958, death: null, deceased: false,
      bio: "Civil engineer; built two bridges near Chandrapur he claims will outlast him by a century.",
      x: -800, y: -500, parents: ["pandurang_s","kamala_s"], spouse: null },
    { id: "arun_s",     name: "Arun Sathawane",     gender: "m", birth: 1962, death: null, deceased: false,
      bio: "Retired bank officer with a perpetual half-smile and an encyclopedic memory of cricket scores.",
      x: -120, y: -500, parents: ["pandurang_s","kamala_s"], spouse: "jyoti_s" },
    // Mother's side
    { id: "jyoti_s",    name: "Jyoti Sathawane",    gender: "f", birth: 1964, death: 2023, deceased: true,
      altNames: ["Baby","Jyoti Khedkar"],
      bio: "Schoolteacher, gardener, rainmaker of every gathering. She kept a rainbow umbrella for sudden Nagpur showers.",
      photo: "assets/mother.png",
      x: 120, y: -500, parents: ["vasant_k","sushila_k"], spouse: "arun_s" },
    { id: "anil_k",     name: "Anil Khedkar",       gender: "m", birth: 1967, death: null, deceased: false,
      bio: "Runs a small printing press in Akola. Sends every niece and nephew a hand-printed birthday card.",
      x: 900, y: -500, parents: ["vasant_k","sushila_k"], spouse: null },
    { id: "vidya_p",    name: "Vidya Pawar",        gender: "f", birth: 1970, death: null, deceased: false,
      bio: "Lawyer in Mumbai; argues in Marathi, English and occasionally Hindi when feeling theatrical.",
      x: 1200, y: -500, parents: ["vasant_k","sushila_k"], spouse: null },

    /* ---------- GEN 0: me, siblings, spouses, cousins, in-laws ---------- */
    // Paternal cousins
    { id: "nisha_j",    name: "Nisha Joshi",        gender: "f", birth: 1989, death: null, deceased: false,
      bio: "Architect in Bangalore. Draws elevations on tea-stained napkins and keeps them.",
      x: -1200, y: -10, parents: ["suman_j"], spouse: null },
    { id: "rahul_s",    name: "Rahul Sathawane",    gender: "m", birth: 1992, death: null, deceased: false,
      bio: "Civil engineer like his father, but rides a motorbike his father pretends not to have seen.",
      x: -900, y: -10, parents: ["prakash_s"], spouse: null },

    // My older brother + his wife + their kids
    { id: "vikram_s",   name: "Vikram Sathawane",   gender: "m", birth: 1984, death: null, deceased: false,
      bio: "Doctor at the civic hospital. Reads James Herriot to his son before bed.",
      x: -480, y: -10, parents: ["arun_s","jyoti_s"], spouse: "anjali_s" },
    { id: "anjali_s",   name: "Anjali Sathawane",   gender: "f", birth: 1986, death: null, deceased: false,
      bio: "Pediatric nurse; collects illustrated children's books in three languages.",
      x: -300, y: -10, parents: [], spouse: "vikram_s" },

    // Me
    { id: "me",         name: "Manisha Waghmare",   gender: "f", birth: 1989, death: null, deceased: false,
      me: true,
      bio: "That's you. Documentary filmmaker, monsoon enthusiast, the keeper of the family's photo boxes.",
      x: 0, y: -10, parents: ["arun_s","jyoti_s"], spouse: "rohan_w" },
    { id: "rohan_w",    name: "Rohan Waghmare",     gender: "m", birth: 1987, death: null, deceased: false,
      bio: "Software engineer, weekend chef, terrible at remembering anniversaries but excellent at making up for it.",
      x: 180, y: -10, parents: [], spouse: "me" },

    // My younger sister + her husband + their kid
    { id: "priya_d",    name: "Priya Deshpande",    gender: "f", birth: 1993, death: null, deceased: false,
      bio: "Marketing director in Pune. Has run six half-marathons and one half-marathon she did not finish.",
      x: 520, y: -10, parents: ["arun_s","jyoti_s"], spouse: "aniket_d" },
    { id: "aniket_d",   name: "Aniket Deshpande",   gender: "m", birth: 1990, death: null, deceased: false,
      bio: "Wildlife photographer. Spends two months a year in Tadoba looking for tigers; mostly finds langurs.",
      x: 700, y: -10, parents: [], spouse: "priya_d" },

    // Maternal cousins
    { id: "aditya_k",   name: "Aditya Khedkar",     gender: "m", birth: 1995, death: null, deceased: false,
      bio: "Sound designer in Mumbai. Records the city — trains, vendors, monsoon drains — for film scores.",
      x: 980, y: -10, parents: ["anil_k"], spouse: null },
    { id: "sneha_p",    name: "Sneha Pawar",        gender: "f", birth: 1998, death: null, deceased: false,
      bio: "Final-year medical student in Pune. Beats everyone at carrom and is not modest about it.",
      x: 1220, y: -10, parents: ["vidya_p"], spouse: null },

    /* ---------- GEN +1: children, nieces, nephews ---------- */
    { id: "kabir_s",    name: "Kabir Sathawane",    gender: "m", birth: 2020, death: null, deceased: false,
      bio: "Four years old. Currently obsessed with elephants and the colour orange.",
      x: -390, y: 460, parents: ["vikram_s","anjali_s"], spouse: null },
    { id: "aarav_w",    name: "Aarav Waghmare",     gender: "m", birth: 2017, death: null, deceased: false,
      bio: "Eight. Wants to be a cricketer, a vet, and an astronaut — in that order, every Tuesday.",
      x: -60, y: 460, parents: ["me","rohan_w"], spouse: null },
    { id: "mira_w",     name: "Mira Waghmare",      gender: "f", birth: 2020, death: null, deceased: false,
      bio: "Five. Draws the family every weekend; everyone has the same triangle dress and three teeth.",
      x: 130, y: 460, parents: ["me","rohan_w"], spouse: null },
    { id: "riya_d",     name: "Riya Deshpande",     gender: "f", birth: 2019, death: null, deceased: false,
      bio: "Six. Reads aloud to the family cat and insists the cat is following the plot.",
      x: 600, y: 460, parents: ["priya_d","aniket_d"], spouse: null }
  ];

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

  // Derive siblings (same parent set, excluding self)
  people.forEach(p => {
    p.siblings = [];
    if (!p.parents || !p.parents.length) return;
    people.forEach(q => {
      if (q.id === p.id) return;
      if (!q.parents || !q.parents.length) return;
      const shared = q.parents.filter(x => p.parents.includes(x));
      if (shared.length) p.siblings.push(q.id);
    });
  });

  /* ============================================================
     SCRAPBOOK ENTRIES — per-person memory timelines.
     Each entry: { date, caption, tags: [ids], photos: [urls or null] }
     null photos render as a placeholder slot — clean and honest.
     ============================================================ */
  const scrapbook = {
    me: [
      { date: "Summer 1989", caption: "Brought home from the hospital in Nagpur. Aai swore I had been waiting to be born until the first monsoon rain.",
        tags: ["jyoti_s","arun_s","vikram_s"], photos: [null] },
      { date: "October 1995", caption: "First Diwali I remember setting off a phuljadi by myself. Vikram pretended to be impressed.",
        tags: ["vikram_s","jyoti_s","arun_s"], photos: [null, null] },
      { date: "April 2007", caption: "Class 12 farewell. Aai sewed the saree pleats herself at 7 a.m. and made it to school by 9 to fix them again.",
        tags: ["jyoti_s","priya_d"], photos: [null] },
      { date: "December 2014", caption: "Married Rohan at the Waghmare bungalow. The pandit overran by forty minutes; nobody minded.",
        tags: ["rohan_w","jyoti_s","arun_s","priya_d","vikram_s"], photos: [null, null, null] },
      { date: "March 2017", caption: "Aarav arrived a week early. Aai held him longer than anyone else and called him 'mazha rajaa'.",
        tags: ["aarav_w","rohan_w","jyoti_s"], photos: [null, null] },
      { date: "August 2023", caption: "The last photo of Aai with all of us — under the mango tree at Anantpur, the umbrella she carried everywhere just out of frame.",
        tags: ["jyoti_s","priya_d","vikram_s","arun_s","aarav_w","mira_w"], photos: [null] }
    ],
    jyoti_s: [
      { date: "Winter 1964", caption: "Born in a small house in Akola during a power cut. Aji lit two oil lamps and named her on the spot.",
        tags: ["vasant_k","sushila_k"], photos: [null] },
      { date: "Monsoon 1971", caption: "First school photo. The rainbow umbrella was a gift from her mama — she carried one ever after.",
        tags: ["sushila_k","anil_k"], photos: [null] },
      { date: "May 1983", caption: "Graduated from Fergusson College. The whole Khedkar household took the night train to Pune to see her cross the stage.",
        tags: ["vasant_k","sushila_k","anil_k","vidya_p"], photos: [null, null] },
      { date: "February 1984", caption: "Met Arun at a friend's wedding in Nagpur. She told her sister he was 'fine, nothing special' — and got married six months later.",
        tags: ["arun_s","vidya_p"], photos: [null] },
      { date: "October 1984", caption: "Started teaching at Saraswati Vidyalaya. Class III-B remembers her as the teacher who let them keep the rain in tin cans for science.",
        tags: ["arun_s"], photos: [null] },
      { date: "July 1989", caption: "Manisha was born. She held her in the storm and said, very softly, 'tu paaus ahes' — you are the rain.",
        tags: ["me","arun_s","vikram_s"], photos: [null, null] },
      { date: "October 2014", caption: "Walked Manisha down at her wedding under a sky that threatened rain for three hours and never broke.",
        tags: ["me","rohan_w","arun_s","priya_d","vikram_s"], photos: [null] },
      { date: "August 2023", caption: "Left us under the mango tree at Anantpur. The umbrella is still in the cupboard. The family is still here.",
        tags: ["arun_s","me","priya_d","vikram_s"], photos: [null] }
    ],
    arun_s: [
      { date: "March 1962", caption: "Born in the Sathawane house behind Nagpur Junction; Pandurang Aaba ran from the platform to see him.",
        tags: ["pandurang_s","kamala_s"], photos: [null] },
      { date: "June 1984", caption: "Joined the State Bank as a probationary officer. Wore the same tie every day for the first month — for luck.",
        tags: ["pandurang_s","kamala_s"], photos: [null] },
      { date: "November 1984", caption: "Married Jyoti at the Khedkar house in Akola; the power cut out during the saptapadi and nobody noticed.",
        tags: ["jyoti_s","vasant_k","sushila_k"], photos: [null, null] },
      { date: "2022", caption: "Retired after thirty-eight years at the bank. Came home, made tea, watched cricket, declared retirement 'overrated'.",
        tags: ["jyoti_s","me","vikram_s","priya_d"], photos: [null] }
    ],
    rohan_w: [
      { date: "May 1987", caption: "Born in Pune to a family of four engineers. He picked the fifth occupation on purpose, then chose engineering anyway.",
        tags: [], photos: [null] },
      { date: "December 2014", caption: "Married Manisha. Wrote his vows on the back of a Wagh Bakri tea packet at 4 a.m.",
        tags: ["me","jyoti_s","arun_s"], photos: [null] },
      { date: "March 2017", caption: "Aarav's first day. Held him for ninety minutes before remembering to call his parents.",
        tags: ["me","aarav_w"], photos: [null] }
    ],
    aarav_w: [
      { date: "March 2017", caption: "Born on a rainy Tuesday. Aaji Jyoti named him before the doctor even said 'congratulations'.",
        tags: ["me","rohan_w","jyoti_s"], photos: [null] },
      { date: "April 2022", caption: "First day of school. Carried a yellow lunchbox bigger than his head.",
        tags: ["me","rohan_w","mira_w"], photos: [null] }
    ],
    mira_w: [
      { date: "October 2020", caption: "Born during the lockdown. The whole family met her over a wobbly video call.",
        tags: ["me","rohan_w","aarav_w","arun_s","jyoti_s"], photos: [null] }
    ],
    pandurang_s: [
      { date: "1928", caption: "Born to Ramesh and Shanta in the Sathawane house in Wardha.",
        tags: ["ramesh_s","shanta_s"], photos: [null] },
      { date: "1951", caption: "Joined Indian Railways as a station clerk. Climbed to Stationmaster of Nagpur Junction by 1967.",
        tags: [], photos: [null] }
    ],
    kamala_s: [
      { date: "1932", caption: "Born in a small village outside Yavatmal.",
        tags: [], photos: [null] },
      { date: "1955", caption: "Suman was born. Kamala named her for the jasmine flowering outside the window that morning.",
        tags: ["suman_j","pandurang_s"], photos: [null] },
      { date: "2026", caption: "Ninety-four years old; still beats Arun at carrom on Sunday afternoons.",
        tags: ["arun_s","me","vikram_s","priya_d"], photos: [null] }
    ],
    vikram_s: [
      { date: "September 1984", caption: "First child of Arun and Jyoti, born ten months after their wedding to the day.",
        tags: ["jyoti_s","arun_s"], photos: [null] },
      { date: "2009", caption: "Graduated MBBS. Aai cried, Baba grinned for an hour straight.",
        tags: ["jyoti_s","arun_s"], photos: [null] },
      { date: "January 2018", caption: "Married Anjali. They met during night shifts at the civic hospital — the rest of us were not surprised.",
        tags: ["anjali_s","jyoti_s","arun_s","me","priya_d"], photos: [null, null] },
      { date: "August 2020", caption: "Kabir arrived. Vikram, surgeon of twelve years, fainted gracefully behind a curtain.",
        tags: ["anjali_s","kabir_s"], photos: [null] }
    ],
    priya_d: [
      { date: "April 1993", caption: "Born in Nagpur. The youngest of three; chose to remain the boss anyway.",
        tags: ["jyoti_s","arun_s","me","vikram_s"], photos: [null] },
      { date: "2019", caption: "Married Aniket on a rooftop in Lonavala. It rained at exactly the right moment.",
        tags: ["aniket_d","me","jyoti_s","arun_s","vikram_s"], photos: [null, null] }
    ],
    aniket_d: [
      { date: "2019", caption: "Married Priya. Brought home a framed photograph of a leopard as the wedding gift to himself.",
        tags: ["priya_d"], photos: [null] }
    ],
    anjali_s: [
      { date: "January 2018", caption: "Married Vikram. The Sathawane house has needed a pediatric nurse ever since.",
        tags: ["vikram_s","kabir_s"], photos: [null] }
    ],
    kabir_s: [
      { date: "August 2020", caption: "First grandson on the Sathawane side. Kamala Aaji travelled twelve hours to hold him.",
        tags: ["vikram_s","anjali_s","kamala_s"], photos: [null] }
    ],
    riya_d: [
      { date: "December 2019", caption: "Born in Pune. The first niece — instantly the most spoiled person in the family.",
        tags: ["priya_d","aniket_d","me"], photos: [null] }
    ],
    ramesh_s: [
      { date: "1898", caption: "Born in a village in Wardha district. Began teaching at twenty and never quite stopped.",
        tags: [], photos: [null] }
    ],
    shanta_s: [
      { date: "1902", caption: "Born to a farming family. Could recite the names of every flowering plant within two miles of her house.",
        tags: [], photos: [null] }
    ],
    vasant_k: [
      { date: "1925", caption: "Born in Akola during the long dry season.",
        tags: [], photos: [null] }
    ],
    sushila_k: [
      { date: "1930", caption: "Born in Buldhana; learned to make puran poli at twelve, perfected it by thirty, taught Jyoti by sixty.",
        tags: ["jyoti_s"], photos: [null] }
    ],
    suman_j: [
      { date: "1955", caption: "Born to Pandurang and Kamala in Nagpur.",
        tags: ["pandurang_s","kamala_s"], photos: [null] }
    ],
    prakash_s: [
      { date: "1958", caption: "Second-born of Pandurang and Kamala.",
        tags: ["pandurang_s","kamala_s"], photos: [null] }
    ],
    anil_k: [
      { date: "1967", caption: "Born during the cotton harvest; the smell of fresh bales is the first thing he remembers.",
        tags: ["vasant_k","sushila_k","jyoti_s"], photos: [null] }
    ],
    vidya_p: [
      { date: "1970", caption: "Youngest of the Khedkar children. Argued her first case at age six over who finished the laddoos.",
        tags: ["jyoti_s","anil_k"], photos: [null] }
    ],
    nisha_j: [
      { date: "1989", caption: "Born in Pune to Suman.",
        tags: ["suman_j"], photos: [null] }
    ],
    rahul_s: [
      { date: "1992", caption: "Born in Chandrapur. Inherited his father's blueprints and his mother's stubbornness.",
        tags: ["prakash_s"], photos: [null] }
    ],
    aditya_k: [
      { date: "1995", caption: "Born in Akola; grew up around the printing press, slept through the noise, never lost the smell of ink.",
        tags: ["anil_k"], photos: [null] }
    ],
    sneha_p: [
      { date: "1998", caption: "Born in Mumbai. Won her first carrom tournament at nine and has not forgiven her opponents since.",
        tags: ["vidya_p"], photos: [null] }
    ]
  };

  /* ============================================================
     RELATIONSHIP LABEL COMPUTATION
     Computes the label "from the perspective of `viewerId`" for any
     person in the graph. Works by walking up to common ancestor and
     down to the target. Handles common Indian-English kinship terms.
     ============================================================ */
  function ancestorPath(id, target, visited) {
    // BFS up via parents/spouse, returns path from id → target (parents only)
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

  // Returns label like "Father", "Mother's Brother (Mama)", etc.
  function labelFor(viewerId, otherId) {
    if (viewerId === otherId) return "You";
    const viewer = byId[viewerId];
    const other  = byId[otherId];
    if (!viewer || !other) return "Family";

    // Spouse?
    if (viewer.spouse === otherId) {
      return other.gender === "m" ? "Husband" : "Wife";
    }

    // Through-spouse relations: my spouse's parents/siblings
    if (viewer.spouse) {
      const sp = byId[viewer.spouse];
      if (sp && sp.parents.includes(otherId)) {
        return other.gender === "m" ? "Father-in-Law" : "Mother-in-Law";
      }
      if (sp && sp.siblings.includes(otherId)) {
        return other.gender === "m" ? "Brother-in-Law" : "Sister-in-Law";
      }
    }
    // My sibling's spouse
    for (const sibId of viewer.siblings) {
      const sib = byId[sibId];
      if (sib && sib.spouse === otherId) {
        return other.gender === "m" ? "Brother-in-Law" : "Sister-in-Law";
      }
    }
    // My child's spouse
    for (const cid of viewer.children) {
      const c = byId[cid];
      if (c && c.spouse === otherId) return other.gender === "m" ? "Son-in-Law" : "Daughter-in-Law";
    }

    // Direct ancestor?
    const upPath = ancestorPath(viewerId, otherId);
    if (upPath && upPath.length > 1) {
      const dist = upPath.length - 1;
      if (dist === 1) {
        // Determine paternal/maternal
        return other.gender === "m" ? "Father" : "Mother";
      }
      if (dist === 2) {
        const sidePar = upPath[1]; // viewer's parent through whom we reach
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

    // Direct descendant?
    const downPath = ancestorPath(otherId, viewerId);
    if (downPath && downPath.length > 1) {
      const dist = downPath.length - 1;
      if (dist === 1) return other.gender === "m" ? "Son" : "Daughter";
      if (dist === 2) return other.gender === "m" ? "Grandson" : "Granddaughter";
      return other.gender === "m" ? "Great-Grandson" : "Great-Granddaughter";
    }

    // Sibling?
    if (viewer.siblings.includes(otherId)) {
      return other.gender === "m" ? "Brother" : "Sister";
    }

    // Aunt / uncle (parent's sibling)?
    for (const parId of viewer.parents) {
      const par = byId[parId];
      if (!par) continue;
      if (par.siblings.includes(otherId)) {
        const paternal = par.gender === "m";
        if (other.gender === "m") return paternal ? "Paternal Uncle (Kaka)" : "Maternal Uncle (Mama)";
        return paternal ? "Paternal Aunt (Aatya)" : "Maternal Aunt (Maushi)";
      }
      // Aunt/uncle through marriage — parent's sibling's spouse
      for (const sibId of par.siblings) {
        const sib = byId[sibId];
        if (sib && sib.spouse === otherId) {
          const paternal = par.gender === "m";
          if (other.gender === "m") return paternal ? "Uncle (Kaka)" : "Uncle (Mama)";
          return paternal ? "Aunt (Kaki)" : "Aunt (Mami)";
        }
      }
    }

    // Niece / nephew (sibling's child)?
    for (const sibId of viewer.siblings) {
      const sib = byId[sibId];
      if (!sib) continue;
      if (sib.children.includes(otherId)) {
        return other.gender === "m" ? "Nephew" : "Niece";
      }
    }

    // Cousin (parent's sibling's child)? — determine paternal/maternal
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

    // Fallback — share a common ancestor
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

  /* ============================================================
     RELATIONSHIP PATH for path-highlight
     Returns list of person ids from viewer → target via the
     family graph (parent/child/spouse edges).
     ============================================================ */
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
     FILTER TAGS — which IDs match each tag, computed live.
     ============================================================ */
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
    tagMatches,
    TAGS,
    ME: "me"
  };
})();
