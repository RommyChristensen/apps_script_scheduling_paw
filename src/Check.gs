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
