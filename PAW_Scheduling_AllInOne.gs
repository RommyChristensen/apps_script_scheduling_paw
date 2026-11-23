/**
 * PAW AOG JKT – Scheduling (all-in-one file)
 * Paste this whole file into Extensions → Apps Script (replace everything in Code.gs).
 * Generated from the files in src/.
 */

// ===================== Config.gs =====================
/**
 * PAW AOG JKT – scheduling helpers
 * ---------------------------------
 * Everything that depends on the layout of the "SCHEDULING PAW AOG JKT"
 * spreadsheet lives here, so it can be adjusted without touching the logic.
 */
const CFG = {
  // Roster ("database") of all servants.
  ROSTER_SHEET: 'DATABASE AOG JKT',
  ROSTER_HEADER_ROW: 2,
  // Header text to look for (case/space-insensitive) and the column letter to
  // fall back to if the header is not found.
  ROSTER_COLUMNS: {
    name:        { header: 'Nama',             fallback: 'C' },
    role:        { header: 'Role',             fallback: 'D' },
    gender:      { header: 'M/F',              fallback: 'E' },
    status:      { header: 'Status Pelayanan', fallback: 'F' },
    church:      { header: 'Gereja Lokal',     fallback: 'G' },
    allowed:     { header: 'Recommended GL',   fallback: 'J' }, // "CP, GC, Puri, Pluit"
    notes:       { header: 'Notes',            fallback: 'K' },
  },

  // Leave / izin list (optional). Rows: Nama Volunteer | ... | Start | End.
  LEAVE_SHEET: 'HIDDEN',
  LEAVE_COLUMNS: { name: 'Nama Volunteer', reason: 'Alasan Izin', start: 'Start', end: 'End' },

  // Sheets created by this script.
  ALIAS_SHEET: 'PAW ALIASES',
  CHECK_SHEET: 'PAW CHECK',
  FREQ_SHEET: 'PAW FREQUENCY',

  // Schedule tabs whose name matches one of these are ignored when counting
  // (duplicates / templates would otherwise be counted twice).
  IGNORE_SHEET_PATTERNS: [/^copy of/i, /template/i],

  // Service day (0 = Sunday … 6 = Saturday). AOG runs on Saturdays.
  SERVICE_WEEKDAY: 6,

  // Warn when someone is scheduled more than this many times in one month.
  MAX_SERVES_PER_MONTH: 3,

  // Max number of suggestions shown per open slot.
  MAX_SUGGESTIONS: 8,

  // Only the top-left part of each tab is scanned (schedules are small).
  MAX_SCAN_ROWS: 250,
  MAX_SCAN_COLS: 30,

  // Church header in the schedule -> code used in the roster's "Recommended" column.
  CHURCH_CODES: {
    'CP': 'CP', 'CENTRAL PARK': 'CP', 'GMS CP': 'CP', 'GMS CENTRAL PARK': 'CP',
    'GANCIT': 'GC', 'GC': 'GC', 'GANDARIA CITY': 'GC', 'GMS GC': 'GC', 'GMS GANDARIA CITY': 'GC',
    'PURI': 'Puri', 'GMS PURI': 'Puri',
    'PLUIT': 'Pluit', 'GMS PLUIT': 'Pluit',
  },
};

const ID_MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
  'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const ID_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ===================== Utils.gs =====================
/** Small shared helpers. */

function str_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/** Upper-case, collapse spaces. */
function norm_(v) {
  return str_(v).replace(/\s+/g, ' ').toUpperCase();
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

/** 'A' -> 1, 'AB' -> 28 */
function colToIndex_(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 1 -> 'A', 28 -> 'AB' */
function indexToCol_(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function a1_(row, col) {
  return indexToCol_(col) + row;
}

function dayKey_(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function monthKey_(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

function startOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** "14 Nov" */
function shortDate_(d) {
  return d.getDate() + ' ' + SHORT_MONTHS[d.getMonth()];
}

/** "Sabtu, 14 November 2026" */
function longDateId_(d) {
  return ID_DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + ID_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

function churchCode_(header) {
  const key = norm_(header);
  return CFG.CHURCH_CODES[key] || str_(header);
}

/** Parses "CP, GC, Puri, Pluit" -> ['CP','GC','Puri','Pluit'] */
function parseChurchList_(text) {
  return str_(text).split(/[,/&]+|\s+dan\s+/i)
    .map(s => s.trim())
    .filter(s => s && norm_(s) !== 'NONE')
    .map(churchCode_);
}

/** Placeholders that mean "nobody (yet)". */
function isPlaceholder_(s) {
  return /^(-+|–|—|tba|tbc|tbd|\?+|x|n\/?a|kosong|none)$/i.test(s) || /^team\b/i.test(s);
}

/**
 * The person who actually serves. Swaps are written "Old -> New", so the last
 * name wins. Returns '' for empty cells and placeholders like "-" or "tba".
 */
function finalName_(raw) {
  const s = str_(raw);
  if (!s) return '';
  const parts = s.split(/\s*(?:->|=>|→|➡️?|➔|>)\s*/).map(p => p.trim()).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : '';
  return isPlaceholder_(last) ? '' : last;
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sheetLink_(sheet, row, col) {
  return '#gid=' + sheet.getSheetId() + '&range=' + a1_(row, col);
}

/** Gets (or creates) a sheet and clears it. */
function resetSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name, ss.getSheets().length);
  } else {
    sh.clear();
    sh.setConditionalFormatRules([]);
  }
  return sh;
}

// ===================== Parser.gs =====================
/**
 * Reads a monthly schedule tab (e.g. "Nov 2026") into a structure:
 *
 * { sheetName, month: Date|null, weeks: [
 *     { label: 'WEEK II', labelRow, firstRow, lastRow, date: Date, blocks: [
 *         { church: 'CP', churchCode: 'CP', group: 'GROUP 3B', date,
 *           headerRow, posCol, dateCell: {row, col},
 *           slots: [ { row, col, position, ownLabel, raw, name, availCol } ] } ] } ] }
 *
 * Rows/cols are 1-based (sheet coordinates). A block is recognised by a
 * "Position" cell with "Nama" to its right and a date two rows above.
 */
function parseScheduleSheet_(sheet) {
  const lastRow = Math.min(sheet.getLastRow(), CFG.MAX_SCAN_ROWS);
  const lastCol = Math.min(sheet.getLastColumn(), CFG.MAX_SCAN_COLS);
  if (lastRow < 6 || lastCol < 3) return null;
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const parsed = parseScheduleValues_(values);
  if (!parsed) return null;
  fixYearFromName_(parsed, sheet.getName());
  parsed.sheetName = sheet.getName();
  parsed.sheet = sheet;
  return parsed;
}

function parseScheduleValues_(values) {
  const nRows = values.length;
  const nCols = values[0].length;
  const cell = (r, c) => (r >= 0 && r < nRows && c >= 0 && c < nCols) ? values[r][c] : '';
  const isWeekLabel = v => /^WEEK\b/i.test(str_(v));

  // 1. Find block headers ("Position" | "Nama").
  const headers = [];
  for (let r = 3; r < nRows; r++) {
    for (let c = 0; c < nCols - 1; c++) {
      if (norm_(values[r][c]) !== 'POSITION') continue;
      if (!/^NAMA/i.test(str_(values[r][c + 1]))) continue;
      const date = cell(r - 1, c);
      if (!isDate_(date)) continue;
      headers.push({ r, c, date });
    }
  }
  if (!headers.length) return null;

  // 2. Group headers by row -> one week per header row.
  const byRow = {};
  headers.forEach(h => (byRow[h.r] = byRow[h.r] || []).push(h));
  const weeks = [];

  Object.keys(byRow).map(Number).sort((a, b) => a - b).forEach(r => {
    const hs = byRow[r].sort((a, b) => a.c - b.c);
    const firstCol = hs[0].c;

    // Week label: search upwards in the columns left of / at the first block.
    let label = '', labelRow = r - 3;
    for (let rr = r; rr >= Math.max(0, r - 7) && !label; rr--) {
      for (let cc = 0; cc <= firstCol; cc++) {
        if (isWeekLabel(values[rr][cc])) { label = str_(values[rr][cc]); labelRow = rr; break; }
      }
    }

    const blocks = [];
    let lastRow = r;
    hs.forEach(h => {
      const slots = [];
      for (let rr = r + 1; rr < nRows; rr++) {
        const pos = str_(values[rr][h.c]);
        if (norm_(pos) === 'POSITION') break;
        let rowHasWeek = false;
        for (let cc = 0; cc <= firstCol; cc++) if (isWeekLabel(values[rr][cc])) rowHasWeek = true;
        if (rowHasWeek) break;
        const blockEmpty = [0, 1, 2].every(k => str_(cell(rr, h.c + k)) === '');
        if (blockEmpty && str_(values[rr][firstCol]) === '') break;
        slots.push({
          row: rr + 1,
          col: h.c + 2,                      // name column (1-based)
          availCol: h.c + 3,
          position: pos || str_(values[rr][firstCol]),
          ownLabel: !!pos,                   // false = row only labelled in the first block
          raw: str_(values[rr][h.c + 1]),
          name: finalName_(values[rr][h.c + 1]),
        });
        lastRow = Math.max(lastRow, rr);
      }
      const church = str_(cell(r - 3, h.c));
      blocks.push({
        church,
        churchCode: churchCode_(church),
        group: str_(cell(r - 2, h.c)),
        // All churches serve on the same Saturday; the first block's date is the
        // one that gets updated, the others are sometimes stale copies.
        date: startOfDay_(hs[0].date),
        ownDate: startOfDay_(h.date),
        headerRow: r + 1,
        posCol: h.c + 1,
        dateCell: { row: r, col: h.c + 1 },  // 1-based (row r is the date row: r-1 0-based)
        slots,
      });
    });

    weeks.push({
      label: label || ('WEEK ' + (weeks.length + 1)),
      labelRow: labelRow + 1,
      firstRow: labelRow + 1,
      lastRow: lastRow + 1,
      date: blocks[0].date,
      blocks,
    });
  });

  // Month = the month most service dates fall in (the date in B2 is sometimes stale).
  const tally = {};
  weeks.forEach(w => { const k = monthKey_(w.date); tally[k] = (tally[k] || 0) + 1; });
  let month = null, bestN = 0;
  weeks.forEach(w => {
    const n = tally[monthKey_(w.date)];
    if (n > bestN) { bestN = n; month = new Date(w.date.getFullYear(), w.date.getMonth(), 1); }
  });
  return { month, weeks };
}

/**
 * Some tabs were copied forward without updating the year (e.g. "January 2026"
 * still has 3 Jan 2025 typed in). If the tab name contains a year and the
 * dates are in a different year, use the year from the name.
 */
function fixYearFromName_(parsed, name) {
  const m = String(name).match(/\b(20\d\d)\b/);
  if (!m || !parsed.month) return;
  const delta = Number(m[1]) - parsed.month.getFullYear();
  if (!delta) return;
  const shift = d => new Date(d.getFullYear() + delta, d.getMonth(), d.getDate());
  parsed.weeks.forEach(w => {
    w.date = shift(w.date);
    w.blocks.forEach(b => { b.date = shift(b.date); b.ownDate = shift(b.ownDate); });
  });
  parsed.month = shift(parsed.month);
  parsed.yearFixed = delta;
}

/** The week block (of a parsed sheet) that contains the given row, or the nearest one above. */
function weekForRow_(parsed, row) {
  let best = null;
  parsed.weeks.forEach(w => {
    if (w.firstRow <= row) best = w;
  });
  return best || parsed.weeks[0];
}

/** All tabs that look like schedules (including hidden ones). */
function getScheduleSheets_(ss, opts) {
  opts = opts || {};
  const out = [];
  ss.getSheets().forEach(sh => {
    const name = sh.getName();
    if ([CFG.CHECK_SHEET, CFG.FREQ_SHEET, CFG.ALIAS_SHEET, CFG.ROSTER_SHEET].indexOf(name) >= 0) return;
    if (opts.skipIgnored && CFG.IGNORE_SHEET_PATTERNS.some(p => p.test(name))) return;
    const parsed = parseScheduleSheet_(sh);
    if (parsed && parsed.weeks.length) out.push(parsed);
  });
  return out;
}

/**
 * Every filled slot across all schedule tabs. The same Saturday can appear in
 * more than one tab (a draft and a "FINAL" copy, or week V of one month and
 * week I of the next), so for each date + church only one tab is used:
 * "FINAL" tabs first, then the tab whose month matches the date.
 */
function collectAssignments_(ss, roster) {
  const sheets = getScheduleSheets_(ss, { skipIgnored: true });
  const best = {}; // dayKey|church -> { score, parsed, block }
  sheets.forEach(p => {
    const isFinal = /final/i.test(p.sheetName) ? 2 : 0;
    p.weeks.forEach(w => w.blocks.forEach(b => {
      const monthMatch = p.month && monthKey_(p.month) === monthKey_(b.date) ? 1 : 0;
      const score = isFinal + monthMatch;
      const key = dayKey_(b.date) + '|' + b.churchCode;
      if (!best[key] || score > best[key].score) best[key] = { score, parsed: p, block: b };
    }));
  });
  const list = [];
  Object.keys(best).forEach(key => {
    const { parsed, block } = best[key];
    block.slots.forEach(s => {
      if (!s.name) return;
      const person = roster ? roster.match(s.name) : null;
      list.push({
        sheetName: parsed.sheetName, date: block.date, church: block.churchCode, position: s.position,
        name: s.name, person, key: person ? person.name : s.name,
      });
    });
  });
  list.sort((a, b) => a.date - b.date);
  return { assignments: list, sheets };
}

// ===================== Roster.gs =====================
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

// ===================== Check.gs =====================
/**
 * "Check this month" – scans the active schedule tab and writes every problem
 * found to the "PAW CHECK" sheet, with a link to the cell.
 *
 * Checks:
 *  - ERROR    same person scheduled twice in the same week
 *  - WARNING  person is on leave (HIDDEN sheet) on that date
 *  - WARNING  roster status is not active (Cuti / On Hold / Tidak di Jakarta)
 *  - WARNING  church is not in the person's "Recommended" list
 *  - WARNING  scheduled more than CFG.MAX_SERVES_PER_MONTH times this month
 *  - INFO     role in the roster does not fit the position
 *  - INFO     name not found in the roster (add it to PAW ALIASES)
 *  - INFO     open slots (empty / "tba")
 */
function pawCheckActiveSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const sheet = ss.getActiveSheet();
  const parsed = parseScheduleSheet_(sheet);
  if (!parsed) {
    ui.alert('This tab does not look like a monthly schedule.\nOpen a month tab (e.g. "Dec 2026") and try again.');
    return;
  }
  const roster = loadRoster_(ss);
  const issues = checkSchedule_(parsed, roster);
  writeCheckReport_(ss, sheet, parsed, issues);

  const count = sev => issues.filter(i => i.severity === sev).length;
  ss.toast(count('ERROR') + ' errors, ' + count('WARNING') + ' warnings, ' + count('INFO') + ' info',
    'PAW check: ' + sheet.getName(), 8);
}

function checkSchedule_(parsed, roster) {
  const issues = [];
  const add = (severity, week, block, slot, issue, detail) => issues.push({
    severity, week: week.label, date: block.date, church: block.church,
    position: slot ? slot.position : '', name: slot ? slot.raw : '',
    row: slot ? slot.row : block.dateCell.row, col: slot ? slot.col : block.dateCell.col,
    issue, detail: detail || '',
  });

  const monthCount = {};   // person/name -> count in this tab
  const monthSlots = {};   // person/name -> [ {week, block, slot} ]

  parsed.weeks.forEach(week => {
    week.blocks.forEach(block => {
      if (block.ownDate.getTime() !== block.date.getTime()) {
        add('WARNING', week, block, null, 'Date differs from ' + week.blocks[0].church,
          block.church + ' shows ' + shortDate_(block.ownDate) + ' but ' + week.blocks[0].church + ' shows ' +
          shortDate_(block.date) + '. Tip: use =' + a1_(week.blocks[0].dateCell.row, week.blocks[0].dateCell.col) + ' in this cell.');
      }
    });
    const inWeek = {};     // key -> [ {block, slot} ]
    week.blocks.forEach(block => block.slots.forEach(slot => {
      if (!slot.name) {
        // "-" usually means "nobody planned"; only empty / "tba" slots are reported.
        if (slot.ownLabel && rolesForPosition_(slot.position) && (!slot.raw || /^(tba|tbc|tbd|\?+)$/i.test(slot.raw))) {
          add('INFO', week, block, slot, 'Open slot', slot.raw ? 'Marked "' + slot.raw + '"' : 'Empty');
        }
        return;
      }
      const person = roster.match(slot.name);
      const key = person ? person.name : normName_(slot.name);
      (inWeek[key] = inWeek[key] || []).push({ block, slot });
      monthCount[key] = (monthCount[key] || 0) + 1;
      (monthSlots[key] = monthSlots[key] || []).push({ week, block, slot });

      if (!person) {
        add('INFO', week, block, slot, 'Name not in roster',
          'Not found in ' + CFG.ROSTER_SHEET + '. If it is a nickname, add it to the ' + CFG.ALIAS_SHEET + ' sheet.');
        return;
      }
      if (!person.active) {
        add('WARNING', week, block, slot, 'Status: ' + person.status, person.notes);
      }
      roster.leaveOn(person, block.date).forEach(l => {
        add('WARNING', week, block, slot, 'On leave', (l.reason || 'Izin') + ' (' + shortDate_(l.start) + ' – ' + shortDate_(l.end) + ')');
      });
      if (person.allowed.length && block.churchCode && person.allowed.indexOf(block.churchCode) < 0) {
        add('WARNING', week, block, slot, 'Church not recommended',
          person.name + ' is recommended for ' + person.allowed.join(', ') + (person.notes ? ' — ' + person.notes : ''));
      }
      const fit = rolesForPosition_(slot.position);
      if (fit && person.roles.length && !hasAnyRole_(person, fit.ok)) {
        add('INFO', week, block, slot, 'Role does not fit position',
          person.name + ' is "' + person.roleText + '" in the roster');
      } else if (fit && fit.preferred.indexOf('GL') >= 0 && person.roles.indexOf('GL') < 0 && person.roles.indexOf('WL') < 0) {
        add('INFO', week, block, slot, 'Not a GL', person.name + ' is "' + person.roleText + '" in the roster');
      }
    }));

    Object.keys(inWeek).forEach(key => {
      const list = inWeek[key];
      if (list.length < 2) return;
      const where = list.map(x => x.block.church + ' ' + x.slot.position + ' (' + a1_(x.slot.row, x.slot.col) + ')').join(', ');
      list.forEach(x => add('ERROR', week, x.block, x.slot, 'Double-booked this week', where));
    });
  });

  Object.keys(monthCount).forEach(key => {
    if (monthCount[key] <= CFG.MAX_SERVES_PER_MONTH) return;
    const first = monthSlots[key][0];
    const dates = monthSlots[key].map(x => shortDate_(x.block.date)).join(', ');
    add('WARNING', first.week, first.block, first.slot,
      'Scheduled ' + monthCount[key] + 'x this month', dates);
  });

  if (parsed.yearFixed && parsed.weeks.length) {
    const w = parsed.weeks[0], b = w.blocks[0];
    issues.push({ severity: 'WARNING', week: w.label, date: b.date, church: b.church, position: '', name: '',
      row: b.dateCell.row, col: b.dateCell.col, issue: 'Dates have the wrong year',
      detail: 'The dates in this tab are in ' + (b.date.getFullYear() - parsed.yearFixed) +
        ' but the tab name says ' + b.date.getFullYear() + '. Checked as ' + b.date.getFullYear() + '; please fix the date cell.' });
  }

  const order = { ERROR: 0, WARNING: 1, INFO: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity] || a.date - b.date || a.row - b.row);
  return issues;
}

function writeCheckReport_(ss, sheet, parsed, issues) {
  const out = resetSheet_(ss, CFG.CHECK_SHEET);
  out.getRange(1, 1).setValue('PAW check – ' + sheet.getName()).setFontSize(14).setFontWeight('bold');
  out.getRange(2, 1).setValue('Generated ' + new Date().toLocaleString() + ' · ' + issues.length + ' items. ' +
    'Click "Go" to jump to the cell. Re-run from the PAW Scheduling menu after fixing.');

  const header = ['Severity', 'Week', 'Date', 'Church', 'Position', 'Name (as written)', 'Issue', 'Detail', 'Go'];
  out.getRange(4, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#cfe2f3');
  out.setFrozenRows(4);

  if (!issues.length) {
    out.getRange(5, 1).setValue('No problems found 🎉');
  } else {
    const rows = issues.map(i => [
      i.severity, i.week, i.date, i.church, i.position, i.name, i.issue, i.detail,
      '=HYPERLINK("' + sheetLink_(sheet, i.row, i.col) + '","Go")',
    ]);
    out.getRange(5, 1, rows.length, header.length).setValues(rows);
    out.getRange(5, 3, rows.length, 1).setNumberFormat('d mmm yyyy');
    const colors = { ERROR: '#f4cccc', WARNING: '#fff2cc', INFO: '#ffffff' };
    out.getRange(5, 1, rows.length, header.length)
      .setBackgrounds(issues.map(i => new Array(header.length).fill(colors[i.severity])));
  }
  out.setColumnWidths(1, 6, 110);
  out.setColumnWidth(6, 200);
  out.setColumnWidth(7, 200);
  out.setColumnWidth(8, 420);
  out.setColumnWidth(9, 50);
  if (issues.some(i => i.issue === 'Name not in roster')) ensureAliasSheet_(ss);
  out.activate();
}

// ===================== Suggest.gs =====================
/**
 * "Suggest people for this week" – put the cursor anywhere inside a week
 * block. For every open slot (empty / "-" / "tba") it lists people who:
 *   - are active in the roster and have a fitting role
 *   - are recommended for that church (or have no church restriction)
 *   - are not already scheduled that week and are not on leave
 * sorted by how often they served this month, then by who served least recently.
 */
function pawSuggestForWeek() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const sheet = ss.getActiveSheet();
  const parsed = parseScheduleSheet_(sheet);
  if (!parsed) {
    ui.alert('Open a monthly schedule tab and click inside a week, then try again.');
    return;
  }
  const week = weekForRow_(parsed, ss.getActiveRange().getRow());
  const roster = loadRoster_(ss);
  const { assignments } = collectAssignments_(ss, roster);
  const result = suggestForWeek_(parsed, week, roster, assignments);
  const html = HtmlService.createHtmlOutput(renderSuggestions_(sheet.getName(), week, result))
    .setWidth(720).setHeight(600);
  ui.showModelessDialog(html, 'Suggestions – ' + week.label + ' (' + shortDate_(week.date) + ')');
}

function suggestForWeek_(parsed, week, roster, assignments) {
  // Who is already in this week (on this tab)?
  const busy = {};
  week.blocks.forEach(b => b.slots.forEach(s => {
    if (!s.name) return;
    const p = roster.match(s.name);
    busy[p ? p.name : normName_(s.name)] = true;
  }));

  // Counts this month and last-served date (before this week) from all tabs.
  const mk = monthKey_(week.date);
  const monthCount = {}, lastServed = {};
  assignments.forEach(a => {
    if (!a.person) return;
    const k = a.person.name;
    if (monthKey_(a.date) === mk) monthCount[k] = (monthCount[k] || 0) + 1;
    if (a.date < week.date && (!lastServed[k] || a.date > lastServed[k])) lastServed[k] = a.date;
  });

  return week.blocks.map(block => {
    const open = block.slots.filter(s => !s.name && s.ownLabel && rolesForPosition_(s.position));
    return {
      church: block.church, group: block.group,
      slots: open.map(slot => {
        const fit = rolesForPosition_(slot.position);
        const cands = roster.people.filter(p =>
          p.active &&
          hasAnyRole_(p, fit.ok) &&
          !busy[p.name] &&
          (!p.allowed.length || !block.churchCode || p.allowed.indexOf(block.churchCode) >= 0) &&
          !roster.leaveOn(p, block.date).length
        ).map(p => ({
          name: p.name,
          preferred: hasAnyRole_(p, fit.preferred),
          count: monthCount[p.name] || 0,
          last: lastServed[p.name] || null,
          notes: p.notes,
          home: churchCode_(p.church) === block.churchCode,
        }));
        cands.sort((a, b) =>
          (b.preferred - a.preferred) ||
          (a.count - b.count) ||
          ((a.last ? a.last.getTime() : 0) - (b.last ? b.last.getTime() : 0)) ||
          (b.home - a.home) ||
          a.name.localeCompare(b.name));
        return { position: slot.position, cell: a1_(slot.row, slot.col), raw: slot.raw,
          candidates: cands.slice(0, CFG.MAX_SUGGESTIONS) };
      }),
    };
  });
}

function renderSuggestions_(sheetName, week, result) {
  let h = '<style>body{font-family:Arial,sans-serif;font-size:13px;color:#222}' +
    'h3{margin:14px 0 4px;background:#cfe2f3;padding:4px 8px;border-radius:4px}' +
    '.slot{margin:6px 0 2px;font-weight:bold}.c{display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;' +
    'border:1px solid #ccc;border-radius:12px;background:#fafafa}.c.alt{color:#777;border-style:dashed}' +
    '.n{color:#888;font-size:11px}.none{color:#a00}</style>';
  h += '<div class="n">' + escapeHtml_(sheetName) + ' · ' + escapeHtml_(longDateId_(week.date)) +
    ' · sorted by fewest times this month, then longest since last served. Dashed = role fits but not their main role.</div>';
  let anyOpen = false;
  result.forEach(b => {
    if (!b.slots.length) return;
    anyOpen = true;
    h += '<h3>' + escapeHtml_(b.church) + (b.group ? ' – ' + escapeHtml_(b.group) : '') + '</h3>';
    b.slots.forEach(s => {
      h += '<div class="slot">' + escapeHtml_(s.position) + ' <span class="n">(' + s.cell +
        (s.raw ? ', marked "' + escapeHtml_(s.raw) + '"' : '') + ')</span></div>';
      if (!s.candidates.length) { h += '<div class="none">No available candidates</div>'; return; }
      s.candidates.forEach(c => {
        const meta = c.count + 'x this month' + (c.last ? ', last ' + shortDate_(c.last) : ', not yet served');
        h += '<span class="c' + (c.preferred ? '' : ' alt') + '" title="' + escapeHtml_(c.notes || '') + '">' +
          escapeHtml_(c.name) + ' <span class="n">' + meta + (c.notes ? ' · ⓘ' : '') + '</span></span>';
      });
    });
  });
  if (!anyOpen) h += '<p>No open slots in this week 🎉</p>';
  h += '<p class="n">Hover a name marked ⓘ to see the roster notes.</p>';
  return h;
}

// ===================== Whatsapp.gs =====================
/**
 * "WhatsApp text for this week" – builds a ready-to-paste broadcast message
 * for the week the cursor is in.
 */
function pawWhatsappForWeek() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const sheet = ss.getActiveSheet();
  const parsed = parseScheduleSheet_(sheet);
  if (!parsed) {
    ui.alert('Open a monthly schedule tab and click inside a week, then try again.');
    return;
  }
  const week = weekForRow_(parsed, ss.getActiveRange().getRow());
  const text = buildWhatsappText_(week);
  const html = HtmlService.createHtmlOutput(
    '<textarea id="t" style="width:100%;height:470px;font-family:monospace;font-size:12px">' +
    escapeHtml_(text) + '</textarea>' +
    '<button onclick="var t=document.getElementById(\'t\');t.select();document.execCommand(\'copy\');' +
    'this.innerText=\'Copied ✓\'" style="margin-top:6px;padding:6px 14px">Copy</button>'
  ).setWidth(520).setHeight(560);
  ui.showModalDialog(html, 'WhatsApp – ' + week.label);
}

function buildWhatsappText_(week) {
  const lines = [];
  lines.push('*JADWAL PAW AOG JKT*');
  lines.push('*' + week.label.trim() + '* – ' + longDateId_(week.date));
  week.blocks.forEach(b => {
    const filled = b.slots.filter(s => s.name);
    if (!filled.length) return;
    lines.push('');
    lines.push('📍 *' + b.church + '*' + (b.group && !/^GROUP\s*$/i.test(b.group) ? ' (' + b.group + ')' : ''));
    filled.forEach(s => lines.push('• ' + (s.position || '-') + ': ' + s.name));
  });
  lines.push('');
  lines.push('Mohon konfirmasi kehadiran ya 🙏 Jika berhalangan, segera kabari koordinator.');
  return lines.join('\n');
}

// ===================== Frequency.gs =====================
/**
 * "Serving frequency report" – counts how many times each person served per
 * month in a given year, read straight from the monthly schedule tabs
 * (replaces filling "Freq 2026" by hand). Swaps "A -> B" count for B.
 * Output: the "PAW FREQUENCY" sheet.
 */
function pawFrequencyReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const thisYear = new Date().getFullYear();
  const resp = ui.prompt('Serving frequency report', 'Which year? (default ' + thisYear + ')', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const year = parseInt(resp.getResponseText(), 10) || thisYear;

  const roster = loadRoster_(ss);
  const { assignments } = collectAssignments_(ss, roster);
  const report = buildFrequency_(assignments, roster, year);
  writeFrequency_(ss, report, year);
  ss.toast(report.rows.length + ' people · ' + report.total + ' slots counted', 'Frequency ' + year, 6);
}

const ROLE_ORDER_ = ['WL', 'GL', 'SINGER', 'KEYS', 'SYNTH', 'GUITAR', 'BASS', 'DRUM', 'VIOLIN'];

function buildFrequency_(assignments, roster, year) {
  const today = startOfDay_(new Date());
  const data = {}; // key -> { months[12], total, last, next, positions{} }
  const sheetsUsed = {};
  let total = 0;
  assignments.forEach(a => {
    if (a.date.getFullYear() !== year) return;
    const d = data[a.key] = data[a.key] || { months: new Array(12).fill(0), total: 0, last: null, next: null, positions: {} };
    d.months[a.date.getMonth()]++;
    d.total++;
    total++;
    if (a.date <= today && (!d.last || a.date > d.last)) d.last = a.date;
    if (a.date > today && (!d.next || a.date < d.next)) d.next = a.date;
    const pos = norm_(a.position).replace(/\s*\d+$/, '').replace(/\s*\(GL\)/, ' (GL)');
    d.positions[pos] = (d.positions[pos] || 0) + 1;
    sheetsUsed[a.sheetName] = true;
  });

  const rows = [];
  roster.people.forEach(p => {
    const d = data[p.name] || { months: new Array(12).fill(0), total: 0, last: null, next: null, positions: {} };
    rows.push({ name: p.name, role: p.roleText, status: p.status, church: p.church, inRoster: true,
      sortRole: p.roles.length ? ROLE_ORDER_.indexOf(p.roles[0]) : 99, active: p.active, ...d });
  });
  Object.keys(data).forEach(k => {
    if (roster.people.some(p => p.name === k)) return;
    rows.push({ name: k, role: '(not in roster)', status: '', church: '', inRoster: false, sortRole: 100, active: true, ...data[k] });
  });
  rows.sort((a, b) => a.sortRole - b.sortRole || a.name.localeCompare(b.name));
  return { rows, total, sheets: Object.keys(sheetsUsed) };
}

function writeFrequency_(ss, report, year) {
  const out = resetSheet_(ss, CFG.FREQ_SHEET);
  out.getRange(1, 1).setValue('Serving frequency ' + year).setFontSize(14).setFontWeight('bold');
  out.getRange(2, 1).setValue('Generated ' + new Date().toLocaleString() + ' from: ' + report.sheets.join(', ') +
    '. Swaps "A -> B" count for B. Unknown names: add them to ' + CFG.ALIAS_SHEET + '.');

  const header = ['Name', 'Role', 'Status', 'Church'].concat(SHORT_MONTHS)
    .concat(['Total', 'Last served', 'Next scheduled', 'Positions']);
  const H = 4;
  out.getRange(H, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#cfe2f3');
  out.setFrozenRows(H);
  out.setFrozenColumns(1);
  if (!report.rows.length) return;

  const rows = report.rows.map(r => [r.name, r.role, r.status, r.church]
    .concat(r.months.map(m => m || ''))
    .concat([r.total, r.last || '', r.next || '',
      Object.keys(r.positions).map(k => k + ' ×' + r.positions[k]).join(', ')]));
  const body = out.getRange(H + 1, 1, rows.length, header.length);
  body.setValues(rows);
  out.getRange(H + 1, 18, rows.length, 2).setNumberFormat('d mmm yyyy');
  out.getRange(H + 1, 5, rows.length, 13).setHorizontalAlignment('center');

  // Grey out inactive people, highlight unknown names.
  const bg = report.rows.map(r => new Array(header.length).fill(!r.inRoster ? '#fce5cd' : (!r.active ? '#eeeeee' : null)));
  body.setBackgrounds(bg);

  // Colour scale on the Total column (low = white, high = green).
  const totalRange = out.getRange(H + 1, 17, rows.length, 1);
  out.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().setGradientMinpoint('#ffffff').setGradientMaxpoint('#57bb8a')
      .setRanges([totalRange]).build(),
  ]);
  out.setColumnWidth(1, 230);
  out.setColumnWidth(2, 120);
  out.setColumnWidth(3, 170);
  out.setColumnWidths(5, 12, 40);
  out.setColumnWidth(20, 300);
  out.activate();
}

// ===================== NewMonth.gs =====================
/**
 * "Create next month tab" – copies the latest monthly schedule tab, names it
 * e.g. "Feb 2027", sets the first Saturday, empties all names, unticks the
 * Avail boxes, and adds/removes the WEEK V block to match the number of
 * Saturdays in the new month. Positions, groups and formatting are kept.
 */
function pawCreateNextMonth() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  let sheets = getScheduleSheets_(ss, { skipIgnored: true }).filter(p => p.month);
  // Base it on the latest *visible* month (hidden tabs are often drafts / archives).
  const visible = sheets.filter(p => !p.sheet.isSheetHidden());
  if (visible.length) sheets = visible;
  if (!sheets.length) { ui.alert('No monthly schedule tab found to copy.'); return; }
  sheets.sort((a, b) => b.month - a.month);
  const src = sheets[0];
  const target = new Date(src.month.getFullYear(), src.month.getMonth() + 1, 1);
  const name = SHORT_MONTHS[target.getMonth()] + ' ' + target.getFullYear();

  const existing = ss.getSheetByName(name);
  if (existing) {
    if (existing.isSheetHidden()) {
      const r = ui.alert('"' + name + '" already exists but is hidden. Unhide it?', ui.ButtonSet.YES_NO);
      if (r === ui.Button.YES) { existing.showSheet(); existing.activate(); }
    } else {
      ui.alert('"' + name + '" already exists.');
      existing.activate();
    }
    return;
  }

  const saturdays = serviceDays_(target);
  const ok = ui.alert('Create next month',
    'Copy "' + src.sheetName + '" to a new tab "' + name + '" with ' + saturdays.length +
    ' weeks (first service ' + longDateId_(saturdays[0]) + ')?\nAll names will be emptied.',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  const sh = src.sheet.copyTo(ss).setName(name);
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(src.sheet.getIndex() + 1);
  if (sh.isSheetHidden()) sh.showSheet();
  prepareMonthSheet_(sh, target, saturdays);
  SpreadsheetApp.flush();
  ss.toast('Created "' + name + '". Fill in the names, then run "Check this month".', 'PAW Scheduling', 8);
}

/** All service days (Saturdays) in the month of `month`. */
function serviceDays_(month) {
  const days = [];
  const d = new Date(month.getFullYear(), month.getMonth(), 1);
  while (d.getDay() !== CFG.SERVICE_WEEKDAY) d.setDate(d.getDate() + 1);
  while (d.getMonth() === month.getMonth()) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return days;
}

const ROMAN_ = ['I', 'II', 'III', 'IV', 'V', 'VI'];

function prepareMonthSheet_(sh, target, saturdays) {
  let parsed = parseScheduleSheet_(sh);

  // 1. Match the number of week blocks to the number of Saturdays.
  while (parsed.weeks.length > saturdays.length) {
    const w = parsed.weeks[parsed.weeks.length - 1];
    sh.deleteRows(w.firstRow, w.lastRow - w.firstRow + 2);
    parsed = parseScheduleSheet_(sh);
  }
  while (parsed.weeks.length < saturdays.length) {
    const last = parsed.weeks[parsed.weeks.length - 1];
    const height = last.lastRow - last.firstRow + 1;
    const lastCol = sh.getLastColumn();
    const destRow = last.lastRow + 2;
    if (sh.getMaxRows() < destRow + height) sh.insertRowsAfter(sh.getMaxRows(), destRow + height - sh.getMaxRows());
    sh.getRange(last.firstRow, 1, height, lastCol).copyTo(sh.getRange(destRow, 1, height, lastCol));
    // New week: dates follow the previous week (+7 days).
    const offset = destRow - last.firstRow;
    last.blocks.forEach(b => {
      sh.getRange(b.dateCell.row + offset, b.dateCell.col)
        .setFormula('=' + a1_(last.blocks[0].dateCell.row, last.blocks[0].dateCell.col) + '+7');
    });
    parsed = parseScheduleSheet_(sh);
  }

  // 2. Week labels, month cell and first date.
  parsed.weeks.forEach((w, i) => {
    const cell = sh.getRange(w.labelRow, findLabelCol_(sh, w.labelRow));
    const old = str_(cell.getValue());
    const suffix = old.replace(/^WEEK\s+[IVX]+\s*/i, '').replace(/\(.*\)/, '').trim();
    cell.setValue('WEEK ' + ROMAN_[i] + (suffix ? ' ' + suffix : ''));
  });
  // Dates: first Saturday typed in once; every other date cell is a formula
  // (same week = first church's cell, next week = previous week + 7), so the
  // churches can never drift apart again.
  const first = parsed.weeks[0].blocks[0].dateCell;
  sh.getRange(first.row, first.col).setValue(saturdays[0]);
  parsed.weeks.forEach((w, i) => {
    const lead = w.blocks[0].dateCell;
    if (i > 0) {
      const prev = parsed.weeks[i - 1].blocks[0].dateCell;
      sh.getRange(lead.row, lead.col).setFormula('=' + a1_(prev.row, prev.col) + '+7');
    }
    w.blocks.slice(1).forEach(b => sh.getRange(b.dateCell.row, b.dateCell.col).setFormula('=' + a1_(lead.row, lead.col)));
  });
  // Month cell at the top (B2 in the existing tabs).
  const top = sh.getRange(1, 1, 3, 4).getValues();
  outer: for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    if (isDate_(top[r][c])) { sh.getRange(r + 1, c + 1).setValue(target); break outer; }
  }

  // 3. Empty names and untick Avail boxes.
  parsed.weeks.forEach(w => w.blocks.forEach(b => b.slots.forEach(s => {
    const nameCell = sh.getRange(s.row, s.col);
    if (!nameCell.getFormula()) nameCell.clearContent();
    const avail = sh.getRange(s.row, s.availCol);
    if (typeof avail.getValue() === 'boolean') avail.setValue(false);
  })));

  // 4. Clear ad-hoc notes to the right of the blocks (e.g. "Drum: pulkam week 3").
  let maxCol = 0;
  parsed.weeks.forEach(w => w.blocks.forEach(b => (maxCol = Math.max(maxCol, b.posCol + 2))));
  const lastCol = sh.getLastColumn();
  if (lastCol > maxCol + 1) sh.getRange(1, maxCol + 2, sh.getMaxRows(), lastCol - maxCol - 1).clearContent();
}

function findLabelCol_(sh, row) {
  const vals = sh.getRange(row, 1, 1, Math.min(sh.getLastColumn(), 6)).getValues()[0];
  for (let c = 0; c < vals.length; c++) if (/^WEEK\b/i.test(str_(vals[c]))) return c + 1;
  return 2;
}

// ===================== Menu.gs =====================
/** Adds the "PAW Scheduling" menu when the spreadsheet is opened. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🎵 PAW Scheduling')
    .addItem('✅ Check this month for problems', 'pawCheckActiveSheet')
    .addItem('🙋 Suggest people for empty slots (this week)', 'pawSuggestForWeek')
    .addItem('💬 WhatsApp text for this week', 'pawWhatsappForWeek')
    .addSeparator()
    .addItem('📊 Serving frequency report…', 'pawFrequencyReport')
    .addItem('🗓️ Create next month tab', 'pawCreateNextMonth')
    .addSeparator()
    .addItem('🔤 Open name aliases sheet', 'pawOpenAliases')
    .addItem('❓ Help', 'pawHelp')
    .addToUi();
}

function pawOpenAliases() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureAliasSheet_(ss).activate();
}

function pawHelp() {
  SpreadsheetApp.getUi().alert('PAW Scheduling',
    '• Check this month: open a month tab (e.g. "Dec 2026"), run it, and see the PAW CHECK sheet ' +
    '(double bookings, inactive people, wrong church, too many times this month, unknown names, open slots).\n\n' +
    '• Suggest people: click inside a week block, run it. Shows who is free and fits each open slot, ' +
    'fewest times served first.\n\n' +
    '• WhatsApp text: click inside a week block, run it, copy the message.\n\n' +
    '• Frequency report: counts every person per month from the schedule tabs into PAW FREQUENCY.\n\n' +
    '• Create next month: copies the latest month tab with empty names and the right Saturdays.\n\n' +
    'Names are matched to "' + CFG.ROSTER_SHEET + '". Swaps written "A -> B" count for B. ' +
    'If a nickname is not recognised, add it to the "' + CFG.ALIAS_SHEET + '" sheet.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}
