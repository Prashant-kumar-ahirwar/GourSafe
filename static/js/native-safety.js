/* ============================================================
   native-safety.js — GourSafe Android app features
   Only does anything inside the Capacitor Android app.
   In a normal browser, window.GourSafeNative.isNative is false and
   every function below is a harmless no-op.

   What it does when an SOS is sent from the app:
     1. Silences the phone (Do Not Disturb + silent ringer)  [optional]
     2. Keeps sending live location to campus security, even with
        the screen locked (Android foreground service)
     3. Shows a small "SOS mode active" bar; ending it needs a Safe PIN

   Also: on launch it asks for the permissions the app needs (location,
   Do Not Disturb access, notifications, battery) in one friendly pop-up.
   ============================================================ */

"use strict";

(function () {
  const cap = window.Capacitor;
  const isNative = !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());

  const SETTINGS_KEY = "goursafe_native_settings";
  const SESSION_KEY = "goursafe_sos_session";
  const UPDATE_EVERY_MS = 10000; // send a new location at most every 10 s

  // ── Settings (stored on the phone only) ─────────────────────────────────
  const DEFAULTS = { silent: true, dim: false, pinHash: null };

  function getSettings() {
    try {
      return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }
  function saveSettings(patch) {
    const next = Object.assign(getSettings(), patch);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  async function hashPin(pin) {
    const bytes = new TextEncoder().encode("goursafe:" + pin);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ── Native plugins (only exist inside the app) ──────────────────────────
  const SafetyMode = isNative ? cap.registerPlugin("SafetyMode") : null;
  const BackgroundGeolocation = isNative ? cap.registerPlugin("BackgroundGeolocation") : null;

  // ── SOS session (survives page navigation / reload) ─────────────────────
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
  }
  function saveSession(s) {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }

  let watcherId = null;
  let lastSent = 0;

  async function startTracking(session) {
    if (!BackgroundGeolocation || watcherId) return;
    try {
      // Flask pages reload fully on navigation, so the previous page's native
      // watcher may still be running. Remove it first to avoid duplicates.
      if (session.watcherId) {
        try { await BackgroundGeolocation.removeWatcher({ id: session.watcherId }); } catch (e) { /* already gone */ }
      }
      watcherId = await BackgroundGeolocation.addWatcher(
        {
          backgroundTitle: "GourSafe",
          backgroundMessage: "Safety mode is on",
          requestPermissions: true,
          stale: false,
          distanceFilter: 0,
        },
        async function (location, error) {
          if (error || !location) return;
          const now = Date.now();
          if (now - lastSent < UPDATE_EVERY_MS) return;
          lastSent = now;
          try {
            const res = await fetch("/api/sos/" + session.alertId + "/location", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                track_token: session.token,
                latitude: location.latitude,
                longitude: location.longitude,
                accuracy: location.accuracy,
              }),
            });
            const data = await res.json();
            // Security marked it handled → stop tracking and restore the phone.
            if (data && data.ok && data.status && data.status !== "active") {
              await endSOSMode();
            }
          } catch (e) {
            /* offline: the next fix will try again */
          }
        }
      );
      session.watcherId = watcherId;
      saveSession(session);
    } catch (e) {
      console.error("Could not start background tracking", e);
    }
  }

  async function stopTracking() {
    if (BackgroundGeolocation && watcherId) {
      try { await BackgroundGeolocation.removeWatcher({ id: watcherId }); } catch (e) { /* ignore */ }
    }
    watcherId = null;
  }

  async function restorePhone() {
    if (!SafetyMode) return;
    try { await SafetyMode.setDimmed({ on: false }); } catch (e) { /* ignore */ }
    try { await SafetyMode.disable(); } catch (e) { /* ignore */ }
  }

  // ── "SOS mode active" bar ───────────────────────────────────────────────
  function showBar() {
    if (document.getElementById("sosModeBar")) return;
    const bar = document.createElement("div");
    bar.id = "sosModeBar";
    bar.style.cssText =
      "position:fixed;left:8px;right:8px;bottom:78px;z-index:2000;background:#1B1F2A;color:#fff;" +
      "border:2px solid #C0392B;border-radius:12px;padding:10px 12px;display:flex;gap:10px;" +
      "align-items:center;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,.4)";
    bar.innerHTML =
      '<span style="flex:1">SOS mode is on. Security can see your location.</span>' +
      '<button type="button" id="sosModeEnd" class="btn btn-sm btn-light fw-bold">I am safe</button>';
    document.body.appendChild(bar);
    document.getElementById("sosModeEnd").addEventListener("click", askToEnd);
  }
  function hideBar() {
    const bar = document.getElementById("sosModeBar");
    if (bar) bar.remove();
  }

  async function askToEnd() {
    const { pinHash } = getSettings();
    if (pinHash) {
      const pin = window.prompt("Enter your Safe PIN to end SOS mode");
      if (pin === null) return;
      if ((await hashPin(pin.trim())) !== pinHash) {
        window.alert("Incorrect PIN.");
        return;
      }
    } else if (!window.confirm("End SOS mode and stop sharing live location?")) {
      return;
    }
    await endSOSMode();
  }

  async function setNativeSosFlag(active) {
    // Lets the native Back button know not to fully close the app during an SOS.
    if (!SafetyMode) return;
    try { await SafetyMode.setSosActive({ active }); } catch (e) { /* ignore */ }
  }

  async function endSOSMode() {
    await stopTracking();
    setNativeSosFlag(false);
    saveSession(null);
    hideBar();
    await restorePhone();
  }

  // ── Hooks called from script.js ─────────────────────────────────────────
  const GourSafeNative = {
    isNative,
    getSettings,

    // SOS hold completed: go quiet immediately, before GPS or network.
    async onSOSStart() {
      if (!isNative) return;
      const s = getSettings();
      try {
        if (s.silent) await SafetyMode.enable();
        if (s.dim) await SafetyMode.setDimmed({ on: true });
      } catch (e) {
        console.error(e);
      }
    },

    // Alert saved on the server → start live tracking.
    async onSOSSent(data) {
      if (!isNative || !data || !data.alert_id || !data.track_token) return;
      const session = { alertId: data.alert_id, token: data.track_token };
      saveSession(session);
      setNativeSosFlag(true);
      showBar();
      startTracking(session);
    },

    // SOS could not be sent → give the phone its sound back so the user can call.
    async onSOSFailed() {
      if (!isNative || loadSession()) return;
      await restorePhone();
    },

    // Opens the permission pop-up (also used by the Settings page button).
    openSetup() {
      if (isNative) showSetup(true);
    },
  };
  window.GourSafeNative = GourSafeNative;

  // ── Resume after a page change / reload ─────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    if (!isNative) return;
    const session = loadSession();
    if (session) {
      setNativeSosFlag(true);
      showBar();
      startTracking(session);
    } else {
      maybeShowSetupOnLaunch();
    }
    initSettingsCard();
  });


  // ── Permission pop-up ───────────────────────────────────────────────────
  const SETUP_SEEN_KEY = "goursafe_setup_seen";     // remembered on the phone
  const SETUP_SKIP_KEY = "goursafe_setup_skipped";  // this app session only

  async function getPermState() {
    const [perm, st] = await Promise.all([SafetyMode.checkPermissions(), SafetyMode.getStatus()]);
    return {
      raw: perm,
      location: perm.location === "granted",
      // Android 12 and older have no notification permission
      notifications: perm.notifications === "granted" || (st.sdk && st.sdk < 33),
      dnd: !!st.policyAccess,
      battery: !!st.batteryUnrestricted,
    };
  }

  // Each item: what it is, why we need it, how to ask for it.
  const SETUP_ITEMS = [
    {
      key: "location", icon: "bi-geo-alt-fill", required: true,
      title: "Location",
      why: "Sends your exact position to campus security when you press SOS.",
      async ask(state) {
        if (state.raw.location === "denied") await SafetyMode.openAppSettings();
        else await SafetyMode.requestPermissions({ permissions: ["location"] });
      },
    },
    {
      key: "dnd", icon: "bi-moon-stars-fill", required: true,
      title: "Do Not Disturb access",
      why: "Lets your phone go silent (no sound, no vibration) the moment you press SOS. Find GourSafe in the list and switch it on.",
      async ask() { await SafetyMode.requestPolicyAccess(); },
    },
    {
      key: "notifications", icon: "bi-bell-fill", required: false,
      title: "Notifications",
      why: "Needed on Android 13+ to show the small silent 'safety mode is on' message while location is being shared.",
      async ask(state) {
        if (state.raw.notifications === "denied") await SafetyMode.openAppSettings();
        else await SafetyMode.requestPermissions({ permissions: ["notifications"] });
      },
    },
    {
      key: "battery", icon: "bi-battery-charging", required: false,
      title: "Run in background",
      why: "Stops Android from putting GourSafe to sleep, so live location keeps working with the screen off. Tap GourSafe, then choose 'Don't optimise'.",
      async ask() { await SafetyMode.openBatterySettings(); },
    },
  ];

  function injectSetupStyles() {
    if (document.getElementById("gsSetupCss")) return;
    const css = document.createElement("style");
    css.id = "gsSetupCss";
    css.textContent =
      "#gsSetup{position:fixed;inset:0;z-index:3000;background:rgba(10,12,18,.92);display:flex;align-items:flex-end;justify-content:center;}" +
      "#gsSetup .gs-sheet{background:#1B1F2A;color:#fff;width:100%;max-width:560px;max-height:92%;overflow-y:auto;border-radius:18px 18px 0 0;padding:20px 16px calc(16px + env(safe-area-inset-bottom));}" +
      "#gsSetup h2{font-size:1.25rem;font-weight:800;margin:0 0 4px;}" +
      "#gsSetup .gs-sub{color:#aeb6c4;font-size:.9rem;margin-bottom:14px;}" +
      "#gsSetup .gs-item{display:flex;gap:12px;align-items:flex-start;background:#262c3a;border-radius:14px;padding:12px;margin-bottom:10px;}" +
      "#gsSetup .gs-ico{flex:0 0 40px;height:40px;border-radius:50%;background:#C0392B;display:flex;align-items:center;justify-content:center;font-size:1.1rem;}" +
      "#gsSetup .gs-item.ok .gs-ico{background:#198754;}" +
      "#gsSetup .gs-body{flex:1;min-width:0;}" +
      "#gsSetup .gs-title{font-weight:700;font-size:1rem;}" +
      "#gsSetup .gs-tag{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#ffb4a8;margin-left:6px;}" +
      "#gsSetup .gs-why{color:#aeb6c4;font-size:.82rem;line-height:1.4;margin:3px 0 8px;}" +
      "#gsSetup .gs-btn{border:0;border-radius:10px;padding:8px 16px;font-weight:700;font-size:.9rem;background:#C0392B;color:#fff;}" +
      "#gsSetup .gs-done{color:#5fcf8a;font-weight:700;font-size:.9rem;}" +
      "#gsSetup .gs-foot{display:flex;flex-direction:column;gap:8px;margin-top:6px;}" +
      "#gsSetup .gs-main{border:0;border-radius:12px;padding:13px;font-weight:800;font-size:1rem;background:#fff;color:#1B1F2A;}" +
      "#gsSetup .gs-skip{border:0;background:transparent;color:#aeb6c4;padding:8px;font-size:.9rem;}";
    document.head.appendChild(css);
  }

  let setupOpen = false;

  async function renderSetup() {
    const root = document.getElementById("gsSetup");
    if (!root) return;
    const state = await getPermState();
    const list = root.querySelector(".gs-list");
    list.innerHTML = "";
    SETUP_ITEMS.forEach((item) => {
      const ok = !!state[item.key];
      const row = document.createElement("div");
      row.className = "gs-item" + (ok ? " ok" : "");
      row.innerHTML =
        '<div class="gs-ico"><i class="bi ' + (ok ? "bi-check-lg" : item.icon) + '"></i></div>' +
        '<div class="gs-body">' +
          '<div class="gs-title">' + item.title +
            '<span class="gs-tag">' + (item.required ? "Required" : "Recommended") + "</span></div>" +
          '<div class="gs-why">' + item.why + "</div>" +
          (ok ? '<span class="gs-done">Allowed</span>'
              : '<button type="button" class="gs-btn">' +
                (item.key === "location" && state.raw.location === "denied" ? "Open settings" : "Allow") +
                "</button>") +
        "</div>";
      const btn = row.querySelector(".gs-btn");
      if (btn) {
        btn.addEventListener("click", async () => {
          try { await item.ask(state); } catch (e) { console.error(e); }
          renderSetup();
        });
      }
      list.appendChild(row);
    });
    root.querySelector(".gs-main").textContent =
      state.location && state.dnd ? "Done" : "Continue";
  }

  function closeSetup() {
    const root = document.getElementById("gsSetup");
    if (root) root.remove();
    setupOpen = false;
    try { localStorage.setItem(SETUP_SEEN_KEY, "1"); } catch (e) { /* ignore */ }
    try { sessionStorage.setItem(SETUP_SKIP_KEY, "1"); } catch (e) { /* ignore */ }
  }

  async function showSetup(force) {
    if (!isNative || setupOpen || document.getElementById("gsSetup")) return;
    injectSetupStyles();
    setupOpen = true;

    const root = document.createElement("div");
    root.id = "gsSetup";
    root.innerHTML =
      '<div class="gs-sheet" role="dialog" aria-modal="true" aria-labelledby="gsSetupTitle">' +
        '<h2 id="gsSetupTitle">Set up GourSafe</h2>' +
        '<div class="gs-sub">These permissions let SOS work properly when you need it.</div>' +
        '<div class="gs-list"></div>' +
        '<div class="gs-foot">' +
          '<button type="button" class="gs-main">Continue</button>' +
          '<button type="button" class="gs-skip">Skip for now</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(root);

    root.querySelector(".gs-main").addEventListener("click", async () => {
      const st = await getPermState();
      if (!(st.location && st.dnd) &&
          !window.confirm("Without Location and Do Not Disturb access, SOS cannot work fully. Continue anyway?")) {
        return;
      }
      closeSetup();
    });
    root.querySelector(".gs-skip").addEventListener("click", closeSetup);

    await renderSetup();
  }

  // After the user returns from a system Settings screen, refresh the ticks.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && document.getElementById("gsSetup")) renderSetup();
  });

  // On launch: first time ever, or whenever Location / Do Not Disturb is still missing.
  async function maybeShowSetupOnLaunch() {
    try {
      if (sessionStorage.getItem(SETUP_SKIP_KEY)) return;
      const state = await getPermState();
      const firstTime = !localStorage.getItem(SETUP_SEEN_KEY);
      const allGood = state.location && state.dnd && state.notifications && state.battery;
      const requiredMissing = !state.location || !state.dnd;
      if (allGood) return;
      if (firstTime || requiredMissing) showSetup(false);
    } catch (e) {
      console.error("Permission check failed", e);
    }
  }

  // ── Settings page card ──────────────────────────────────────────────────
  async function initSettingsCard() {
    const card = document.getElementById("nativeSafetyCard");
    if (!card) return;
    card.classList.remove("d-none");

    const $ = (id) => document.getElementById(id);
    const s = getSettings();
    $("nsSilent").checked = s.silent;
    $("nsDim").checked = s.dim;
    $("nsPinState").textContent = s.pinHash ? "A Safe PIN is set." : "No Safe PIN set yet.";

    async function refreshAccess() {
      try {
        const st = await SafetyMode.getStatus();
        $("nsAccess").textContent = st.policyAccess ? "Granted" : "Not granted";
        $("nsAccess").className = "badge " + (st.policyAccess ? "bg-success" : "bg-warning text-dark");
      } catch (e) {
        $("nsAccess").textContent = "Unknown";
      }
    }
    refreshAccess();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAccess(); });

    $("nsSilent").addEventListener("change", (e) => saveSettings({ silent: e.target.checked }));
    $("nsDim").addEventListener("change", (e) => saveSettings({ dim: e.target.checked }));
    $("nsGrant").addEventListener("click", () => SafetyMode.requestPolicyAccess());
    if ($("nsReview")) $("nsReview").addEventListener("click", () => showSetup(true));

    $("nsSavePin").addEventListener("click", async () => {
      const pin = $("nsPin").value.trim();
      if (!/^\d{4,8}$/.test(pin)) {
        window.alert("Use 4 to 8 digits.");
        return;
      }
      saveSettings({ pinHash: await hashPin(pin) });
      $("nsPin").value = "";
      $("nsPinState").textContent = "A Safe PIN is set.";
    });

    // Let the student check it works BEFORE an emergency.
    $("nsTest").addEventListener("click", async () => {
      $("nsTest").disabled = true;
      try {
        await SafetyMode.enable();
        window.alert("Silent mode is ON for 5 seconds. Your phone should now be silent.");
      } catch (e) {
        window.alert("Could not change sound mode: " + (e.message || e));
      }
      setTimeout(async () => {
        await restorePhone();
        $("nsTest").disabled = false;
      }, 5000);
    });
  }
})();
