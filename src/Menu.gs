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
