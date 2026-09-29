# Requirements — University Emergency & Safety App

## Overview

A mobile-friendly Flask web app giving university students one-tap access to
emergency help. Four features are in scope: emergency contacts, campus security
information, incident reporting, and SOS location sharing.

References:
- Product scope: `product.md` (steering)
- Allowed stack: `tech.md` (steering)
- File layout: `structure.md` (steering)

---

## Feature 1 — One-Tap Emergency Contacts

### REQ-1.1 — Contact list rendered
WHEN a user navigates to `/contacts`,
THE SYSTEM SHALL render a page listing the following five contacts, each as a
tappable `tel:` hyperlink: Campus Security, Ambulance / Medical, Fire Service,
Police, Hostel Warden.

### REQ-1.2 — Immediate dial on tap
WHEN a user taps a contact card on a device that supports `tel:` URIs,
THE SYSTEM SHALL initiate a phone call to the associated number without any
intermediate confirmation screen inside the app.

### REQ-1.3 — Contact cards on home page
WHEN a user navigates to `/` (home),
THE SYSTEM SHALL display a quick-call strip with at minimum Campus Security and
Ambulance as direct `tel:` links, plus a visible link to the full contacts page.

### REQ-1.4 — Graceful fallback on non-telephony devices
WHEN the device does not support `tel:` URIs (e.g. a desktop browser),
THE SYSTEM SHALL still display the phone numbers in readable text so the user can
dial manually; no JavaScript error or broken layout shall occur.

---

## Feature 2 — Campus Security Information

### REQ-2.1 — Static security info page
WHEN a user navigates to `/security`,
THE SYSTEM SHALL render a page containing: the security office location, operating
hours for all posts and the emergency line, at least six safety guidelines, and the
four campus emergency muster points.

### REQ-2.2 — No dynamic data dependency
WHEN the database is unavailable or has not yet been initialised,
THE SYSTEM SHALL still serve the `/security` page successfully, because all
content on that page is static.

### REQ-2.3 — CTA links to SOS and contacts
WHEN a user views the security info page,
THE SYSTEM SHALL display a prominent button linking to the home SOS button and a
secondary link to the emergency contacts page.

---

## Feature 3 — Report an Unsafe Situation

### REQ-3.1 — Report form rendered
WHEN a user navigates to `/report`,
THE SYSTEM SHALL render a form with the following fields:
  - Anonymous toggle (checkbox, default: checked / anonymous)
  - Name (text input, visible only when anonymous is unchecked)
  - Category (select, required; options: Theft, Harassment, Physical Assault,
    Suspicious Activity, Vandalism, Fire Hazard, Medical Emergency,
    Unsafe Infrastructure, Other)
  - Description (textarea, required)

### REQ-3.2 — Successful submission
WHEN a user submits the report form with a non-empty description and a selected
category,
THE SYSTEM SHALL insert one row into the `reports` table (columns: `anonymous`,
`name`, `category`, `description`, `created_at`) and re-render `/report` with a
visible success confirmation message.

### REQ-3.3 — Empty description rejected
WHEN a user submits the report form with an empty or whitespace-only description,
THE SYSTEM SHALL NOT insert any row into the database and SHALL re-render the form
with a visible inline error message stating that a description is required.

### REQ-3.4 — Anonymous submission
WHEN a user submits the form with the anonymous toggle checked,
THE SYSTEM SHALL store `anonymous = 1` and an empty string for `name` regardless
of any value that may have been typed into the name field.

### REQ-3.5 — Named submission
WHEN a user submits the form with the anonymous toggle unchecked and a name
entered,
THE SYSTEM SHALL store `anonymous = 0` and the trimmed name value.

### REQ-3.6 — Category default
WHEN a user submits the form without selecting a category,
THE SYSTEM SHALL store `"Other"` as the category value (the select placeholder
option has no value attribute, making it invalid for the required constraint in
HTML5, providing client-side guard; the server defaults to "Other" as a safety
net).

---

## Feature 4 — SOS Location Sharing

### REQ-4.1 — SOS button on home page
WHEN a user navigates to `/`,
THE SYSTEM SHALL display a single, prominently styled SOS button that, when
tapped, triggers the browser Geolocation API.

### REQ-4.2 — Successful location capture and save
WHEN the user taps the SOS button AND the browser successfully returns a
geolocation fix,
THE SYSTEM SHALL POST `{ latitude, longitude, accuracy }` to `/api/sos`, insert
one row into the `sos_alerts` table (columns: `latitude`, `longitude`, `accuracy`,
`created_at`), and display a success confirmation showing the coordinates that were
sent.

### REQ-4.3 — Location permission denied
WHEN the user taps the SOS button AND the browser returns a
`GeolocationPositionError` with code `1` (PERMISSION_DENIED),
THE SYSTEM SHALL display an inline error message instructing the user to allow
location access in their browser settings, and SHALL NOT POST to `/api/sos`.

### REQ-4.4 — Location unavailable
WHEN the user taps the SOS button AND the browser returns a
`GeolocationPositionError` with code `2` (POSITION_UNAVAILABLE),
THE SYSTEM SHALL display an inline error message instructing the user to enable
GPS / location services, and SHALL NOT POST to `/api/sos`.

### REQ-4.5 — Geolocation timeout
WHEN the user taps the SOS button AND the browser returns a
`GeolocationPositionError` with code `3` (TIMEOUT) after 15 seconds,
THE SYSTEM SHALL display an inline error message asking the user to move to an
open area and try again, and SHALL NOT POST to `/api/sos`.

### REQ-4.6 — Geolocation API not supported
WHEN the user taps the SOS button AND `navigator.geolocation` is `undefined`,
THE SYSTEM SHALL display an inline error message stating that geolocation is not
supported by this browser, and SHALL NOT attempt to call `getCurrentPosition`.

### REQ-4.7 — Server error on POST
WHEN the SOS POST to `/api/sos` returns a non-2xx HTTP response or network
failure,
THE SYSTEM SHALL display an inline error message and re-enable the SOS button so
the user can retry or fall back to calling security directly.

### REQ-4.8 — Button disabled after successful send
WHEN the SOS location has been successfully sent in the current page session,
THE SYSTEM SHALL disable the SOS button to prevent duplicate pings within the
same page load.

### REQ-4.9 — Fallback call strip always visible
WHEN a user views the home page,
THE SYSTEM SHALL always display a direct `tel:` link to Campus Security beneath
the SOS button, regardless of geolocation state.

### REQ-4.10 — Invalid payload rejected by API
WHEN `/api/sos` receives a POST with missing or non-numeric `latitude` /
`longitude` fields,
THE SYSTEM SHALL return HTTP 400 with a JSON body `{ "ok": false, "error": "..." }`
and SHALL NOT write to the database.

---

## Feature 5 — Admin Report View

### REQ-5.1 — Admin page renders all reports
WHEN a user navigates to `/admin/reports`,
THE SYSTEM SHALL render a table of all rows in the `reports` table ordered by
`created_at` descending, showing: ID, timestamp, category, reporter (or
"Anonymous"), and description.

### REQ-5.2 — Admin page renders all SOS alerts
WHEN a user navigates to `/admin/reports`,
THE SYSTEM SHALL render a second table of all rows in the `sos_alerts` table
ordered by `created_at` descending, showing: ID, timestamp, latitude, longitude,
accuracy, and a link to OpenStreetMap at those coordinates.

### REQ-5.3 — Empty state
WHEN either table has zero rows,
THE SYSTEM SHALL display a readable empty-state message instead of an empty table.

---

## Non-Functional Requirements

### REQ-NF-1 — Mobile-first layout
THE SYSTEM SHALL render correctly on viewport widths from 320 px upward without
horizontal scrolling.

### REQ-NF-2 — No authentication on any route
THE SYSTEM SHALL NOT require any login, session, or token for any route.

### REQ-NF-2a — /admin/reports intentionally open
WHEN a user navigates to `/admin/reports`,
THE SYSTEM SHALL serve the page and display all reports and SOS alerts without
requiring any authentication, session cookie, or access token.
This is an intentional product decision for demo purposes; no auth layer shall
be added to this route.

### REQ-NF-3 — Database auto-initialised
WHEN `python app.py` is run for the first time on a machine with no existing
`database.db`,
THE SYSTEM SHALL call `init_db()` before the Flask dev server starts, creating
the `reports` and `sos_alerts` tables automatically.

### REQ-NF-4 — No forbidden technologies
THE SYSTEM SHALL be implemented using only: Python 3.10+, Flask, Jinja2, SQLite
(`sqlite3` module, plain SQL), Bootstrap 5 (CDN), vanilla JavaScript ES6+.
No ORM, no JS framework, no paid API, no authentication library shall be used.

### REQ-NF-5 — Deployable on Render free tier
THE SYSTEM SHALL include a `render.yaml` that configures a Render Web Service
with `gunicorn app:app` as the start command and no paid add-ons.

### REQ-NF-6 — SQLite write failure handled gracefully
WHEN a database write operation (INSERT into `reports` or `sos_alerts`) raises
an exception at runtime,
THE SYSTEM SHALL catch the exception, log it server-side, and return a
user-friendly error message to the client — either by re-rendering the relevant
page with an inline error banner (for form submissions) or by returning a JSON
error response with HTTP 500 (for `/api/sos`) — without exposing a raw Python
traceback or crashing the Flask process.
