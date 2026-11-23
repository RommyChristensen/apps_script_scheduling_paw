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
