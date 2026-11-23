# Volunteer Directory · PAW AOG JKT

A web app (Google Apps Script) that shows the **DATABASE AOG JKT** sheet of
"SCHEDULING PAW AOG JKT" as a searchable directory.

- View all volunteers as cards or a table
- Filter by **Status Pelayanan**, **Penggembalaan**, **Gereja Lokal** and **Role** (pick several at once)
- Search by name, role or notes (press `/` to jump to search)
- Click someone to see all their details and notes
- Reads the sheet live; press **Refresh** for the latest data

## Files
- `Code.gs` – reads the sheet (`getVolunteers`) and serves the page (`doGet`)
- `Index.html` – the page
- `appsscript.json` – optional project settings

## Deploy
1. Go to <https://script.google.com> → **New project**.
2. Paste `Code.gs` into the default `Code.gs`.
3. Click **＋ → HTML**, name it `Index` (exactly), and paste `Index.html`.
4. Save, then **Deploy → New deployment** → ⚙️ type **Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Only myself** (or people in your organisation). The page shows personal notes, so don't choose "Anyone".
5. **Deploy**, allow the permissions, and open the **Web app URL**.

After changing the code: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
The URL stays the same.

To open the page locally (e.g. to tweak the design), open `Index.html` in a browser. It shows made-up demo data.
