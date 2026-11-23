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
