# GourSafe � University Emergency & Safety App

A mobile-friendly web app giving university students one-tap access to emergency
help: quick-dial contacts, campus security info, incident reporting, and an SOS
button that shares live GPS location with campus security.

Built for **Dr. Harisingh Gour Vishwavidyalaya (A Central University), Sagar, Madhya Pradesh** � a CodeCraft Challenges submission.

Built with **Flask, Supabase Postgres, and Bootstrap 5**; ready for Vercel deployment.

---

## Two Interfaces

This app has two separate front ends, built for two different audiences:

| Interface | Who it's for | Auth? | Entry point |
|---|---|---|---|
| **Student app** | Any student on campus | Sign up, sign in, or continue as guest | `/welcome` |
| **Operator console** | Campus security / IT staff who monitor and act on incoming alerts | Login required | `/operator` |

The operator console is visually distinct on purpose (slate/blue theme
instead of red) so the two never get confused with each other, and uses
a completely separate session system from student accounts � one can
never grant access to the other. A small "Staff / Operator Login" link
sits at the bottom of the student app's side menu � it's intentionally
understated, not a main student action.

## Features

### Student app (public)

| # | Feature | Route |
|---|---------|-------|
| � | Welcome screen: Sign Up / Sign In / Continue as Guest | `/welcome` |
| � | Create an account | `/signup` |
| � | Sign in | `/login` |
| � | Continue without an account (skips profile setup) | `/guest` |
| � | Post-signup profile + emergency contact (skipped for guests) | `/profile-setup` |
| � | End session (works for both guests and signed-in users) | `/logout` |
| 1 | One-tap emergency contacts (tel: links) | `/contacts` |
| 2 | Campus security info (office, hours, guidelines) | `/security` |
| 3 | Report an unsafe situation (saved to Supabase Postgres) | `/report` |
| 4 | SOS button � shares GPS location (saved to Supabase Postgres) | `/` |

Every student route above (1�4) requires having chosen Sign Up, Sign
In, or Guest first � visiting any of them cold redirects to `/welcome`.
Signed-up users are further redirected to `/profile-setup` until they
complete it once; guests skip that step entirely.

### Operator console (login required)

| # | Feature | Route |
|---|---------|-------|
| 5 | Staff login | `/operator/login` |
| 6 | Dashboard � live SOS alerts + incident reports, with counts | `/operator` |
| 7 | Mark an SOS alert active ? handled | `/operator/alerts/<id>/status` |
| 8 | Move a report through new ? acknowledged ? resolved | `/operator/reports/<id>/status` |

---

## Project Structure

```
emergency-safety-app/
+-- app.py                     # Flask routes + Supabase Postgres + auth
+-- requirements.txt           # flask, gunicorn (no new deps � werkzeug ships with Flask)
+-- .env.example               # documents required env vars + future Supabase keys
+-- templates/
�   +-- auth_base.html          # shell for the pre-login pages below (no nav yet)
�   +-- welcome.html             # Sign Up / Sign In / Continue as Guest
�   +-- signup.html
�   +-- login.html
�   +-- profile_setup.html       # post-signup profile + emergency contact (not for guests)
�   +-- base.html                # student navbar, offcanvas menu, bottom tab bar
�   +-- index.html               # home page with quick-dial row + SOS button
�   +-- contacts.html            # full emergency contact cards
�   +-- security_info.html       # static security info page
�   +-- report.html              # incident report form
�   +-- operator_base.html       # operator console shell (distinct slate/blue theme)
�   +-- operator_login.html      # staff login form
�   +-- operator_dashboard.html  # live alerts + reports, status controls, auto-refresh
+-- static/
�   +-- css/style.css           # shared styles: auth pages + student theme + operator theme
�   +-- js/script.js            # geolocation + fetch() logic for SOS + form helpers
�   +-- js/operator.js          # dashboard auto-refresh toggle only
+-- README.md
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

Before starting, set `DATABASE_URL` in `.env` to the Supabase Postgres connection string.

The app will be available at **http://127.0.0.1:5000**

The app requires a reachable Supabase Postgres database; it does not use local database storage.

### 5. Demo walkthrough (5�10 min)

1. **Home (`/`)** � hit the pulsing SOS button, allow location, confirm coordinates sent.
2. **Contacts (`/contacts`)** � show five tap-to-call cards.
3. **Security (`/security`)** � show office info, hours, safety guidelines, muster points.
4. **Report (`/report`)** � submit an anonymous incident; toggle off anonymous to show named submission.
5. **Operator login (`/operator/login`)** � sign in with the default credentials above.
6. **Operator dashboard (`/operator`)** � show the SOS alert and report you just created, click the map icon to open OpenStreetMap, mark the alert "handled" and move the report to "resolved" to show the status workflow.

---

## Deploy to Vercel + Supabase

### Prerequisites
- A GitHub repository
- A Vercel account
- A Supabase project with a Postgres database

### Steps

1. **Push to GitHub**

   ```bash
   git add .
   git commit -m "Add Supabase and Vercel config"
   git push origin main
   ```

2. **Create the Supabase database**
   - In Supabase, open your project and go to SQL editor.
   - Use the app's tables and schema by running the SQL from the project or let the app create them automatically on startup.
   - Keep note of your database connection string.

3. **Set the environment variables in Vercel**
   In the Vercel dashboard: Project ? Settings ? Environment Variables

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | Your Supabase Postgres connection string, e.g. `postgresql://postgres:[PASSWORD]@db.<project-ref>.supabase.co:5432/postgres` |
   | `SECRET_KEY` | A long random secret string |
   | `OPERATOR_USERNAME` | Security staff username |
   | `OPERATOR_PASSWORD_HASH` | Hash of the operator password generated locally |

   To generate the password hash locally:

   ```bash
   python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash('your-real-password'))"
   ```

4. **Deploy to Vercel**
   - Import the repo into Vercel.
   - Use the default Python build settings.
   - Vercel will read `vercel.json` and the Flask app entry point from `app.py`.

5. **Verify the app**
   - Visit the deployed URL.
   - Sign up / sign in as a student.
   - Submit an SOS alert and report.
   - Log in to the operator screen using the configured credentials.

### Notes
- Set `DATABASE_URL` locally and in Vercel to the Supabase Postgres URI; all application data is stored in Supabase.
- The app does not fall back to local storage if the Supabase connection is missing or unavailable.

> Important: the backend reads `DATABASE_URL` / `SUPABASE_DB_URL`, not `NEXT_PUBLIC_SUPABASE_URL`. `NEXT_PUBLIC_*` values are only for browser-side JavaScript.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | Python 3.10+ |
| Backend | Flask + Jinja2 |
| Database | Supabase PostgreSQL via `psycopg` (plain SQL, no ORM) |
| Operator auth | Flask sessions + `werkzeug.security` password hashing (ships with Flask � no new dependency) |
| Frontend | HTML5, CSS3, Bootstrap 5 (CDN), Vanilla JS ES6+ |
