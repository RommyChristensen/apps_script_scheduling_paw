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
