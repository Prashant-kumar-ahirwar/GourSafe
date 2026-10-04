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

  const button = document.getElementById("sosBtn");
  if (button) {
    button.classList.toggle("d-none", ["locating", "sending", "timer", "success"].includes(state));
  }

  ["Locating", "Sending", "Timer", "Success", "Error"].forEach((s) => {
    const el = document.getElementById("state" + s);
    if (el) el.classList.toggle("d-none", s.toLowerCase() !== state && !(state === "timer" && s === "Timer"));
  });
}

function formatCountdown(seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function startResponseTimer() {
  const valueEl = document.getElementById("countdownValue");
  if (!valueEl) return;

  let remaining = 30;
  valueEl.textContent = formatCountdown(remaining);

  const timer = setInterval(() => {
    remaining -= 1;
    valueEl.textContent = formatCountdown(Math.max(0, remaining));

    if (remaining <= 0) {
      clearInterval(timer);
      valueEl.textContent = "00:00";
      const info = document.getElementById("stateTimer");
      if (info) {
        const msg = info.querySelector(".small.text-white-50");
        if (msg) {
          msg.textContent = "The campus safety cell is on the way and should reach you shortly.";
        }
      }
    }
  }, 1000);
}

const DHSGU_IT_CELL = { latitude: 23.8381, longitude: 78.7414 };
const DHSGU_CAMPUS = { latitude: 23.8254493, longitude: 78.7809602 };
const SOS_RANGE_KM = 5;
let campusLeafletMap = null;
let userLocationMarker = null;
const CAMPUS_PLACES = [
  {
    name: "Valley Campus",
    type: "campus",
    latitude: 23.8254493,
    longitude: 78.7809602,
    note: "Valley Campus Road map reference; confirm the exact campus entrance.",
  },
  {
    name: "Jawaharlal Nehru Central Library",
    type: "library",
    latitude: 23.8268733,
    longitude: 78.7712647,
  },
  {
    name: "Department of Commerce",
    type: "department",
    latitude: 23.8246827,
    longitude: 78.7712887,
  },
  {
    name: "Department of Computer Science & Applications",
    type: "department",
    latitude: 23.8241153,
    longitude: 78.7821585,
  },
  {
    name: "Department of General & Applied Geography",
    type: "department",
    latitude: 23.828061,
    longitude: 78.772226,
  },
  {
    name: "Department of Applied Geology",
    type: "department",
    latitude: 23.8290884,
    longitude: 78.7726455,
  },
  {
    name: "Girls Hostel Complex",
    type: "hostel",
    latitude: 23.8305882,
    longitude: 78.7817282,
    note: "Nivedita I & II, Rani Lakshmi Bai, and Saraswati hostels. Approximate map listing; verify the entrance with the university.",
  },
];

function showMapFallback() {
  const fallback = document.getElementById("mapUnavailable");
  if (fallback) fallback.classList.remove("d-none");
}

function initializeCampusMap() {
  const mapElement = document.getElementById("campusMiniMap");
  if (!mapElement) return;
  if (!window.L) {
    showMapFallback();
    return;
  }

  // Keep the map inside the campus area and avoid animations: far fewer
  // tiles to download and much less work for a phone's WebView.
  const campusArea = L.latLngBounds([23.77, 78.70], [23.89, 78.84]);

  campusLeafletMap = L.map(mapElement, {
    zoomControl: true,
    scrollWheelZoom: false,
    preferCanvas: true,
    fadeAnimation: false,
    markerZoomAnimation: false,
    zoomSnap: 1,
    minZoom: 12,
    maxBounds: campusArea.pad(0.5),
    maxBoundsViscosity: 1.0,
  }).setView([DHSGU_CAMPUS.latitude, DHSGU_CAMPUS.longitude], 15);

  const tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    keepBuffer: 1,              // default is 2: load fewer off-screen tiles
    updateWhenZooming: false,   // wait until the zoom finishes
    crossOrigin: true,          // lets the service worker cache the tiles
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  }).addTo(campusLeafletMap);

  let receivedTiles = false;
  tileLayer.once("load", () => { receivedTiles = true; });
  tileLayer.on("tileerror", () => {
    if (!receivedTiles) showMapFallback();
  });

  const placeIcons = {
    campus: "bi-building-fill",
    library: "bi-book-half",
    department: "bi-mortarboard-fill",
    hostel: "bi-house-heart-fill",
  };

  CAMPUS_PLACES.forEach((place) => {
    const icon = L.divIcon({
      className: "campus-poi-marker",
      html: `<span class="campus-poi-marker__pin campus-poi-marker__pin--${place.type}"><i class="bi ${placeIcons[place.type]}" aria-hidden="true"></i></span>`,
      iconSize: [36, 42],
      iconAnchor: [18, 38],
      popupAnchor: [0, -36],
    });
    const popup = `<strong>${place.name}</strong>${place.note ? `<br><small>${place.note}</small>` : ""}`;
    L.marker([place.latitude, place.longitude], { icon, title: place.name })
      .addTo(campusLeafletMap)
      .bindPopup(popup)
      .bindTooltip(place.name, {
        direction: "top",
        offset: [0, -34],
        className: "campus-place-tooltip",
      });
  });

  const placesBounds = L.latLngBounds(
    CAMPUS_PLACES.map((place) => [place.latitude, place.longitude])
  );
  campusLeafletMap.fitBounds(placesBounds.pad(0.18), { maxZoom: 16, animate: false });

  campusLeafletMap.whenReady(() => campusLeafletMap.invalidateSize());
}

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function updateCampusBadge(distanceKm) {
  const badge = document.getElementById("campusDistanceBadge");
  const text = document.getElementById("campusDistanceText");
  if (!badge || !text) return;

  if (typeof distanceKm !== "number" || Number.isNaN(distanceKm)) {
    badge.dataset.state = "unavailable";
    text.textContent = "GPS unavailable";
    return;
  }

  const isWithinRange = distanceKm <= SOS_RANGE_KM;
  badge.dataset.state = isWithinRange ? "live" : "outside-range";
  text.textContent = isWithinRange
    ? `Live GPS · ${distanceKm.toFixed(1)} km from IT Cell`
    : `Live GPS · outside ${SOS_RANGE_KM} km service area`;
}

function updateUserLocationOnMap(latitude, longitude) {
  if (!campusLeafletMap || !window.L) return;

  const location = [latitude, longitude];
  if (!userLocationMarker) {
    userLocationMarker = L.circleMarker(location, {
      radius: 8,
      color: "#ffffff",
      weight: 3,
      fillColor: "#2563eb",
      fillOpacity: 1,
    }).addTo(campusLeafletMap).bindPopup("Your current location");
  } else {
    userLocationMarker.setLatLng(location);
  }

  const campusBounds = L.latLngBounds(
    CAMPUS_PLACES.map((place) => [place.latitude, place.longitude])
  );
  campusBounds.extend(location);
  campusLeafletMap.fitBounds(campusBounds.pad(0.18), {
    maxZoom: 16,
    animate: false,
  });

  const distanceKm = getDistanceKm(latitude, longitude, DHSGU_IT_CELL.latitude, DHSGU_IT_CELL.longitude);
  updateCampusBadge(distanceKm);
}

async function refreshCampusLocation() {
  const btn = document.getElementById("sosBtn");
  if (!btn) return;
  btn.disabled = true;

  try {
    const position = await getPosition();
    const { latitude, longitude } = position.coords;
    updateUserLocationOnMap(latitude, longitude);
    btn.disabled = getDistanceKm(latitude, longitude, DHSGU_IT_CELL.latitude, DHSGU_IT_CELL.longitude) > SOS_RANGE_KM;
  } catch (err) {
    updateCampusBadge(Number.NaN);
    if (btn) btn.disabled = true;
  }
}

function setupSOSHold() {
  const button = document.getElementById("sosBtn");
  if (!button) return;

  const holdDuration = 2000;
  let isHolding = false;
  let holdStartedAt = 0;
  let activePointerId = null;
  let animationFrame = 0;

  const resetHold = () => {
    isHolding = false;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    button.classList.remove("is-holding");
    button.style.setProperty("--hold-progress", "0%");
    button.setAttribute("aria-label", "Press and hold for 2 seconds to send SOS");
    if (activePointerId !== null && button.hasPointerCapture(activePointerId)) {
      button.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
  };

  const confirmSOS = () => {
    if (!isHolding) return;
    resetHold();
    button.setAttribute("aria-label", "Sending emergency alert");
    sendSOS();
  };

  const updateProgress = () => {
    if (!isHolding) return;
    const elapsed = performance.now() - holdStartedAt;
    const progress = Math.min(100, (elapsed / holdDuration) * 100);
    button.style.setProperty("--hold-progress", `${progress}%`);
    if (elapsed >= holdDuration) {
      confirmSOS();
      return;
    }
    animationFrame = requestAnimationFrame(updateProgress);
  };

  const beginHold = (event) => {
    if (button.disabled || isHolding) return;
    if (event.type === "pointerdown" && event.button !== 0) return;
    event.preventDefault();
    isHolding = true;
    holdStartedAt = performance.now();
    activePointerId = Number.isInteger(event.pointerId) ? event.pointerId : null;
    if (activePointerId !== null) button.setPointerCapture(activePointerId);
    button.classList.add("is-holding");
    button.setAttribute("aria-label", "Keep holding to send SOS");
    animationFrame = requestAnimationFrame(updateProgress);
  };

  const endHold = (event) => {
    if (!isHolding) return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    if (performance.now() - holdStartedAt >= holdDuration) confirmSOS();
    else resetHold();
  };

  button.addEventListener("pointerdown", beginHold);
  button.addEventListener("pointerup", endHold);
  button.addEventListener("pointercancel", resetHold);
  button.addEventListener("lostpointercapture", resetHold);
  button.addEventListener("pointermove", (event) => {
    if (!isHolding || activePointerId === null) return;
    const bounds = button.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) {
      resetHold();
    }
  });
  button.addEventListener("keydown", (event) => {
    if (event.code === "Space" || event.code === "Enter") beginHold(event);
  });
  button.addEventListener("keyup", (event) => {
    if (event.code === "Space" || event.code === "Enter") endHold(event);
  });
  button.addEventListener("click", (event) => event.preventDefault());
}

function setupMapExpand() {
  const mapCard = document.querySelector(".home-map");
  const button = document.getElementById("mapExpandBtn");
  if (!mapCard || !button) return;

  const setExpanded = (expanded) => {
    mapCard.classList.toggle("is-expanded", expanded);
    document.body.classList.toggle("map-open", expanded);
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", expanded ? "Close expanded map" : "Expand campus map");
    button.title = expanded ? "Close map" : "Expand map";
    button.innerHTML = `<i class="bi ${expanded ? "bi-x-lg" : "bi-arrows-fullscreen"}" aria-hidden="true"></i>`;
    // Wait two frames so the new size is laid out, then resize the map once.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (campusLeafletMap) campusLeafletMap.invalidateSize({ pan: false, animate: false });
    }));
  };

  button.addEventListener("click", () => setExpanded(!mapCard.classList.contains("is-expanded")));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mapCard.classList.contains("is-expanded")) setExpanded(false);
  });
}

async function sendSOS() {
  const btn = document.getElementById("sosBtn");
  if (!btn) return;
  btn.disabled = true;

  // Android app only: go silent immediately (no-op in a normal browser)
  if (window.GourSafeNative) window.GourSafeNative.onSOSStart();

  // Step 1: acquire GPS position
  showState("locating");

  let position;
  try {
    position = await getPosition();
  } catch (err) {
    showState("error");
    document.getElementById("errorMsg").textContent = geolocationErrorMessage(err);
    btn.disabled = false;
    if (window.GourSafeNative) window.GourSafeNative.onSOSFailed();
    return;
  }

  const { latitude, longitude, accuracy } = position.coords;
  const distanceKm = getDistanceKm(latitude, longitude, DHSGU_IT_CELL.latitude, DHSGU_IT_CELL.longitude);

  if (distanceKm > SOS_RANGE_KM) {
    showState("error");
    const outOfRangeMessage = "You are outside the university emergency coverage area. Your SOS cannot be used from this location, and you are outside the 5 km service range of the DHSGU IT Cell. Please contact emergency services immediately or return within the campus zone.";
    document.getElementById("errorMsg").textContent = outOfRangeMessage;
    updateCampusBadge(distanceKm);
    btn.disabled = true;
    if (window.GourSafeNative) window.GourSafeNative.onSOSFailed();
    return;
  }

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

    const sosBtn = document.getElementById("sosBtn");
    if (sosBtn) sosBtn.classList.add("d-none");

    showState("timer");
    startResponseTimer();

    // Android app only: start live location sharing + show "SOS mode" bar
    if (window.GourSafeNative) window.GourSafeNative.onSOSSent(data);
    // Keep button disabled — one ping per page load is intentional
  } catch (err) {
    showState("error");
    document.getElementById("errorMsg").textContent =
      err.message || "Failed to reach the server. Call security directly.";
    btn.disabled = false;
    if (window.GourSafeNative) window.GourSafeNative.onSOSFailed();
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
  const current = document.documentElement.getAttribute("data-bs-theme") || "light";
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
  const current = document.documentElement.getAttribute("data-bs-theme") || "light";
  const isDark = current === "dark";

  document.querySelectorAll("[data-theme-label]").forEach((el) => {
    el.textContent = isDark ? "Light Mode" : "Dark Mode";
  });
  document.querySelectorAll("[data-theme-icon]").forEach((el) => {
    el.className = (isDark ? "bi bi-sun-fill" : "bi bi-moon-stars-fill") + " me-2";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  syncThemeMenuLabel();
  setupSOSHold();
  setupMapExpand();
  if (document.getElementById("campusMiniMap")) {
    initializeCampusMap();
    refreshCampusLocation();
  }
});
