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
