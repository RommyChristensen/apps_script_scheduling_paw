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
