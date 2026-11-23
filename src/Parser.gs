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
