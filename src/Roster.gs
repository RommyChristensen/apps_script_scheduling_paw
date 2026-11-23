/**
 * Loads the roster (DATABASE AOG JKT) and matches the short names used in the
 * schedule ("Kevin Nathanael", "Angelica", "Keisha") to full roster names.
 *
 * Names that can't be matched automatically can be mapped by hand in the
 * "PAW ALIASES" sheet (Alias | Roster name).
 */
function loadRoster_(ss) {
  const sh = ss.getSheetByName(CFG.ROSTER_SHEET);
  if (!sh) throw new Error('Roster sheet "' + CFG.ROSTER_SHEET + '" not found.');
  const values = sh.getDataRange().getValues();
  const hdr = (values[CFG.ROSTER_HEADER_ROW - 1] || []).map(norm_);

  const colIdx = {};
  Object.keys(CFG.ROSTER_COLUMNS).forEach(k => {
    const spec = CFG.ROSTER_COLUMNS[k];
    const i = hdr.indexOf(norm_(spec.header));
    colIdx[k] = i >= 0 ? i : colToIndex_(spec.fallback) - 1;
  });

  const people = [];
  for (let r = CFG.ROSTER_HEADER_ROW; r < values.length; r++) {
    const row = values[r];
    const name = str_(row[colIdx.name]);
    if (!name) continue;
    const status = str_(row[colIdx.status]);
    const roleText = str_(row[colIdx.role]);
    people.push({
      name: name.replace(/\?+$/, '').trim(),
      roleText,
      roles: parseRoles_(roleText),
      gender: str_(row[colIdx.gender]),
      status,
      active: isActiveStatus_(status),
      church: str_(row[colIdx.church]),
      allowed: parseChurchList_(row[colIdx.allowed]),
      notes: str_(row[colIdx.notes]).replace(/^none$/i, ''),
      row: r + 1,
    });
  }
  return buildRoster_(people, loadAliases_(ss), loadLeaves_(ss));
}

function buildRoster_(people, aliases, leaves) {
  const tokens = s => normName_(s).split(' ').filter(Boolean);
  people.forEach(p => { p.tokens = tokens(p.name); p.compact = p.tokens.join(''); });
  const byExact = {};
  people.forEach(p => (byExact[p.tokens.join(' ')] = p));
  const cache = {};

  function match(name) {
    const key = normName_(name);
    if (!key) return null;
    if (key in cache) return cache[key];
    cache[key] = doMatch(key);
    return cache[key];
  }

  function pickOne(cands, t) {
    if (cands.length === 1) return cands[0];
    if (cands.length > 1) {
      const sameFirst = cands.filter(p => p.tokens[0] === t[0]);
      if (sameFirst.length === 1) return sameFirst[0];
    }
    return null;
  }

  function doMatch(key) {
    if (byExact[key]) return byExact[key];
    if (aliases[key]) {
      const target = byExact[normName_(aliases[key])] || null;
      if (target) return target;
    }
    const t = key.split(' ');
    // All written words appear in the full name: "Jeremy William" -> "Jeremy William Teo".
    let p = pickOne(people.filter(x => t.every(w => x.tokens.indexOf(w) >= 0)), t);
    if (p) return p;
    // Same first name and it is unique: "Joshua Vontee" -> "Joshua William von Tee".
    const firsts = people.filter(x => x.tokens[0] === t[0]);
    if (firsts.length === 1) return firsts[0];
    // Words are prefixes: "Gwen" -> "Gwendolyn ...".
    p = pickOne(people.filter(x => t.every(w => x.tokens.some(xt => xt.indexOf(w) === 0))), t);
    if (p) return p;
    // Spacing differences: "vontee" inside "joshuawilliamvontee".
    const compact = t.join('');
    if (compact.length >= 5) {
      p = pickOne(people.filter(x => x.compact.indexOf(compact) >= 0), t);
      if (p) return p;
    }
    // One-letter typos: "Jeremiah Nikola" -> "Jeremia Nikola", "Rebecca" -> "Rebeca".
    const close = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && editDistance_(a, b) <= 1);
    const fuzzy = people.filter(x => t.every(w => x.tokens.some(xt => close(w, xt))));
    if (fuzzy.length === 1) return fuzzy[0];
    return null;
  }

  /** Leave entries for a person on a given date (array, possibly empty). */
  function leaveOn(person, date) {
    const d = startOfDay_(date).getTime();
    return leaves.filter(l => {
      const lp = match(l.name);
      return lp === person && l.start.getTime() <= d && d <= l.end.getTime();
    });
  }

  return { people, match, leaveOn, aliases };
}

function normName_(s) {
  return str_(s).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9À-ɏ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function editDistance_(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function isActiveStatus_(status) {
  return /^(aktif|active)/i.test(status);
}

/** Role tags: WL, GL, SINGER, KEYS, SYNTH, GUITAR, BASS, DRUM, VIOLIN */
function parseRoles_(text) {
  const t = str_(text).toLowerCase();
  const roles = [];
  if (/worship leader|\bwl\b/.test(t)) roles.push('WL');
  if (/\bgl\b|group leader/.test(t)) roles.push('GL');
  if (/singer|vocal/.test(t)) roles.push('SINGER');
  if (/key|piano/.test(t)) roles.push('KEYS');
  if (/synth/.test(t)) roles.push('SYNTH');
  if (/guitar/.test(t)) roles.push('GUITAR');
  if (/bass/.test(t)) roles.push('BASS');
  if (/drum/.test(t)) roles.push('DRUM');
  if (/violin/.test(t)) roles.push('VIOLIN');
  return roles;
}

/**
 * Which roster roles fit a schedule position.
 * Returns { ok: [...], preferred: [...] } or null if the position is unknown.
 */
function rolesForPosition_(position) {
  const p = norm_(position);
  if (/^(CO-?)?WL\b/.test(p) || /WORSHIP LEADER/.test(p)) return { ok: ['WL'], preferred: ['WL'] };
  if (/SINGER/.test(p) && /\(GL\)|\bGL\b/.test(p)) return { ok: ['GL', 'WL', 'SINGER'], preferred: ['GL'] };
  if (/SINGER|^B\d$|BACKING/.test(p)) return { ok: ['SINGER', 'GL', 'WL'], preferred: ['SINGER', 'GL'] };
  if (/LEAD KEY|KEYS|PIANO/.test(p)) return { ok: ['KEYS'], preferred: ['KEYS'] };
  if (/SYNTH/.test(p)) return { ok: ['SYNTH', 'KEYS'], preferred: ['SYNTH'] };
  if (/GUITAR/.test(p)) return { ok: ['GUITAR'], preferred: ['GUITAR'] };
  if (/BASS/.test(p)) return { ok: ['BASS'], preferred: ['BASS'] };
  if (/DRUM/.test(p)) return { ok: ['DRUM'], preferred: ['DRUM'] };
  if (/VIOLIN/.test(p)) return { ok: ['VIOLIN'], preferred: ['VIOLIN'] };
  return null;
}

function hasAnyRole_(person, roles) {
  return person.roles.some(r => roles.indexOf(r) >= 0);
}

/** PAW ALIASES sheet: column A = name as written in schedule, column B = roster name. */
function loadAliases_(ss) {
  const sh = ss.getSheetByName(CFG.ALIAS_SHEET);
  const map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
    const a = normName_(r[0]);
    if (a && str_(r[1])) map[a] = str_(r[1]);
  });
  return map;
}

function ensureAliasSheet_(ss) {
  let sh = ss.getSheetByName(CFG.ALIAS_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(CFG.ALIAS_SHEET, ss.getSheets().length);
  sh.getRange(1, 1, 1, 3).setValues([['Name as written in schedule', 'Name in ' + CFG.ROSTER_SHEET, 'Note']])
    .setFontWeight('bold').setBackground('#d9ead3');
  sh.setFrozenRows(1);
  sh.setColumnWidths(1, 3, 260);
  return sh;
}

/** Optional leave list (HIDDEN sheet): name + start + end dates. */
function loadLeaves_(ss) {
  const sh = ss.getSheetByName(CFG.LEAVE_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const hdr = values[0].map(norm_);
  const idx = k => hdr.indexOf(norm_(CFG.LEAVE_COLUMNS[k]));
  const iN = idx('name'), iS = idx('start'), iE = idx('end'), iR = idx('reason');
  if (iN < 0 || iS < 0 || iE < 0) return [];
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const name = str_(values[r][iN]);
    const s = values[r][iS], e = values[r][iE];
    if (!name || !isDate_(s) || !isDate_(e)) continue;
    out.push({ name, start: startOfDay_(s), end: startOfDay_(e), reason: iR >= 0 ? str_(values[r][iR]) : '' });
  }
  return out;
}
