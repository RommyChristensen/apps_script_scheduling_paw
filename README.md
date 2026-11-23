# PAW AOG JKT – Scheduling Apps Script

Google Apps Script for the **SCHEDULING PAW AOG JKT** spreadsheet. It adds a
**🎵 PAW Scheduling** menu with tools for the monthly schedule tabs
(`Nov 2026`, `Dec 2026`, `Jan 2027`, …) and the roster in `DATABASE AOG JKT`.

## What it does

| Menu item | What happens |
|---|---|
| ✅ **Check this month for problems** | Open a month tab, run it. A `PAW CHECK` sheet lists everything wrong, each row with a **Go** link to the cell. |
| 🙋 **Suggest people for empty slots** | Click inside a week, run it. For each empty / `-` / `tba` slot, it shows who fits the role, is active, is recommended for that church, isn't already in that week and isn't on leave. People who served least this month are listed first. Hover for roster notes. |
| 💬 **WhatsApp text for this week** | Click inside a week, run it. You get a broadcast message (all 4 churches, positions, names) with a Copy button. |
| 📊 **Serving frequency report** | Counts how often each person served per month, read straight from the month tabs, into `PAW FREQUENCY`. Also shows total, last served, next scheduled and positions. Replaces filling `Freq 2026` by hand. |
| 🗓️ **Create next month tab** | Copies the latest visible month tab to e.g. `Feb 2027`. Names are emptied, Avail boxes unticked, Saturdays set, and WEEK V added or removed as needed. If that tab already exists but is hidden, it offers to unhide it instead. |
| 🔤 **Open name aliases sheet** | `PAW ALIASES`: map a nickname used in the schedule to the full roster name. |

### What "Check this month" looks for
- **ERROR**: the same person twice in one week
- **WARNING**: roster status isn't *Aktif* (Cuti / On Hold / Tidak di Jakarta), with the roster note
- **WARNING**: on leave in the `HIDDEN` izin list on that date
- **WARNING**: church not in the person's *Recommended GL* list (CP / GC / Puri / Pluit)
- **WARNING**: scheduled more than 3× in the month (`MAX_SERVES_PER_MONTH`)
- **WARNING**: one church's date doesn't match the others in that week, or the tab's year doesn't match its name
- **INFO**: role doesn't fit the position (e.g. a non-GL in *SINGER 1 (GL)*), name not found in roster, open slots

### How names are read
- Swaps written `Old -> New` (also `- >`, `→`) count for **New**.
- `-`, `tba`, `TEAM …` mean nobody is scheduled.
- Short names are matched to `DATABASE AOG JKT` automatically: "Kevin Nathanael", "Angelica" → Graciella Angelica Setiawan, "Keisha" → Keisha Kanaiela Jansen, "Jeremiah Nikola" → Jeremia Nikola Wijaya (1-letter typos), "Angie (tadinya ko ayub)" (text in brackets is ignored).
- Anything still unrecognised shows up as *Name not in roster*. Add it to `PAW ALIASES`.

## Install (one time)
You need **edit** access to the spreadsheet.

1. Open the spreadsheet → **Extensions → Apps Script**.
2. For each `.gs` file in [`src/`](src), click **＋ → Script**, name it the same (e.g. `Parser`), and paste the contents. Replace the default `Code.gs` (or delete it).
3. Optional: **Project Settings → Show "appsscript.json"**, then paste [`src/appsscript.json`](src/appsscript.json). This sets the Asia/Jakarta time zone and the V8 runtime.
4. Save, go back to the sheet and reload. The **🎵 PAW Scheduling** menu appears.
5. The first time you use it, Google asks for permission. The script only reads and writes this spreadsheet.

Or with [clasp](https://github.com/google/clasp): `clasp clone <scriptId> --rootDir src`, then `clasp push`.

## Configuration
Everything that depends on the sheet layout is in [`src/Config.gs`](src/Config.gs): sheet names, roster columns,
church codes, max serves per month, and which tabs are ignored when counting (`Copy of …`, `TEMPLATE …`).

## Files
| File | Purpose |
|---|---|
| `Config.gs` | Settings |
| `Parser.gs` | Reads the week/church blocks from a month tab |
| `Roster.gs` | Reads `DATABASE AOG JKT`, name matching, aliases, leave list |
| `Check.gs` | Check this month |
| `Suggest.gs` | Suggestions for open slots |
| `Whatsapp.gs` | WhatsApp text |
| `Frequency.gs` | Frequency report |
| `NewMonth.gs` | Create next month tab |
| `Menu.gs` | Menu + help |
| `Utils.gs` | Shared helpers |
