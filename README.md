# GourSafe — University Emergency & Safety App

A mobile-friendly web app giving university students one-tap access to emergency
help: quick-dial contacts, campus security info, incident reporting, and an SOS
button that shares live GPS location with campus security.

Built for **Dr. Harisingh Gour Vishwavidyalaya (A Central University), Sagar, Madhya Pradesh** — a CodeCraft Challenges submission.

Built with **Flask · SQLite · Bootstrap 5** — no paid services, no build step.

---

## Two Interfaces

This app has two separate front ends, built for two different audiences:

| Interface | Who it's for | Auth? | Entry point |
|---|---|---|---|
| **Student app** | Any student on campus | Sign up, sign in, or continue as guest | `/welcome` |
| **Operator console** | Campus security / IT staff who monitor and act on incoming alerts | Login required | `/operator` |

The operator console is visually distinct on purpose (slate/blue theme
instead of red) so the two never get confused with each other, and uses
a completely separate session system from student accounts — one can
never grant access to the other. A small "Staff / Operator Login" link
sits at the bottom of the student app's side menu — it's intentionally
understated, not a main student action.

## Features

### Student app (public)

| # | Feature | Route |
|---|---------|-------|
| — | Welcome screen: Sign Up / Sign In / Continue as Guest | `/welcome` |
| — | Create an account | `/signup` |
| — | Sign in | `/login` |
| — | Continue without an account (skips profile setup) | `/guest` |
| — | Post-signup profile + emergency contact (skipped for guests) | `/profile-setup` |
| — | End session (works for both guests and signed-in users) | `/logout` |
| 1 | One-tap emergency contacts (tel: links) | `/contacts` |
| 2 | Campus security info (office, hours, guidelines) | `/security` |
| 3 | Report an unsafe situation (saved to SQLite) | `/report` |
| 4 | SOS button — shares GPS location (saved to SQLite) | `/` |

Every student route above (1–4) requires having chosen Sign Up, Sign
In, or Guest first — visiting any of them cold redirects to `/welcome`.
Signed-up users are further redirected to `/profile-setup` until they
complete it once; guests skip that step entirely.

### Operator console (login required)

| # | Feature | Route |
|---|---------|-------|
| 5 | Staff login | `/operator/login` |
| 6 | Dashboard — live SOS alerts + incident reports, with counts | `/operator` |
| 7 | Mark an SOS alert active ⇄ handled | `/operator/alerts/<id>/status` |
| 8 | Move a report through new → acknowledged → resolved | `/operator/reports/<id>/status` |

---

## Operator Login — Default Credentials

**Local development only** — the app falls back to these if no
environment variables are set:

- Username: `operator`
- Password: `GourSafe@2026`

**Change this before deploying anywhere real.** See the Render section
below for how to set a real username/password via environment
variables instead of the code default.

---

## Project Structure

```
emergency-safety-app/
├── app.py                     # Flask routes + SQLite + student auth + operator auth
├── requirements.txt           # flask, gunicorn (no new deps — werkzeug ships with Flask)
├── database.db                # auto-created SQLite file (gitignored)
├── render.yaml                # Render deploy config + env var placeholders
├── .env.example                # documents required env vars + future Supabase keys
├── templates/
│   ├── auth_base.html          # shell for the pre-login pages below (no nav yet)
│   ├── welcome.html             # Sign Up / Sign In / Continue as Guest
│   ├── signup.html
│   ├── login.html
│   ├── profile_setup.html       # post-signup profile + emergency contact (not for guests)
│   ├── base.html                # student navbar, offcanvas menu, bottom tab bar
│   ├── index.html               # home page with quick-dial row + SOS button
│   ├── contacts.html            # full emergency contact cards
│   ├── security_info.html       # static security info page
│   ├── report.html              # incident report form
│   ├── operator_base.html       # operator console shell (distinct slate/blue theme)
│   ├── operator_login.html      # staff login form
│   └── operator_dashboard.html  # live alerts + reports, status controls, auto-refresh
├── static/
│   ├── css/style.css          # shared styles: auth pages + student theme + operator theme
│   ├── js/script.js           # geolocation + fetch() logic for SOS + form helpers
│   └── js/operator.js         # dashboard auto-refresh toggle only
└── README.md
```

---

## Run Locally

### 1. Clone / download the project

```bash
git clone <your-repo-url>
cd emergency-safety-app
```

### 2. Create and activate a virtual environment

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS / Linux
python3 -m venv venv
source venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Start the development server

```bash
python app.py
```

The app will be available at **http://127.0.0.1:5000**

`database.db` is created automatically on first run — no setup needed.

### 5. Demo walkthrough (5–10 min)

1. **Home (`/`)** — hit the pulsing SOS button, allow location, confirm coordinates sent.
2. **Contacts (`/contacts`)** — show five tap-to-call cards.
3. **Security (`/security`)** — show office info, hours, safety guidelines, muster points.
4. **Report (`/report`)** — submit an anonymous incident; toggle off anonymous to show named submission.
5. **Operator login (`/operator/login`)** — sign in with the default credentials above.
6. **Operator dashboard (`/operator`)** — show the SOS alert and report you just created, click the map icon to open OpenStreetMap, mark the alert "handled" and move the report to "resolved" to show the status workflow.

---

## Deploy to Render (free tier)

### Prerequisites
- A free account at [render.com](https://render.com)
- Project pushed to a GitHub (or GitLab) repository

### Steps

1. **Push to GitHub**

   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **Create a new Web Service on Render**
   - Go to [dashboard.render.com](https://dashboard.render.com) → **New → Web Service**
   - Connect your GitHub repo
   - Render will detect `render.yaml` automatically and pre-fill:
     - **Build command:** `pip install -r requirements.txt`
     - **Start command:** `gunicorn app:app`
     - **Runtime:** Python 3

3. **Set the operator login environment variables** (Render dashboard →
   your service → **Environment**). `render.yaml` already lists these
   three keys with `sync: false`, which just means "ask me for the
   value" — Render will prompt you to fill them in rather than reading
   them from this file, so no secret ever gets committed to git.

   | Key | Value |
   |---|---|
   | `SECRET_KEY` | Any long random string, e.g. output of `python -c "import secrets; print(secrets.token_hex(32))"` |
   | `OPERATOR_USERNAME` | Whatever username your security/IT staff should use |
   | `OPERATOR_PASSWORD_HASH` | Generate with the command below — **not the plain password itself** |

   To generate the password hash, run this locally with your chosen password:

   ```bash
   python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash('your-real-password'))"
   ```

   Copy the entire output string into the `OPERATOR_PASSWORD_HASH` field on Render.

4. **Deploy**
   - Click **Create Web Service**
   - Render builds and deploys — typically under 2 minutes
   - Your app will be live at `https://<your-service-name>.onrender.com`

### Notes
- `database.db` is stored on Render's ephemeral disk — data resets on each deploy.
  This is fine for a hackathon demo. For persistence, Render offers a persistent
  disk add-on (free tier available).
- If you skip step 3, the app still runs — it just falls back to the
  local dev credentials (`operator` / `GourSafe@2026`) and an insecure
  default `SECRET_KEY`. Fine for a demo you control; change it before
  giving anyone else the URL.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | Python 3.10+ |
| Backend | Flask + Jinja2 |
| Database | SQLite via `sqlite3` (plain SQL, no ORM) |
| Operator auth | Flask sessions + `werkzeug.security` password hashing (ships with Flask — no new dependency) |
| Frontend | HTML5, CSS3, Bootstrap 5 (CDN), Vanilla JS ES6+ |
| Production server | Gunicorn |
| Hosting | Render (free Web Service tier) |
