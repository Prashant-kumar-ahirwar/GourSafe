/* ============================================================
   script.js — UniSafe client-side logic
   Covers: SOS geolocation + POST, report form anonymous toggle
   Vanilla JS ES6+, no dependencies
   ============================================================ */

"use strict";

// ── SOS: show one state panel, hide the rest ─────────────────────────────

function showState(state) {
  // Reveal the status panel wrapper and toggle child state divs
  const panel = document.getElementById("statusPanel");
  if (!panel) return;
  panel.classList.remove("d-none");

  ["Locating", "Sending", "Success", "Error"].forEach((s) => {
    const el = document.getElementById("state" + s);
    if (el) el.classList.toggle("d-none", s.toLowerCase() !== state);
  });
}

// ── SOS: main handler, called by the SOS button's onclick ────────────────

async function sendSOS() {
  const btn = document.getElementById("sosBtn");
  if (!btn) return;
  btn.disabled = true;

  // Step 1: acquire GPS position
  showState("locating");

  let position;
  try {
    position = await getPosition();
  } catch (err) {
    showState("error");
    document.getElementById("errorMsg").textContent = geolocationErrorMessage(err);
    btn.disabled = false;
    return;
  }

  const { latitude, longitude, accuracy } = position.coords;

  // Step 2: POST coordinates to Flask
  showState("sending");

  try {
    const response = await fetch("/api/sos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude, longitude, accuracy }),
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Server returned an error.");
    }

    // Step 3: display confirmation with the coordinates that were sent
    document.getElementById("outLat").textContent = latitude.toFixed(6);
    document.getElementById("outLon").textContent = longitude.toFixed(6);
    document.getElementById("outAcc").textContent =
      accuracy != null ? Math.round(accuracy) : "unknown";

    showState("success");
    // Keep button disabled — one ping per page load is intentional
  } catch (err) {
    showState("error");
    document.getElementById("errorMsg").textContent =
      err.message || "Failed to reach the server. Call security directly.";
    btn.disabled = false;
  }
}

// ── SOS: wrap navigator.geolocation in a Promise ─────────────────────────

function getPosition() {
  // Rejects with a GeolocationPositionError if denied/unavailable/timed-out
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,   // 15 s before giving up
      maximumAge: 0,    // always request a fresh fix
    });
  });
}

// ── SOS: convert GeolocationPositionError codes to plain English ─────────

function geolocationErrorMessage(err) {
  // Provides a user-friendly message for each browser geolocation error code
  if (err.code != null) {
    switch (err.code) {
      case 1:
        return "Location access was denied. Allow location in your browser settings and try again.";
      case 2:
        return "Your location could not be determined. Make sure GPS / location services are on.";
      case 3:
        return "Location request timed out. Move to an open area and try again.";
    }
  }
  return err.message || "Could not get your location.";
}

// ── Report form: show/hide the name field based on anonymous toggle ───────

function toggleName(checkbox) {
  // Called by the anonymous switch in report.html — shows name input when unchecked
  const nameField = document.getElementById("nameField");
  if (nameField) {
    nameField.style.display = checkbox.checked ? "none" : "block";
  }
}

// ── Theme toggle: flips data-bs-theme + our own --color-* variables ───────
// Called by the "Dark Mode"/"Light Mode" item in the profile dropdown.

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-bs-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";

  document.documentElement.setAttribute("data-bs-theme", next);
  try {
    localStorage.setItem("goursafe-theme", next);
  } catch (e) {
    // Storage unavailable (private browsing, etc.) — theme still applies
    // for the rest of this page view, it just won't persist.
  }

  syncThemeMenuLabel();
}

function syncThemeMenuLabel() {
  // Keeps the dropdown's own label/icon in sync with whichever theme is
  // actually active — runs on click AND once on page load, since the
  // page is server-rendered and doesn't know the stored preference until
  // the early <head> script (in base.html) has already set the attribute.
  const current = document.documentElement.getAttribute("data-bs-theme") || "dark";
  const isDark = current === "dark";

  document.querySelectorAll("[data-theme-label]").forEach((el) => {
    el.textContent = isDark ? "Dark Mode" : "Light Mode";
  });
  document.querySelectorAll("[data-theme-icon]").forEach((el) => {
    el.className = (isDark ? "bi bi-moon-stars-fill" : "bi bi-sun-fill") + " me-2";
  });
}

document.addEventListener("DOMContentLoaded", syncThemeMenuLabel);
