# Design — University Emergency & Safety App

## 1. Architecture Overview

```
Browser (mobile-first)
  │  Bootstrap 5 (CDN) + vanilla JS (static/js/script.js)
  │  HTML rendered by Jinja2 templates
  │
  ▼
Flask (app.py)
  │  Route handlers — one function per page
  │  Plain SQL via sqlite3 (no ORM)
  │
  ▼
SQLite (database.db)
  ├── reports       — incident reports from /report
  └── sos_alerts    — GPS pings from the SOS button
```

No build step. No JS framework. No external API calls. All pages are
server-rendered Jinja2 templates that extend `base.html`.

---

## 2. File Structure

```
emergency-safety-app/
├── app.py                  # All Flask routes + SQLite setup/queries
├── requirements.txt        # flask, gunicorn
├── database.db             # auto-created on first run (gitignored)
├── render.yaml             # Render free-tier deploy config
├── templates/
│   ├── base.html           # Bootstrap CDN, sticky navbar, bottom tab bar
│   ├── index.html          # Home: SOS button + quick-call strip + nav tiles
│   ├── contacts.html       # Full 5-card emergency contact list
│   ├── security_info.html  # Static: office, hours, guidelines, muster points
│   ├── report.html         # Incident report form (GET + POST)
│   └── admin_reports.html  # Admin: reports table + sos_alerts table
└── static/
    ├── css/style.css       # Custom overrides (dark theme, SOS button, cards)
    └── js/script.js        # sendSOS(), toggleName() — no inline <script> blocks
```

---

## 3. Database Schema

All tables are created in `init_db()` inside `app.py` using `CREATE TABLE IF NOT
EXISTS`. No migration tool is used.

### `reports`
```sql
CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    anonymous   INTEGER NOT NULL DEFAULT 1,   -- 1 = yes, 0 = no
    name        TEXT,                         -- empty string when anonymous
    category    TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at  TEXT NOT NULL                 -- UTC, format: YYYY-MM-DD HH:MM:SS
);
```

### `sos_alerts`
```sql
CREATE TABLE IF NOT EXISTS sos_alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    latitude    REAL NOT NULL,
    longitude   REAL NOT NULL,
    accuracy    REAL,                         -- metres; NULL if browser omits it
    created_at  TEXT NOT NULL                 -- UTC, format: YYYY-MM-DD HH:MM:SS
);
```

---

## 4. Routes

All routes are defined in `app.py`, grouped in the same order as the folder list
above. Every route function has a one-line descriptive comment.

| Method | Path | Function | Template |
|--------|------|----------|----------|
| GET | `/` | `index()` | `index.html` |
| GET | `/contacts` | `contacts()` | `contacts.html` |
| GET | `/security` | `security_info()` | `security_info.html` |
| GET, POST | `/report` | `report()` | `report.html` |
| POST | `/api/sos` | `api_sos()` | — (JSON response) |
| GET | `/admin/reports` | `admin_reports()` | `admin_reports.html` |

### `/contacts` — GET logic
Renders the full five-card emergency contact list. No database access.

### `/security` — GET logic
Renders the static campus security info page. No database access; always
available even if `database.db` has not been initialised.

### `/report` — POST logic

```
1. Read form fields: anonymous (checkbox), name, category, description
2. If description is empty/whitespace → re-render form with error="Description is required."
3. If anonymous == "on" → set anonymous=1, name=""
4. Else → set anonymous=0, name=form["name"].strip()
5. category defaults to "Other" if blank
6. INSERT into reports; db.commit()
7. Re-render form with success=True
```

### `/api/sos` — POST logic

```
1. Parse JSON body → { latitude, longitude, accuracy }
2. If body missing or fields non-numeric → return 400 { ok: false, error: "..." }
3. INSERT into sos_alerts; db.commit()
4. Return 200 { ok: true, message: "Location received. Help is on the way." }
```

---

## 5. Frontend — SOS Flow (`static/js/script.js`)

```
sendSOS()
  ├── disable SOS button
  ├── showState("locating")
  ├── getPosition()           ← promisified getCurrentPosition (timeout: 15 s)
  │   ├── on error → showState("error") + geolocationErrorMessage(err)
  │   │              re-enable button
  │   └── on success →
  │       showState("sending")
  │       fetch POST /api/sos  { latitude, longitude, accuracy }
  │       ├── on network/server error → showState("error") + re-enable button
  │       └── on ok:true → populate #outLat/#outLon/#outAcc
  │                         showState("success")
  │                         keep button disabled (one ping per page load)
  └── (synchronous path ends here)
```

**Error code mapping** (`geolocationErrorMessage`):

| Code | Meaning | User message |
|------|---------|--------------|
| 1 | PERMISSION_DENIED | Allow location in browser settings and try again |
| 2 | POSITION_UNAVAILABLE | Enable GPS / location services |
| 3 | TIMEOUT | Move to an open area and try again |
| — | API not supported (`navigator.geolocation` undefined) | Not supported by this browser |

**`toggleName(checkbox)`** — called by the anonymous toggle's `onchange` in
`report.html`. Shows/hides `#nameField` based on `checkbox.checked`.

---

## 6. Templates

### `base.html`
- Bootstrap 5.3.3 and Bootstrap Icons 1.11.3 loaded via CDN `<link>` / `<script>`.
- Sticky `<nav class="navbar navbar-dark bg-danger">` with brand + hamburger.
- Off-canvas side menu with links to all five routes.
- Fixed bottom tab bar with four tabs: **Home** (house icon), **Contacts**
  (phone icon), **Security** (building-lock icon), **Report** (flag icon).
  Active tab highlighted via `{{ 'active' if request.endpoint == '<name>' }}`.
  The SOS button lives on the Home page — there is no dedicated SOS tab.
- `<script src="{{ url_for('static', filename='js/script.js') }}">` loaded before
  `</body>` — after Bootstrap bundle.
- `{% block scripts %}{% endblock %}` for page-specific overrides (currently unused).
- **No inline `<script>` blocks** in any template except for passing small
  server-side variables (none currently needed).

### `index.html`
- Pulsing SOS button (`<button id="sosBtn" onclick="sendSOS()">`)
- Status panel with four state divs: `#stateLocating`, `#stateSending`,
  `#stateSuccess`, `#stateError` — toggled by `showState()` in script.js.
- On success, `#outLat`, `#outLon`, `#outAcc` are populated with the sent coordinates.
- Quick-call strip: Campus Security + Ambulance `tel:` buttons (always visible).
- 2×2 nav tile grid linking to: All Contacts, Security Info, Report Incident, Admin View.

### `contacts.html`
- Five `.contact-card` elements, each an `<a href="tel:...">` wrapping:
  an icon circle (`.contact-card__icon`), label + number (`.contact-card__body`),
  and a phone icon CTA (`.contact-card__cta`).
- Left border colour per service: red (Security, Ambulance), orange (Fire),
  blue (Police), teal (Hostel Warden).
- Two CTA buttons at the bottom: Back to Home / SOS, Report Incident.

### `security_info.html`
- Four Bootstrap dark cards: Office Location, Operating Hours (table), Safety
  Guidelines (`.safety-list`), Emergency Muster Points (2×2 tile grid).
- Two CTA buttons at the bottom: Send SOS (links to `/`), View Emergency Contacts.
- No Jinja2 conditionals — fully static content, no database reads.

### `admin_reports.html`
- Two sections: Incident Reports and SOS Alerts, each with a count badge.
- Incident Reports table columns: `#`, Time (UTC), Category (warning badge),
  Reporter (Anonymous / name), Description (`.report-desc` truncated cell).
- SOS Alerts table columns: `#`, Time (UTC), Latitude, Longitude, Accuracy (m),
  Map (OpenStreetMap link button).
- Empty-state `alert-secondary` shown when either table has zero rows.

### `report.html`
- Form `method="POST"` to `{{ url_for('report') }}`.
- Anonymous toggle (`id="anonymous"` checkbox, `onchange="toggleName(this)"`).
- Name field (`id="nameField"`, initially `display:none`).
- Category `<select>` with 9 options.
- Description `<textarea>`.
- Jinja2 conditionals for `{% if success %}` and `{% if error %}` banners.
- No inline `<script>` block; `toggleName` lives in `script.js`.

---

## 7. Styling (`static/css/style.css`)

Custom rules supplement Bootstrap; they do not replace it. Key components:

| Component | Description |
|-----------|-------------|
| `.bottom-nav` | Fixed bottom tab bar, height 64 px, z-index 1030 |
| `.contact-card` | Dark card with coloured left border (red/orange/blue/teal) |
| `.sos-btn` | 180 px circular button with CSS keyframe pulse + ring animations |
| `.safety-list li` | Bottom-bordered list items for guidelines |
| `.muster-point` | 2×2 grid tiles for muster points |
| `.tile-card` | 2×2 nav tile on home page — dark card with centred icon + label |
| `.report-desc` | Max-width 260 px, `pre-wrap` description cell in admin table |

Dark background: `#121212`. Card background: `#1e1e1e`. All form controls use
Bootstrap's `bg-dark text-white border-secondary` classes.

---

## 8. Error Handling Summary

| Scenario | Handling |
|----------|----------|
| Empty description on report form | Server-side: re-render with `error` variable |
| SOS — permission denied | JS: `showState("error")` + code-1 message |
| SOS — position unavailable | JS: `showState("error")` + code-2 message |
| SOS — geolocation timeout (15 s) | JS: `showState("error")` + code-3 message |
| SOS — API not supported | JS: `showState("error")` + not-supported message |
| SOS — server/network error | JS: `showState("error")` + re-enable button |
| `/api/sos` bad payload | Flask: HTTP 400 + `{ ok: false, error: "..." }` |
| `/security` when DB is down | No DB dependency — static page always loads |

---

## 9. Deployment

`render.yaml` configures a Render Web Service:

```yaml
services:
  - type: web
    name: unisafe
    runtime: python
    buildCommand: pip install -r requirements.txt
    startCommand: gunicorn app:app
    envVars:
      - key: PYTHON_VERSION
        value: "3.11.0"
```

`database.db` lives on Render's ephemeral disk — acceptable for demo.
No environment variables or secrets are required.
