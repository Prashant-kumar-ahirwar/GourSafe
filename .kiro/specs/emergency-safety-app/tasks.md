# Tasks — University Emergency & Safety App

Implementation checklist ordered so each task can be reviewed independently
in under 10 minutes. Tasks are sequenced so no task depends on a later one.
All work stays within the stack defined in the tech steering file.

Requirements references use the IDs from `requirements.md`.

---

## Task 1 — Create SQLite tables ✅

**File:** `app.py` (only the `init_db()` function and the two `CREATE TABLE`
statements)

Write `init_db()` inside `app.py`. It must create **both** tables in a single
function using `CREATE TABLE IF NOT EXISTS` so the database is ready after one
call. Also write `get_db()` (opens a request-scoped connection with
`row_factory = sqlite3.Row`) and `close_db()` (teardown hook that closes it).

Tables to create:

```sql
CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    anonymous   INTEGER NOT NULL DEFAULT 1,
    name        TEXT,
    category    TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sos_alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    latitude    REAL NOT NULL,
    longitude   REAL NOT NULL,
    accuracy    REAL,
    created_at  TEXT NOT NULL
);
```

Call `init_db()` at the bottom of `app.py` so running `python app.py` creates
`database.db` automatically on first run.

**Acceptance:** `python app.py` exits without error; `database.db` exists;
both tables visible via `sqlite3 database.db .tables`.

Covers: REQ-NF-3

---

## Task 2 — Project scaffold

**Files:** `requirements.txt`, `render.yaml`, `.gitignore`, folder structure

Create the required directories (`templates/`, `static/css/`, `static/js/`) and
the three config files:

- `requirements.txt` — `flask==3.0.3` and `gunicorn==22.0.0` only
- `render.yaml` — Render Web Service config with `startCommand: gunicorn app:app`
  and `PYTHON_VERSION: "3.11.0"`
- `.gitignore` — exclude `database.db`, `__pycache__/`, `venv/`, `.venv/`

**Acceptance:** `pip install -r requirements.txt` completes; `render.yaml`
contains the gunicorn start command; directories exist.

Covers: REQ-NF-4, REQ-NF-5

---

## Task 3 — Flask routes (all six)

**File:** `app.py` (route functions only — no template HTML in this task)

Write all six route functions below `init_db()`. Every function gets a one-line
comment explaining what it does. Group them in this order:

| # | Method | Path | Function | Purpose |
|---|--------|------|----------|---------|
| 1 | GET | `/` | `index()` | Home page — SOS button + quick-call strip |
| 2 | GET | `/contacts` | `contacts()` | Full five-card emergency contact list |
| 3 | GET | `/security` | `security_info()` | Static campus security info |
| 4 | GET, POST | `/report` | `report()` | Incident report form + submission handler |
| 5 | POST | `/api/sos` | `api_sos()` | Receive GPS ping, save to `sos_alerts`, return JSON |
| 6 | GET | `/admin/reports` | `admin_reports()` | Admin view — both tables, newest first |

**`report()` POST logic:**
1. Read `anonymous` (checkbox), `name`, `category`, `description` from form.
2. If `description` is empty/whitespace → re-render with `error="Description is required."` — do NOT write to DB.
3. If anonymous checked → `anonymous=1`, `name=""`.
4. Else → `anonymous=0`, `name=form["name"].strip()`.
5. `category` defaults to `"Other"` if blank.
6. Wrap the `INSERT` in a `try/except`; on failure log the error and re-render with a friendly error message (REQ-NF-6).
7. On success → re-render with `success=True`.

**`api_sos()` POST logic:**
1. Parse JSON body → `{ latitude, longitude, accuracy }`.
2. If body missing or coordinates non-numeric → return HTTP 400 `{ "ok": false, "error": "..." }`.
3. Wrap `INSERT` in `try/except`; on failure return HTTP 500 `{ "ok": false, "error": "Database error." }` (REQ-NF-6).
4. On success → return HTTP 200 `{ "ok": true, "message": "Location received. Help is on the way." }`.

**Acceptance:** `python app.py` starts without import errors; visiting `/`,
`/contacts`, `/security`, `/report`, `/admin/reports` in a browser returns
HTTP 200 (templates don't need to exist yet — a placeholder string is fine).

Covers: REQ-3.2, REQ-3.3, REQ-3.4, REQ-3.5, REQ-3.6, REQ-4.2, REQ-4.10,
REQ-5.1, REQ-5.2, REQ-NF-2, REQ-NF-2a, REQ-NF-6

---

## Task 4 — base.html (shared layout)

**File:** `templates/base.html`

This is the single layout all other templates extend with `{% extends "base.html" %}`.
Nothing in this file should be duplicated in a child template.

Must include:
- `<meta name="viewport" content="width=device-width, initial-scale=1.0">` for mobile.
- Bootstrap 5.3.3 CSS + Bootstrap Icons 1.11.3 loaded from CDN `<link>` tags.
- Sticky `<nav class="navbar navbar-dark bg-danger">` with the UniSafe brand and
  a hamburger button that opens the off-canvas side menu.
- Off-canvas side menu with links to all six destinations
  (`/`, `/contacts`, `/security`, `/report`, `/admin/reports`).
- `<main>` block wrapping `{% block content %}{% endblock %}`.
- Fixed bottom tab bar with exactly four tabs:
  **Home** (house icon), **Contacts** (phone icon), **Security** (building-lock icon),
  **Report** (flag icon). Active tab set via
  `{{ 'active' if request.endpoint == '<name>' }}`.
- Bootstrap JS bundle and `script.js` loaded via `<script>` tags before `</body>`.
- `{% block scripts %}{% endblock %}` after the script tags.
- **No inline `<script>` blocks** anywhere in this file.

**Acceptance:** All child templates render without Jinja2 errors; bottom tabs
appear on every page; active tab highlights correctly on each route.

Covers: REQ-NF-1

---

## Task 5 — index.html (Home + SOS button)

**File:** `templates/index.html`

The home page is the first screen a panicking student sees. It must show the SOS
button immediately, with zero scrolling required on a 375 px viewport.

Must include:
- Pulsing `<button id="sosBtn" onclick="sendSOS()">` — large, centred, red.
- Status panel `<div id="statusPanel" class="d-none">` containing four child divs,
  all `d-none` by default:
  - `#stateLocating` — spinner + "Getting your location…"
  - `#stateSending` — spinner + "Sending to security…"
  - `#stateSuccess` — success alert showing `#outLat`, `#outLon`, `#outAcc`
  - `#stateError` — danger alert showing `#errorMsg`
- Quick-call strip below the status panel: Campus Security + Ambulance as
  `<a href="tel:...">` buttons — **always visible**, never hidden.
- 2×2 nav tile grid linking to: All Contacts, Security Info, Report Incident,
  Admin View.
- **No inline `<script>` block** — SOS logic lives in `script.js`.

**Acceptance:** Page loads; SOS button is visible above the fold at 375 px;
call strip shows two phone buttons; tile grid shows four links.

Covers: REQ-1.3, REQ-4.1, REQ-4.9

---

## Task 6 — contacts.html (Emergency Contacts)

**File:** `templates/contacts.html`

Must include:
- Five contact cards, each an `<a href="tel:...">` element (not a `<button>`) so
  tapping on a real phone initiates a call with no extra step.
- Contacts in order: Campus Security, Ambulance / Medical, Fire Service, Police,
  Hostel Warden.
- Each card shows: a coloured icon circle, the service name, the phone number.
- Left-border colour per card: red (Security, Ambulance), orange (Fire),
  blue (Police), teal (Warden).
- Phone numbers must appear as visible text for desktop users who cannot tap-to-call
  (REQ-1.4).
- Two CTA buttons at the bottom: back to Home / SOS, and Report Incident.

**Acceptance:** All five cards render; each is a valid `tel:` link; phone numbers
are readable as plain text in a desktop browser; no JS errors.

Covers: REQ-1.1, REQ-1.2, REQ-1.4

---

## Task 7 — security_info.html (Campus Security Information)

**File:** `templates/security_info.html`

All content is static — this page must load even if `database.db` does not exist.

Must include four sections (use Bootstrap cards):
1. **Office Location** — building name, floor, nearest landmark.
2. **Operating Hours** — table with rows for Main Gate, Security Office,
   Night Patrol, Emergency Line (24/7).
3. **Safety Guidelines** — unordered list with at least six items.
4. **Emergency Muster Points** — 2×2 grid of four named locations.

Also include at the bottom:
- Primary CTA button: "Send SOS" linking to `/` (the home page SOS button).
- Secondary link: "View Emergency Contacts" linking to `/contacts`.

**No Jinja2 conditionals, no `get_db()` calls, no template variables** — pure
static HTML inside the Jinja2 `{% block content %}` block.

**Acceptance:** Page renders with DB deleted; all four sections visible; both
CTA buttons navigate to the correct routes.

Covers: REQ-2.1, REQ-2.2, REQ-2.3

---

## Task 8 — report.html (Incident Report Form)

**File:** `templates/report.html`

Must include:
- `<form method="POST" action="{{ url_for('report') }}" novalidate>`.
- Anonymous toggle: `<input type="checkbox" id="anonymous" name="anonymous"
  checked onchange="toggleName(this)">` — checked by default.
- Name field `<div id="nameField" style="display:none;">` — hidden when anonymous
  is checked; shown when unchecked (driven by `toggleName()` in `script.js`).
- Category `<select name="category" required>` with a disabled placeholder option
  and these nine values: Theft, Harassment, Physical Assault, Suspicious Activity,
  Vandalism, Fire Hazard, Medical Emergency, Unsafe Infrastructure, Other.
- Description `<textarea name="description" required>`.
- Submit button.
- `{% if success %}` — green success alert: "Report submitted."
- `{% if error %}` — red error alert: displays the `error` string from Flask.
- **No inline `<script>` block** — `toggleName` is in `script.js`.

**Acceptance:** Form renders; anonymous toggle hides/shows name field without
page reload; submitting blank description shows error banner; successful submit
shows success banner; second visit to `/report` shows a clean empty form.

Covers: REQ-3.1, REQ-3.3 (client hint), REQ-3.4, REQ-3.5

---

## Task 9 — admin_reports.html (Admin View)

**File:** `templates/admin_reports.html`  
Location: flat inside `templates/` — **not** in a subfolder.

Must include two independent sections:

**Section 1 — Incident Reports**
- Heading with a count badge showing `{{ reports | length }}`.
- Table columns: `#`, Time (UTC), Category (styled as a warning badge),
  Reporter ("Anonymous" in italic if `r['anonymous']`, else the name), Description.
- If `reports` is empty → show an `alert-secondary` empty-state message instead
  of the table.

**Section 2 — SOS Alerts**
- Heading with a count badge showing `{{ sos_alerts | length }}`.
- Table columns: `#`, Time (UTC), Latitude (6 d.p.), Longitude (6 d.p.),
  Accuracy (1 d.p., metres), Map (link button to OpenStreetMap at those coordinates
  — opens in new tab).
- If `sos_alerts` is empty → show an `alert-secondary` empty-state message.

**Acceptance:** Both tables render; empty-state messages appear when tables are
empty; OpenStreetMap links open at the correct coordinates.

Covers: REQ-5.1, REQ-5.2, REQ-5.3, REQ-NF-2a

---

## Task 10 — SOS Flask route (api_sos)

**File:** `app.py` — the `api_sos()` function only

> This task is intentionally scoped to the Python side of SOS only.
> The JavaScript side is Task 11.

Refine the `api_sos()` function (stub written in Task 3) to be production-ready:

- Accept `Content-Type: application/json` POST only; reject other content types
  with HTTP 400.
- Parse `latitude`, `longitude`, `accuracy` from the JSON body.
- Return HTTP 400 `{ "ok": false, "error": "Invalid coordinates" }` if any of
  the three fields is missing, non-numeric, or if the body cannot be parsed.
- Wrap the `db.execute(INSERT …)` + `db.commit()` in a `try/except sqlite3.Error`;
  on failure log `app.logger.error(...)` and return HTTP 500
  `{ "ok": false, "error": "Database error. Please call security directly." }`.
- On success return HTTP 200 `{ "ok": true, "message": "Location received. Help is on the way." }`.

**Acceptance:** `curl -X POST /api/sos -H "Content-Type: application/json"
-d '{"latitude":6.5,"longitude":3.3,"accuracy":10}'` returns `{"ok":true,...}`;
missing field returns HTTP 400; row appears in `sos_alerts` table.

Covers: REQ-4.2, REQ-4.10, REQ-NF-6

---

## Task 11 — SOS geolocation JS (script.js)

**File:** `static/js/script.js`

> This task is intentionally scoped to the JavaScript side of SOS only.
> The Flask route is Task 10.

Write the entire `script.js` file. It must export no globals beyond the four
functions listed below (all called directly from HTML `onclick`/`onchange`).

**`sendSOS()`**
1. Disable `#sosBtn`.
2. Call `showState("locating")`.
3. Await `getPosition()`. On error → `showState("error")`, set `#errorMsg` to
   `geolocationErrorMessage(err)`, re-enable button, return.
4. On success → `showState("sending")`.
5. `fetch` POST `/api/sos` with `{ latitude, longitude, accuracy }` as JSON.
6. On network failure or `data.ok === false` → `showState("error")`, set
   `#errorMsg`, re-enable button.
7. On success → populate `#outLat`, `#outLon`, `#outAcc`; call
   `showState("success")`; leave button disabled.

**`getPosition()`**
- Returns a `Promise<GeolocationPosition>`.
- If `navigator.geolocation` is `undefined` → rejects with a plain `Error`.
- Calls `getCurrentPosition` with `enableHighAccuracy: true`, `timeout: 15000`,
  `maximumAge: 0`.

**`geolocationErrorMessage(err)`**
- Maps `err.code` 1 → permission denied message, 2 → unavailable message,
  3 → timeout message, anything else → generic message.

**`showState(state)`**
- Removes `d-none` from the matching `#state<State>` div; adds `d-none` to all
  others; removes `d-none` from `#statusPanel`.

**`toggleName(checkbox)`**
- Shows `#nameField` when `checkbox.checked` is `false`; hides it when `true`.

**Acceptance:** In a browser — tap SOS, allow location, confirm success state
shows coordinates. Deny location, confirm error message shown and button
re-enabled. Toggle anonymous switch on report form, confirm name field
shows/hides.

Covers: REQ-4.2, REQ-4.3, REQ-4.4, REQ-4.5, REQ-4.6, REQ-4.7, REQ-4.8

---

## Task 12 — style.css (custom overrides)

**File:** `static/css/style.css`

Bootstrap handles the grid, spacing, and typography. This file adds only what
Bootstrap does not provide. Key rules to write:

| Selector | Purpose |
|----------|---------|
| `:root` | CSS custom properties: `--color-danger`, `--color-dark-bg` (`#121212`), `--color-card-bg` (`#1e1e1e`), `--bottom-nav-h` (`64px`) |
| `body` | `padding-bottom: calc(var(--bottom-nav-h) + 1rem)` so content clears the fixed nav |
| `.bottom-nav` | `position: fixed; bottom: 0; height: var(--bottom-nav-h); z-index: 1030` |
| `.bottom-nav__item` | Flex column, centred icon + label, colour transitions |
| `.contact-card` | Dark card with `border-left: 4px solid` variants `--red`, `--orange`, `--blue`, `--teal` |
| `.sos-btn` | `180px` circle, `background: var(--color-danger)`, `animation: sos-pulse` |
| `@keyframes sos-pulse` | Box-shadow pulse outward and fade |
| `.sos-btn__ring` | Absolutely positioned ring with `@keyframes sos-ring` scale + fade |
| `.tile-card` | Dark card, centred icon + label, used for the 2×2 home nav grid |
| `.safety-list li` | Bottom border between guideline items |
| `.muster-point` | Tile styling for the 2×2 muster point grid |
| `.report-desc` | `max-width: 260px; white-space: pre-wrap; word-break: break-word` |
| `@media (max-width: 400px)` | Reduce SOS button to `150px` on very small screens |

**Acceptance:** SOS button pulses visually; bottom nav is fixed and clears page
content; contact cards show coloured left borders; no horizontal scroll at 375 px.

Covers: REQ-NF-1

---

## Task 13 — README.md

**File:** `README.md` (project root)

Write a README a frontend developer with no Python experience can follow without
help. Sections required:

1. **What this is** — one-paragraph description of the app and its four features.
2. **Project structure** — the folder tree with a one-line comment per file.
3. **Run locally** — exact steps:
   a. `python -m venv venv` + activate command (Windows and macOS/Linux variants).
   b. `pip install -r requirements.txt`.
   c. `python app.py`.
   d. Open `http://127.0.0.1:5000`.
4. **Demo walkthrough** — numbered 5-step script usable during a competition demo.
5. **Deploy to Render** — exact steps: push to GitHub, create Web Service,
   connect repo, click deploy. Note that `render.yaml` pre-fills the build and
   start commands.
6. **Tech stack table** — Layer / Technology rows matching the steering spec.

**Acceptance:** A developer who has never seen the project can run it locally
following only the README, with no outside help.

---

## Task 14 — End-to-end demo test

**How to run:** `python app.py`, then follow each step in a browser at
`http://127.0.0.1:5000`. No automated test runner — this is a manual checklist.

Work through every step below in order. Mark each one as you go.

### Happy path

- [ ] **Home page loads** — SOS button visible above the fold; quick-call strip
  shows two phone buttons; four nav tiles visible.
- [ ] **SOS — allow location** — tap SOS button, allow location when browser
  prompts; confirm success state shows latitude, longitude, accuracy; button
  stays disabled.
- [ ] **SOS row saved** — visit `/admin/reports`; confirm one row in SOS Alerts
  table with correct coordinates; OpenStreetMap link opens at that location.
- [ ] **Contacts page** — all five cards render; each card shows a readable
  phone number; on a real phone, tapping a card dials.
- [ ] **Security info page** — all four sections visible (office, hours,
  guidelines ≥ 6 items, muster points); "Send SOS" CTA returns to home page.
- [ ] **Report — anonymous** — submit form with anonymous checked, a category,
  and a description; confirm success banner; visit `/admin/reports` and confirm
  "Anonymous" in reporter column.
- [ ] **Report — named** — uncheck anonymous, enter a name, submit; confirm name
  appears in admin table.
- [ ] **Admin page** — both tables show data; count badges are correct;
  empty-state messages do not appear when rows exist.

### Error paths

- [ ] **Empty description** — submit report form with blank description; confirm
  error banner shown; confirm no new row in admin table.
- [ ] **SOS — deny location** — reload home page, tap SOS, deny location
  permission; confirm error message shown mentioning browser settings; confirm
  button is re-enabled; confirm no new row added to SOS Alerts.
- [ ] **SOS — geolocation not available** — in browser DevTools, override
  geolocation to "blocked" or use a browser that disables it; tap SOS; confirm
  appropriate error message appears.

### Layout check

- [ ] **375 px viewport** — open DevTools, set device to iPhone SE (375 × 667);
  confirm no horizontal scroll on any page; SOS button fully visible; bottom nav
  labels readable; contact cards at least 48 px tall.

**Acceptance:** All checkboxes above pass with no Python tracebacks in the
terminal and no JS errors in the browser console.

Covers: REQ-1.1, REQ-1.2, REQ-1.3, REQ-1.4, REQ-2.1, REQ-2.2, REQ-2.3,
REQ-3.1, REQ-3.2, REQ-3.3, REQ-4.1 through REQ-4.9, REQ-5.1, REQ-5.2,
REQ-5.3, REQ-NF-1, REQ-NF-2a
