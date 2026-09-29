/* ============================================================
   operator.js — GourSafe Operator Console
   Covers: auto-refresh toggle on the dashboard only
   Vanilla JS ES6+, no dependencies
   ============================================================ */

"use strict";

(function () {
  const REFRESH_SECONDS = 15;
  const toggle = document.getElementById("autoRefreshToggle");
  const countdownEl = document.getElementById("refreshCountdown");
  if (!toggle || !countdownEl) return;

  let remaining = REFRESH_SECONDS;
  let timerId = null;

  function tick() {
    remaining -= 1;
    countdownEl.textContent = remaining;
    if (remaining <= 0) {
      location.reload();
    }
  }

  function start() {
    remaining = REFRESH_SECONDS;
    countdownEl.textContent = remaining;
    timerId = setInterval(tick, 1000);
  }

  function stop() {
    if (timerId) clearInterval(timerId);
    countdownEl.textContent = "off";
  }

  toggle.addEventListener("change", () => {
    if (toggle.checked) {
      start();
    } else {
      stop();
    }
  });

  // Auto-refresh is on by default when the page loads
  start();
})();
