import os
import functools
import sqlite3
from datetime import datetime, timezone
from flask import Flask, render_template, request, redirect, url_for, jsonify, g, session
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Operator authentication configuration
# ---------------------------------------------------------------------------
# This app has TWO interfaces:
#   1. Student interface  — public, no login, everything under "/"
#   2. Operator interface — protected, for campus security / IT staff who
#      monitor incoming SOS alerts and incident reports, under "/operator"
#
# SECRET_KEY signs the login session cookie. On Render, set a real random
# value as an environment variable — never commit one to source control.
app.secret_key = os.environ.get("SECRET_KEY", "dev-only-insecure-key-change-me")

# Operator login credentials. In production, set OPERATOR_USERNAME and
# OPERATOR_PASSWORD_HASH as environment variables on Render (see README).
# The fallback values below only apply on your local machine and use the
# default password "GourSafe@2026" — change this before any real deployment.
OPERATOR_USERNAME = os.environ.get("OPERATOR_USERNAME", "operator")
OPERATOR_PASSWORD_HASH = os.environ.get(
    "OPERATOR_PASSWORD_HASH",
    generate_password_hash("GourSafe@2026"),
)


def operator_required(view_func):
    # Decorator: redirect to the operator login page if not logged in.
    # Put @operator_required on any route that only staff should see.
    @functools.wraps(view_func)
    def wrapped_view(*args, **kwargs):
        if not session.get("operator_authenticated"):
            return redirect(url_for("operator_login", next=request.path))
        return view_func(*args, **kwargs)
    return wrapped_view


# ---------------------------------------------------------------------------
# Student authentication — Sign Up / Sign In / Continue as Guest
# ---------------------------------------------------------------------------
# App flow: welcome screen -> (sign up, sign in, or guest) -> for a real
# account, one profile+emergency-contact step -> home. Guests skip straight
# to home with no account and no profile step at all.
#
# This uses its own session keys ("user_id" / "guest"), completely separate
# from the operator's ("operator_authenticated") — a student session can
# never accidentally grant operator access or vice versa.

# Endpoints reachable WITHOUT being signed in or a guest yet. Everything
# else under "/" requires one of the two, enforced by require_login_or_guest
# below. The operator side has its own separate @operator_required guard,
# so those endpoints are listed here too rather than being blocked twice.
PUBLIC_ENDPOINTS = {
    "welcome", "signup", "login", "guest_login", "logout", "static",
    "operator_login", "operator_logout", "operator_dashboard",
    "update_report_status", "update_alert_status", "admin_reports_redirect",
}


def get_current_user():
    # Returns the logged-in user's row, or None if this is a guest session
    # (or nobody at all — though before_request should never let that reach
    # a page that calls this).
    user_id = session.get("user_id")
    if not user_id:
        return None
    db = get_db()
    return db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


@app.context_processor
def inject_current_user():
    # Makes `current_user` available in every template automatically
    # (used by the profile dropdown in base.html) without every single
    # route having to fetch and pass it manually.
    return {"current_user": get_current_user() if session.get("user_id") else None}


@app.before_request
def require_login_or_guest():
    endpoint = request.endpoint
    if endpoint is None or endpoint in PUBLIC_ENDPOINTS:
        return  # 404s, static files, and the auth pages themselves

    if not session.get("user_id") and not session.get("guest"):
        # Nobody's signed in and this isn't a guest session — send them
        # to choose one before they can reach any student page.
        return redirect(url_for("welcome"))

    if session.get("user_id") and endpoint != "profile_setup":
        # Signed-up (non-guest) users must finish their profile once,
        # right after signing up, before using the rest of the app.
        user = get_current_user()
        if user is not None and not user["profile_completed"]:
            return redirect(url_for("profile_setup"))

# ---------------------------------------------------------------------------
# Database configuration
# ---------------------------------------------------------------------------

# Path to the SQLite file — auto-created on first run
DATABASE = os.path.join(os.path.dirname(__file__), "database.db")


def get_db():
    # Open a request-scoped database connection (reused within one request)
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row  # access columns by name, not index
    return db


@app.teardown_appcontext
def close_db(exception):
    # Close the connection automatically when the request context ends
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()


def init_db():
    # Create both tables if they don't exist yet — runs once at startup
    db = sqlite3.connect(DATABASE)
    cursor = db.cursor()

    # Stores incident reports submitted via the report form (Feature 3)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS reports (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            anonymous   INTEGER NOT NULL DEFAULT 1,
            name        TEXT,
            category    TEXT NOT NULL,
            description TEXT NOT NULL,
            created_at  TEXT NOT NULL
        )
    """)

    # Stores SOS location pings from the home page button (Feature 4)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sos_alerts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            latitude    REAL NOT NULL,
            longitude   REAL NOT NULL,
            accuracy    REAL,
            created_at  TEXT NOT NULL
        )
    """)

    # Stores student accounts (Sign Up / Sign In flow). Guests never get a
    # row here at all — "Continue as Guest" only sets a session flag.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            name                     TEXT NOT NULL,
            email                    TEXT NOT NULL UNIQUE,
            password_hash            TEXT NOT NULL,
            phone                    TEXT,
            emergency_contact_name   TEXT,
            emergency_contact_phone  TEXT,
            profile_completed        INTEGER NOT NULL DEFAULT 0,
            created_at               TEXT NOT NULL
        )
    """)

    # Personal emergency contacts a signed-up student adds themselves —
    # separate from the official/national numbers, which are static and
    # the same for every visitor. Guests can't have rows here (no
    # account to attach them to); they're offered a sign-up prompt instead.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS custom_contacts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            name        TEXT NOT NULL,
            phone       TEXT NOT NULL,
            relation    TEXT,
            created_at  TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    """)

    db.commit()

    # --- Migration: add a `status` column to older databases that were
    # created before the operator console existed. SQLite has no
    # "ADD COLUMN IF NOT EXISTS", so we just try and ignore the error if
    # the column is already there. Safe to run every time the app starts.
    for table, default in (("reports", "new"), ("sos_alerts", "active")):
        try:
            cursor.execute(
                f"ALTER TABLE {table} ADD COLUMN status TEXT NOT NULL DEFAULT '{default}'"
            )
            db.commit()
        except sqlite3.OperationalError:
            pass  # column already exists — nothing to do

    # --- Migration: "pinned" flags which custom contacts show as quick
    # circles on the home page. Same pattern as above — safe no-op if the
    # column already exists on an older database.
    try:
        cursor.execute(
            "ALTER TABLE custom_contacts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0"
        )
        db.commit()
    except sqlite3.OperationalError:
        pass

    db.close()


# ---------------------------------------------------------------------------
# Route: Welcome screen — Sign Up / Sign In / Continue as Guest
# ---------------------------------------------------------------------------

@app.route("/welcome")
def welcome():
    # If someone's already signed in or already a guest, don't show this
    # again — just send them on to where they were headed.
    if session.get("user_id") or session.get("guest"):
        return redirect(url_for("index"))
    return render_template("welcome.html")


@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        confirm = request.form.get("confirm_password", "")

        if not name or not email or not password:
            return render_template("signup.html", error="All fields are required.", name=name, email=email)
        if password != confirm:
            return render_template("signup.html", error="Passwords don't match.", name=name, email=email)
        if len(password) < 8:
            return render_template("signup.html", error="Password must be at least 8 characters.", name=name, email=email)

        db = get_db()
        existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            return render_template("signup.html", error="An account with that email already exists.", name=name, email=email)

        db.execute(
            "INSERT INTO users (name, email, password_hash, profile_completed, created_at) "
            "VALUES (?, ?, ?, 0, ?)",
            (name, email, generate_password_hash(password),
             datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"))
        )
        db.commit()

        new_user = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        session["user_id"] = new_user["id"]
        session.pop("guest", None)
        return redirect(url_for("profile_setup"))

    return render_template("signup.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        db = get_db()
        user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

        if user is None or not check_password_hash(user["password_hash"], password):
            return render_template("login.html", error="Incorrect email or password.", email=email)

        session["user_id"] = user["id"]
        session.pop("guest", None)
        if not user["profile_completed"]:
            return redirect(url_for("profile_setup"))
        return redirect(url_for("index"))

    return render_template("login.html")


@app.route("/guest")
def guest_login():
    # No account, no profile step — straight to the student home page.
    session["guest"] = True
    session.pop("user_id", None)
    return redirect(url_for("index"))


@app.route("/profile-setup", methods=["GET", "POST"])
def profile_setup():
    # Only meaningful for a real signed-up account, never for a guest.
    if not session.get("user_id"):
        return redirect(url_for("welcome"))

    if request.method == "POST":
        phone = request.form.get("phone", "").strip()
        ec_name = request.form.get("emergency_contact_name", "").strip()
        ec_phone = request.form.get("emergency_contact_phone", "").strip()

        if not phone or not ec_name or not ec_phone:
            return render_template("profile_setup.html", error="All fields are required.")

        db = get_db()
        db.execute(
            "UPDATE users SET phone = ?, emergency_contact_name = ?, "
            "emergency_contact_phone = ?, profile_completed = 1 WHERE id = ?",
            (phone, ec_name, ec_phone, session["user_id"])
        )
        db.commit()
        return redirect(url_for("index"))

    return render_template("profile_setup.html")


@app.route("/profile/edit", methods=["GET", "POST"])
def edit_profile():
    # Guests have no account/profile to edit
    if not session.get("user_id"):
        return redirect(url_for("welcome"))

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        phone = request.form.get("phone", "").strip()
        ec_name = request.form.get("emergency_contact_name", "").strip()
        ec_phone = request.form.get("emergency_contact_phone", "").strip()

        if not name or not phone or not ec_name or not ec_phone:
            return render_template("edit_profile.html", user=get_current_user(), error="All fields are required.")

        db = get_db()
        db.execute(
            "UPDATE users SET name = ?, phone = ?, emergency_contact_name = ?, "
            "emergency_contact_phone = ? WHERE id = ?",
            (name, phone, ec_name, ec_phone, session["user_id"])
        )
        db.commit()
        return render_template("edit_profile.html", user=get_current_user(), saved=True)

    return render_template("edit_profile.html", user=get_current_user())


@app.route("/logout")
def logout():
    # Student-side logout — separate from operator_logout. Clears both
    # possible session states (signed-in or guest) and returns to welcome.
    session.pop("user_id", None)
    session.pop("guest", None)
    return redirect(url_for("welcome"))


# ---------------------------------------------------------------------------
# Route: Home page — emergency contacts + SOS button (Features 1 & 4)
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    # Home page: national numbers + pinned personal contacts as quick
    # circles, plus the SOS button. Guests just get the national numbers.
    pinned_contacts = []
    if session.get("user_id"):
        db = get_db()
        pinned_contacts = db.execute(
            "SELECT * FROM custom_contacts WHERE user_id = ? AND pinned = 1 ORDER BY created_at DESC",
            (session["user_id"],)
        ).fetchall()
    return render_template("index.html", pinned_contacts=pinned_contacts)


# ---------------------------------------------------------------------------
# Route: Emergency contacts page (Feature 1)
# ---------------------------------------------------------------------------

@app.route("/contacts")
def contacts():
    # Official/national numbers are static (in the template). Personal
    # contacts are per-account — guests see an empty list plus a sign-up
    # prompt in the template instead of the add-contact form.
    custom_contacts = []
    if session.get("user_id"):
        db = get_db()
        custom_contacts = db.execute(
            "SELECT * FROM custom_contacts WHERE user_id = ? ORDER BY pinned DESC, created_at DESC",
            (session["user_id"],)
        ).fetchall()
    return render_template("contacts.html", custom_contacts=custom_contacts)


@app.route("/contacts/add", methods=["POST"])
def add_custom_contact():
    # Guests have no account to attach a contact to — send them to sign up
    if not session.get("user_id"):
        return redirect(url_for("signup"))

    name = request.form.get("name", "").strip()
    phone = request.form.get("phone", "").strip()
    relation = request.form.get("relation", "").strip()

    if name and phone:
        db = get_db()
        db.execute(
            "INSERT INTO custom_contacts (user_id, name, phone, relation, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (session["user_id"], name, phone, relation,
             datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"))
        )
        db.commit()

    return redirect(url_for("contacts"))


@app.route("/contacts/<int:contact_id>/delete", methods=["POST"])
def delete_custom_contact(contact_id):
    if session.get("user_id"):
        db = get_db()
        # The user_id check ensures nobody can delete a contact that
        # isn't their own, even by guessing another contact's id.
        db.execute(
            "DELETE FROM custom_contacts WHERE id = ? AND user_id = ?",
            (contact_id, session["user_id"])
        )
        db.commit()
    return redirect(url_for("contacts"))


@app.route("/contacts/<int:contact_id>/pin", methods=["POST"])
def toggle_pin_contact(contact_id):
    # Pinned contacts show as quick circles on the home page. Same
    # ownership check as delete — can only pin/unpin your own contact.
    if session.get("user_id"):
        db = get_db()
        contact = db.execute(
            "SELECT pinned FROM custom_contacts WHERE id = ? AND user_id = ?",
            (contact_id, session["user_id"])
        ).fetchone()
        if contact is not None:
            new_value = 0 if contact["pinned"] else 1
            db.execute(
                "UPDATE custom_contacts SET pinned = ? WHERE id = ? AND user_id = ?",
                (new_value, contact_id, session["user_id"])
            )
            db.commit()
    return redirect(url_for("contacts"))


# ---------------------------------------------------------------------------
# Route: Campus security information (Feature 2)
# ---------------------------------------------------------------------------

@app.route("/security")
def security_info():
    # Render the static security info page (office, hours, guidelines)
    return render_template("security_info.html")


# ---------------------------------------------------------------------------
# Route: Report an unsafe situation (Feature 3)
# ---------------------------------------------------------------------------

@app.route("/report", methods=["GET", "POST"])
def report():
    # GET: show the form; POST: validate, save to DB, show confirmation
    if request.method == "POST":
        anonymous = 1 if request.form.get("anonymous") == "on" else 0
        name = "" if anonymous else request.form.get("name", "").strip()
        category = request.form.get("category", "Other").strip()
        description = request.form.get("description", "").strip()

        if not description:
            return render_template("report.html", error="Description is required.")

        db = get_db()
        db.execute(
            "INSERT INTO reports (anonymous, name, category, description, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (anonymous, name, category, description,
             datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"))
        )
        db.commit()
        return render_template("report.html", success=True)

    return render_template("report.html")


# ---------------------------------------------------------------------------
# API route: Receive SOS location ping and save it (Feature 4)
# ---------------------------------------------------------------------------

@app.route("/api/sos", methods=["POST"])
def api_sos():
    # Accept JSON { latitude, longitude, accuracy }, save to sos_alerts table
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"ok": False, "error": "No data received"}), 400

    try:
        lat = float(data["latitude"])
        lon = float(data["longitude"])
        acc = float(data.get("accuracy", 0))
    except (KeyError, ValueError, TypeError):
        return jsonify({"ok": False, "error": "Invalid coordinates"}), 400

    db = get_db()
    db.execute(
        "INSERT INTO sos_alerts (latitude, longitude, accuracy, created_at) VALUES (?, ?, ?, ?)",
        (lat, lon, acc, datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"))
    )
    db.commit()
    return jsonify({"ok": True, "message": "Location received. Help is on the way."})


# ---------------------------------------------------------------------------
# Operator interface — login, logout, dashboard, status updates
# ---------------------------------------------------------------------------
# This whole section is the SECOND interface: for campus security / IT staff
# who monitor and act on incoming alerts. Everything here requires login
# except the login page itself.

@app.route("/operator/login", methods=["GET", "POST"])
def operator_login():
    # GET: show the login form. POST: check credentials, start a session.
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        valid = (
            username == OPERATOR_USERNAME
            and check_password_hash(OPERATOR_PASSWORD_HASH, password)
        )

        if valid:
            session["operator_authenticated"] = True
            session["operator_username"] = username
            # Send the operator back to whichever protected page they
            # originally tried to visit, or the dashboard by default.
            next_url = request.form.get("next") or url_for("operator_dashboard")
            return redirect(next_url)

        return render_template("operator_login.html", error="Incorrect username or password.")

    return render_template("operator_login.html", next=request.args.get("next", ""))


@app.route("/operator/logout")
@operator_required
def operator_logout():
    # Clear the session and send the operator back to the login page
    session.pop("operator_authenticated", None)
    session.pop("operator_username", None)
    return redirect(url_for("operator_login"))


@app.route("/operator")
@operator_required
def operator_dashboard():
    # Fetch every row from both tables, newest first, for the operator to
    # review and action.
    db = get_db()
    reports = db.execute(
        "SELECT * FROM reports ORDER BY created_at DESC"
    ).fetchall()
    sos_alerts = db.execute(
        "SELECT * FROM sos_alerts ORDER BY created_at DESC"
    ).fetchall()

    # Small summary counts shown at the top of the dashboard
    open_alerts = sum(1 for a in sos_alerts if a["status"] == "active")
    new_reports = sum(1 for r in reports if r["status"] == "new")

    return render_template(
        "operator_dashboard.html",
        reports=reports,
        sos_alerts=sos_alerts,
        open_alerts=open_alerts,
        new_reports=new_reports,
    )


@app.route("/operator/reports/<int:report_id>/status", methods=["POST"])
@operator_required
def update_report_status(report_id):
    # Move a report between new -> acknowledged -> resolved
    new_status = request.form.get("status")
    if new_status in ("new", "acknowledged", "resolved"):
        db = get_db()
        db.execute("UPDATE reports SET status = ? WHERE id = ?", (new_status, report_id))
        db.commit()
    return redirect(url_for("operator_dashboard"))


@app.route("/operator/alerts/<int:alert_id>/status", methods=["POST"])
@operator_required
def update_alert_status(alert_id):
    # Move an SOS alert between active -> handled
    new_status = request.form.get("status")
    if new_status in ("active", "handled"):
        db = get_db()
        db.execute("UPDATE sos_alerts SET status = ? WHERE id = ?", (new_status, alert_id))
        db.commit()
    return redirect(url_for("operator_dashboard"))


# Old public admin link from before the operator console existed —
# send anyone with the old URL bookmarked to the login page instead.
@app.route("/admin/reports")
def admin_reports_redirect():
    return redirect(url_for("operator_login"))


# ---------------------------------------------------------------------------
# Entry point — initialise DB then start dev server
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    init_db()
    app.run(debug=True)
