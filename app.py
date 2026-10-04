import os
import functools
from datetime import datetime, timezone

from dotenv import load_dotenv
from flask import Flask, render_template, request, redirect, url_for, jsonify, g, session
from psycopg import connect as psycopg_connect
from psycopg.rows import dict_row
import hmac
import secrets
from werkzeug.security import generate_password_hash, check_password_hash

load_dotenv()

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Operator authentication configuration
# ---------------------------------------------------------------------------
# This app has TWO interfaces:
#   1. Student interface  — public, no login, everything under "/"
#   2. Operator interface — protected, for campus security / IT staff who
#      monitor incoming SOS alerts and incident reports, under "/operator"
#
# SECRET_KEY signs the login session cookie. In Vercel/Supabase production,
# set a real random value in environment variables and never commit it.
app.secret_key = os.environ.get("SECRET_KEY", "dev-only-insecure-key-change-me")

# Operator login credentials. In production, set OPERATOR_USERNAME and
# OPERATOR_PASSWORD_HASH as environment variables in Vercel (see README).
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

def get_database_url():
    url = (os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL") or "").strip()
    if not url:
        raise RuntimeError("Set DATABASE_URL to the Supabase Postgres connection string.")

    placeholders = (
        "your-password",
        "your-project",
        "db.your-project.supabase.co",
        "postgresql://postgres:your-password@",
        "postgresql://postgres:password@",
    )

    if any(p in url.lower() for p in (p.lower() for p in placeholders)):
        raise RuntimeError("DATABASE_URL still contains a placeholder value.")

    if not url.startswith(("postgresql://", "postgres://")):
        raise RuntimeError("DATABASE_URL must be a PostgreSQL connection string.")

    return url


DATABASE_URL = get_database_url()


class CursorProxy:
    def __init__(self, cursor):
        self._cursor = cursor

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()

    def fetchmany(self, size=None):
        if size is None:
            return self._cursor.fetchmany()
        return self._cursor.fetchmany(size)

    @property
    def rowcount(self):
        return self._cursor.rowcount


class PostgresConnection:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, query, params=()):
        cursor = self.connection.cursor(row_factory=dict_row)
        cursor.execute(query.replace("?", "%s"), params)
        return CursorProxy(cursor)

    def commit(self):
        self.connection.commit()

    def close(self):
        self.connection.close()


def get_db():
    # Open a request-scoped connection to Supabase Postgres.
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = PostgresConnection(
            psycopg_connect(DATABASE_URL, sslmode="require")
        )
    return db


@app.teardown_appcontext
def close_db(exception):
    # Close the connection automatically when the request context ends.
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()


def init_db():
    # Create the Supabase schema if it has not already been created in SQL Editor.
    db = psycopg_connect(DATABASE_URL, sslmode="require")
    try:
        cursor = db.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS public.reports (
                id          BIGSERIAL PRIMARY KEY,
                anonymous   BOOLEAN NOT NULL DEFAULT TRUE,
                name        TEXT,
                category    TEXT NOT NULL,
                description TEXT NOT NULL,
                status      TEXT NOT NULL DEFAULT 'new',
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS public.sos_alerts (
                id          BIGSERIAL PRIMARY KEY,
                latitude    DOUBLE PRECISION NOT NULL,
                longitude   DOUBLE PRECISION NOT NULL,
                accuracy    DOUBLE PRECISION,
                status      TEXT NOT NULL DEFAULT 'active',
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS public.users (
                id                       BIGSERIAL PRIMARY KEY,
                name                     TEXT NOT NULL,
                email                    TEXT NOT NULL UNIQUE,
                password_hash            TEXT NOT NULL,
                phone                    TEXT,
                emergency_contact_name   TEXT,
                emergency_contact_phone  TEXT,
                profile_completed        BOOLEAN NOT NULL DEFAULT FALSE,
                created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS public.custom_contacts (
                id          BIGSERIAL PRIMARY KEY,
                user_id     BIGINT NOT NULL REFERENCES public.users (id),
                name        TEXT NOT NULL,
                phone       TEXT NOT NULL,
                relation    TEXT,
                pinned      BOOLEAN NOT NULL DEFAULT FALSE,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        # Live-tracking columns (safe to run repeatedly)
        cursor.execute("ALTER TABLE public.sos_alerts ADD COLUMN IF NOT EXISTS track_token TEXT")
        cursor.execute("ALTER TABLE public.sos_alerts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ")
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Route: Welcome screen — Sign Up / Sign In / Continue as Guest
# ---------------------------------------------------------------------------

@app.route("/welcome")
def welcome():
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
            "INSERT INTO users (name, email, password_hash, created_at) "
            "VALUES (?, ?, ?, ?)",
            (name, email, generate_password_hash(password), datetime.now(timezone.utc))
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
            "emergency_contact_phone = ?, profile_completed = TRUE WHERE id = ?",
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


@app.route("/profile")
def profile():
    # Central profile page. Signed-in users see their details and linked
    # contact info; guests and non-logged-in users are prompted to sign in.
    if session.get("user_id"):
        user = get_current_user()
        if user is None:
            return redirect(url_for("welcome"))

        db = get_db()
        custom_contacts = db.execute(
            "SELECT * FROM custom_contacts WHERE user_id = ? ORDER BY pinned DESC, created_at DESC LIMIT 6",
            (user["id"],)
        ).fetchall()
        return render_template("profile.html", user=user, custom_contacts=custom_contacts)

    return render_template("profile.html", guest=True)


@app.route("/settings")
def settings():
    # Simple settings page for the profile menu. This keeps the main profile
    # page clean while giving signed-in users a navigation target for
    # account and app preferences.
    if not session.get("user_id"):
        return redirect(url_for("welcome"))
    return render_template("settings.html", user=get_current_user())


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
    # Capped at 5 pinned contacts so the row wraps to at most a second
    # line — keeps the one-screen, no-scroll layout bounded no matter
    # how many contacts someone pins.
    pinned_contacts = []
    if session.get("user_id"):
        db = get_db()
        pinned_contacts = db.execute(
            "SELECT * FROM custom_contacts WHERE user_id = ? AND pinned = TRUE "
            "ORDER BY created_at DESC LIMIT 5",
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
            (session["user_id"], name, phone, relation, datetime.now(timezone.utc))
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
            new_value = not contact["pinned"]
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
    if request.method == "POST":
        anonymous = request.form.get("anonymous") == "on"
        name = "" if anonymous else request.form.get("name", "").strip()
        category = request.form.get("category", "Other").strip()
        description = request.form.get("description", "").strip()

        if not description:
            return render_template("report.html", error="Description is required.")

        db = get_db()
        db.execute(
            "INSERT INTO reports (anonymous, name, category, description, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (anonymous, name, category, description, datetime.now(timezone.utc))
        )
        db.commit()
        return render_template("report.html", success=True)

    return render_template("report.html")


@app.route("/api/sos", methods=["POST"])
def api_sos():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"ok": False, "error": "No data received"}), 400

    try:
        lat = float(data["latitude"])
        lon = float(data["longitude"])
        acc = float(data.get("accuracy", 0))
    except (KeyError, ValueError, TypeError):
        return jsonify({"ok": False, "error": "Invalid coordinates"}), 400

    # Secret token: only the phone that raised this alert can send location updates for it.
    token = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc)

    db = get_db()
    row = db.execute(
        "INSERT INTO sos_alerts (latitude, longitude, accuracy, created_at, updated_at, track_token) "
        "VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
        (lat, lon, acc, now, now, token)
    ).fetchone()
    db.commit()
    return jsonify({
        "ok": True,
        "message": "Location received. Help is on the way.",
        "alert_id": row["id"],
        "track_token": token,
    })


@app.route("/api/sos/<int:alert_id>/location", methods=["POST"])
def api_sos_location(alert_id):
    """Live location updates from the mobile app while an SOS is active."""
    data = request.get_json(silent=True) or {}
    try:
        lat = float(data["latitude"])
        lon = float(data["longitude"])
        acc = float(data.get("accuracy", 0))
    except (KeyError, ValueError, TypeError):
        return jsonify({"ok": False, "error": "Invalid coordinates"}), 400

    db = get_db()
    alert = db.execute(
        "SELECT status, track_token FROM sos_alerts WHERE id = ?", (alert_id,)
    ).fetchone()
    supplied = str(data.get("track_token", ""))
    if not alert or not alert["track_token"] or not hmac.compare_digest(alert["track_token"], supplied):
        return jsonify({"ok": False, "error": "Not allowed"}), 403

    # Once security marks the alert handled, stop accepting updates and tell the app to stop tracking.
    if alert["status"] != "active":
        return jsonify({"ok": True, "status": alert["status"]})

    db.execute(
        "UPDATE sos_alerts SET latitude = ?, longitude = ?, accuracy = ?, updated_at = ? WHERE id = ?",
        (lat, lon, acc, datetime.now(timezone.utc), alert_id)
    )
    db.commit()
    return jsonify({"ok": True, "status": "active"})


@app.route("/operator/login", methods=["GET", "POST"])
def operator_login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        valid = username == OPERATOR_USERNAME and check_password_hash(OPERATOR_PASSWORD_HASH, password)
        if valid:
            session["operator_authenticated"] = True
            session["operator_username"] = username
            next_url = request.form.get("next") or url_for("operator_dashboard")
            return redirect(next_url)
        return render_template("operator_login.html", error="Incorrect username or password.")

    return render_template("operator_login.html", next=request.args.get("next", ""))


@app.route("/operator/logout")
@operator_required
def operator_logout():
    session.pop("operator_authenticated", None)
    session.pop("operator_username", None)
    return redirect(url_for("operator_login"))


@app.route("/operator")
@operator_required
def operator_dashboard():
    db = get_db()
    reports = db.execute("SELECT * FROM reports ORDER BY created_at DESC").fetchall()
    sos_alerts = db.execute("SELECT * FROM sos_alerts ORDER BY created_at DESC").fetchall()
    open_alerts = sum(1 for alert in sos_alerts if alert["status"] == "active")
    new_reports = sum(1 for item in reports if item["status"] == "new")
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

init_db()

if __name__ == "__main__":
    app.run(debug=True)
