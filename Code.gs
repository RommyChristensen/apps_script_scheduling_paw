/**
 * Volunteer Directory – PAW AOG JKT
 * A web app that shows the "DATABASE AOG JKT" sheet with search and filters.
 *
 * Deploy: Deploy → New deployment → Web app.
 */

// The "SCHEDULING PAW AOG JKT" spreadsheet (the long ID in its URL).
const SPREADSHEET_ID = '1imQp5-WFAHrw-a3zQoXPK7StaDrxSf8A8hX0NcCv5cY';
const SHEET_NAME = 'DATABASE AOG JKT';
const HEADER_ROW = 2; // headers are in row 2, data starts in row 3

// field: [header text in the sheet, column letter to use if the header isn't found]
const COLUMNS = {
  name:        ['Nama', 'C'],
  role:        ['Role', 'D'],
  gender:      ['M/F', 'E'],
  status:      ['Status Pelayanan', 'F'],
  church:      ['Gereja Lokal', 'G'],
  pengg:       ['Pengembalaan', 'H'],
  assignedGL:  ['Assigned GL', 'I'],
  recommended: ['Recommended GL', 'J'],
  notes:       ['Notes', 'K'],
  deptLain:    ['Pelayanan Dept Lain', 'L'],
  deptName:    ['Dept lain', 'M'],
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Volunteers · PAW AOG JKT')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called by the page. Returns plain objects only (no Date objects). */
function getVolunteers() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + SHEET_NAME + '" not found.');
  const values = sheet.getDataRange().getValues();
  const norm = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toUpperCase();
  const header = (values[HEADER_ROW - 1] || []).map(norm);

  const col = {};
  Object.keys(COLUMNS).forEach(k => {
    const [title, letter] = COLUMNS[k];
    const i = header.indexOf(norm(title));
    col[k] = i >= 0 ? i : letter.charCodeAt(0) - 65;
  });

  const clean = v => {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return /^(none|null|false|-|n\/a)$/i.test(s) ? '' : s;
  };
  const titleCase = s => s.length <= 3 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1);

  const people = [];
  for (let r = HEADER_ROW; r < values.length; r++) {
    const row = values[r];
    const name = clean(row[col.name]).replace(/\?+$/, '').trim();
    if (!name) continue;
    const role = clean(row[col.role]);
    const status = clean(row[col.status]) || 'Unknown';
    people.push({
      id: r + 1,
      name,
      role,
      roles: role.split(/[,/&]+/).map(s => s.trim()).filter(Boolean).map(titleCase),
      gender: clean(row[col.gender]).toUpperCase(),
      status,
      active: /^(aktif|active)/i.test(status),
      church: clean(row[col.church]) || 'Unknown',
      pengg: clean(row[col.pengg]) || 'Not set',
      assignedGL: clean(row[col.assignedGL]).replace(/\.0$/, ''),
      recommended: clean(row[col.recommended]).split(/\s*,\s*/).filter(Boolean),
      notes: clean(row[col.notes]),
      deptLain: /^(yes|ya|true)$/i.test(clean(row[col.deptLain])),
      deptName: clean(row[col.deptName]),
    });
  }
  return { people, updatedAt: new Date().toISOString() };
}
