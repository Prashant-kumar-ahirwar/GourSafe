/* ============================================================
   operator.js — GourSafe Operator Console dashboard
   - Live map of SOS alerts (Leaflet)
   - Auto-refresh WITHOUT a page reload: the right-hand panel and the
     map markers are updated in place, so the map view and scroll
     position stay where the operator left them
   - Active / All filters, "Show on map" buttons
   Vanilla JS, no dependencies besides Leaflet.
   ============================================================ */

"use strict";

(function () {
  const REFRESH_SECONDS = 15;
  const CAMPUS = [23.8254, 78.7810];
  const CAMPUS_BOUNDS = [[23.77, 78.70], [23.89, 78.84]];

  const panelId = "opPanel";
  const toggle = document.getElementById("autoRefreshToggle");
  const countdownEl = document.getElementById("refreshCountdown");
  const mapEl = document.getElementById("opMap");
  if (!document.getElementById(panelId)) return; // not the dashboard (e.g. login page)

  // Remembered across refreshes
  const filters = { sos: "active", reports: "open" };

  // ── Map ────────────────────────────────────────────────────
  let map = null;
  const markers = new Map();   // alert id -> { marker, ring }
  let alerts = [];
  let firstFit = true;
  let knownIds = null;

  function readAlerts(root) {
    const el = root.querySelector("#opData");
    if (!el) return [];
    try { return JSON.parse(el.textContent) || []; } catch (e) { return []; }
  }

  function esc(v) {
    return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function makeIcon(active) {
    return L.divIcon({
      className: "op-pin-wrap",
      html: '<span class="op-pin ' + (active ? "op-pin--active" : "op-pin--handled") + '"></span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      popupAnchor: [0, -10],
    });
  }

  function popupHtml(a) {
    return (
      "<strong>SOS #" + esc(a.id) + "</strong> &middot; " + (a.status === "active" ? "Active" : "Handled") +
      "<br>" + esc(a.created) +
      "<br>Accuracy &plusmn;" + Math.round(a.acc) + " m" +
      (a.updated ? "<br>Updated " + esc(a.updated) : "")
    );
  }

  function initMap() {
    if (!mapEl || typeof L === "undefined") {
      if (mapEl) mapEl.innerHTML = '<div class="op-map__fail">Map could not load. Check the internet connection.</div>';
      return;
    }
    map = L.map(mapEl, {
      zoomControl: true,
      attributionControl: true,
      maxBounds: L.latLngBounds(CAMPUS_BOUNDS).pad(0.5),
      minZoom: 11,
    }).setView(CAMPUS, 15);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

  }

  function syncMarkers(list) {
    if (!map) return;
    const seen = new Set();
    list.forEach((a) => {
      seen.add(a.id);
      const active = a.status === "active";
      const pos = [a.lat, a.lng];
      let m = markers.get(a.id);
      if (!m) {
        m = {
          marker: L.marker(pos, { icon: makeIcon(active), zIndexOffset: active ? 1000 : 0 }).addTo(map),
          ring: L.circle(pos, { radius: a.acc || 0, weight: 1, fillOpacity: 0.08 }).addTo(map),
          active: active,
        };
        markers.set(a.id, m);
      }
      m.marker.setLatLng(pos);
      m.marker.setZIndexOffset(active ? 1000 : 0);
      if (m.active !== active) { m.marker.setIcon(makeIcon(active)); m.active = active; }
      m.marker.bindPopup(popupHtml(a));
      m.ring.setLatLng(pos).setRadius(a.acc || 0)
        .setStyle({ color: active ? "#dc3545" : "#6c757d", fillColor: active ? "#dc3545" : "#6c757d" });
      m.ring.setStyle({ opacity: active ? 0.7 : 0.3 });
    });
    markers.forEach((m, id) => {
      if (!seen.has(id)) { map.removeLayer(m.marker); map.removeLayer(m.ring); markers.delete(id); }
    });
  }

  function fitAlerts(animate) {
    if (!map) return;
    const active = alerts.filter((a) => a.status === "active");
    const use = active.length ? active : alerts;
    if (!use.length) { map.fitBounds(CAMPUS_BOUNDS, { animate: !!animate }); return; }
    if (use.length === 1) { map.setView([use[0].lat, use[0].lng], 17, { animate: !!animate }); return; }
    map.fitBounds(L.latLngBounds(use.map((a) => [a.lat, a.lng])).pad(0.3), { animate: !!animate, maxZoom: 17 });
  }

  function updateMap(list) {
    alerts = list;
    syncMarkers(list);
    // First load: zoom to the alerts. Later refreshes leave the map where the operator put it,
    // except when a NEW active SOS arrives: then jump to it.
    const ids = new Set(list.map((a) => a.id));
    const hasNewActive = knownIds && list.some((a) => a.status === "active" && !knownIds.has(a.id));
    knownIds = ids;
    if (firstFit) { firstFit = false; fitAlerts(false); }
    else if (hasNewActive) { fitAlerts(true); }
  }

  function locate(id) {
    const m = markers.get(id);
    if (!map || !m) return;
    map.setView(m.marker.getLatLng(), Math.max(map.getZoom(), 17), { animate: true });
    m.marker.openPopup();
    // On phones the map sits above the list: bring it into view
    if (window.matchMedia("(max-width: 991.98px)").matches) {
      mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // ── Filters ────────────────────────────────────────────────
  function applyFilters() {
    document.querySelectorAll("[data-filter-group]").forEach((group) => {
      const name = group.getAttribute("data-filter-group");
      const current = filters[name];
      group.querySelectorAll(".op-chip").forEach((chip) => {
        chip.classList.toggle("is-on", chip.getAttribute("data-filter") === current);
      });
      const list = document.querySelector('[data-list="' + name + '"]');
      if (!list) return;
      let visible = 0;
      list.querySelectorAll(".op-item").forEach((item) => {
        const st = item.getAttribute("data-status");
        let show = true;
        if (current === "active") show = st === "active";
        if (current === "open") show = st !== "resolved";
        item.hidden = !show;
        if (show) visible += 1;
      });
      const empty = list.querySelector("[data-empty]");
      if (empty) empty.hidden = visible > 0;
    });
  }

  document.addEventListener("click", (e) => {
    const chip = e.target.closest(".op-chip");
    if (chip) {
      const group = chip.closest("[data-filter-group]");
      filters[group.getAttribute("data-filter-group")] = chip.getAttribute("data-filter");
      applyFilters();
      return;
    }
    const loc = e.target.closest("[data-locate]");
    if (loc) { locate(Number(loc.getAttribute("data-locate"))); return; }
    if (e.target.closest("#mapFitBtn")) { fitAlerts(true); return; }
    if (e.target.closest("#mapCampusBtn")) { if (map) map.fitBounds(CAMPUS_BOUNDS, { animate: true }); }
  });

  // ── Auto-refresh in place ──────────────────────────────────
  let remaining = REFRESH_SECONDS;
  let timerId = null;
  let busy = false;

  async function refreshNow() {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch(window.location.href, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { "X-Requested-With": "fetch" },
      });
      // Session ended or server error: do a normal reload so the operator sees the login page
      if (!res.ok || res.redirected) { window.location.reload(); return; }
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const fresh = doc.getElementById(panelId);
      if (!fresh) { window.location.reload(); return; }
      document.getElementById(panelId).innerHTML = fresh.innerHTML;
      updateMap(readAlerts(document));
      applyFilters();
    } catch (err) {
      /* offline for a moment: keep what is on screen and try again next time */
    } finally {
      busy = false;
    }
  }

  function tick() {
    // Do not swap the list while the operator is choosing a status
    const a = document.activeElement;
    if (a && a.tagName === "SELECT") return;
    remaining -= 1;
    countdownEl.textContent = remaining;
    if (remaining <= 0) {
      remaining = REFRESH_SECONDS;
      countdownEl.textContent = remaining;
      if (!document.hidden) refreshNow();
    }
  }

  function start() {
    remaining = REFRESH_SECONDS;
    countdownEl.textContent = remaining;
    if (timerId) clearInterval(timerId);
    timerId = setInterval(tick, 1000);
  }

  function stop() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    countdownEl.textContent = "off";
  }

  if (toggle && countdownEl) {
    toggle.addEventListener("change", () => (toggle.checked ? start() : stop()));
  }

  // Come back to the tab -> update straight away
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && toggle && toggle.checked) { remaining = REFRESH_SECONDS; refreshNow(); }
  });

  // ── Go ─────────────────────────────────────────────────────
  initMap();
  updateMap(readAlerts(document));
  applyFilters();
  if (toggle && toggle.checked && countdownEl) start();
})();
