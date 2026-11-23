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
