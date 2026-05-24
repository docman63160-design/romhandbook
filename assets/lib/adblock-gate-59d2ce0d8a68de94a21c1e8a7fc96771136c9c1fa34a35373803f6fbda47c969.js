const OVERLAY_ID = "rom-adblock-overlay";
const OVERLAY_STYLE_ID = "rom-adblock-overlay-style";
const BAIT_ID = "rom-adblock-bait";
const ENV_META_SELECTOR = "meta[name='rom-env']";
const CHECK_TIMEOUT_MS = 2500;
const MONITOR_INTERVAL_MS = 7000;
const LOCAL_ADS_PROBE_URLS = [
  "/ads.js",
  "/ads-prebid-wp-banners.js",
  "/advertising.js"
];
const REMOTE_AD_SCRIPT_URLS = [
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
  "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
  "https://adservice.google.com/adsid/integrator.js?domain=romhandbook.com"
];
const INTERNET_CHECK_URLS = [
  "https://www.gstatic.com/generate_204",
  "https://www.google.com/generate_204"
];

let checkInFlight = null;

function ensureBait() {
  let bait = document.getElementById(BAIT_ID);
  if (bait) return bait;

  bait = document.createElement("div");
  bait.id = BAIT_ID;
  bait.className = "adsbox ad-banner ad-container ad-slot text-ad";
  bait.setAttribute("aria-hidden", "true");
  bait.style.position = "absolute";
  bait.style.left = "-9999px";
  bait.style.top = "-9999px";
  bait.style.width = "1px";
  bait.style.height = "1px";
  bait.style.pointerEvents = "none";
  document.body.appendChild(bait);

  return bait;
}

function detectAdblock() {
  const bait = ensureBait();
  if (!bait) return true;

  const style = window.getComputedStyle(bait);
  const hiddenByStyle =
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0";
  const hiddenBySize = bait.offsetWidth === 0 || bait.offsetHeight === 0;

  return hiddenByStyle || hiddenBySize;
}

function statusMessageFromSignals(signals) {
  const blockedSignals = [
    signals.baitBlocked && "ad elements are hidden",
    signals.localScriptBlocked && "local ad probe is blocked",
    signals.remoteScriptBlockedCount > 0 && `remote ad scripts blocked (${signals.remoteScriptBlockedCount})`,
    signals.remoteFetchBlockedCount > 0 && `ad network requests blocked (${signals.remoteFetchBlockedCount})`
  ].filter(Boolean);
  const unavailableSignals = [
    signals.localProbeUnavailable && "local ad probe is unavailable",
    signals.remoteChecksUnavailable && "remote ad checks are unavailable"
  ].filter(Boolean);

  if (blockedSignals.length === 0) {
    if (unavailableSignals.length > 0) {
      return `Ad checks unavailable: ${unavailableSignals.join(", ")}.`;
    }

    return "Ad blocker not detected.";
  }

  return `Blocked signals: ${blockedSignals.join(", ")}.`;
}

function isDebugEnv() {
  const env = document.querySelector(ENV_META_SELECTOR)?.content || "";
  return env === "development";
}

function isBlockedBySignals(signals) {
  if (signals.baitBlocked) return true;
  if (signals.localScriptBlocked) return true;

  // Avoid false positives from one blocked ad domain due to DNS/privacy tools,
  // but still catch common adblock behavior.
  const scriptBlocked = signals.remoteScriptBlockedCount;
  const fetchBlocked = signals.remoteFetchBlockedCount;
  if (scriptBlocked >= 2) return true;
  if (fetchBlocked >= 2) return true;
  if (scriptBlocked >= 1 && fetchBlocked >= 1) return true;

  return false;
}

async function detectScriptBlocked(scriptUrl, options = {}) {
  const { probeVar = null } = options;

  return new Promise((resolve) => {
    if (probeVar) window[probeVar] = false;

    const script = document.createElement("script");
    const cleanup = () => {
      script.onload = null;
      script.onerror = null;
      script.remove();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(true);
    }, CHECK_TIMEOUT_MS);

    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = `${scriptUrl}${scriptUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;
    script.onload = () => {
      window.clearTimeout(timer);
      cleanup();
      if (!probeVar) {
        resolve(false);
        return;
      }

      resolve(window[probeVar] !== true);
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      cleanup();
      resolve(true);
    };

    document.head.appendChild(script);
  });
}

async function detectUrlReachable(url, options = {}) {
  const {
    mode = "cors",
    credentials = "omit",
    expectOk = false
  } = options;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = window.setTimeout(() => {
    controller?.abort();
  }, CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`, {
      method: "GET",
      mode,
      cache: "no-store",
      credentials,
      signal: controller?.signal
    });

    return expectOk ? response.ok : true;
  } catch (_error) {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

async function detectOriginAvailable() {
  return detectUrlReachable("/up", {
    mode: "same-origin",
    credentials: "same-origin",
    expectOk: true
  });
}

async function detectInternetReachable() {
  if (navigator.onLine === false) return false;

  const results = await Promise.all(
    INTERNET_CHECK_URLS.map((url) =>
      detectUrlReachable(url, {
        mode: "no-cors",
        credentials: "omit"
      })
    )
  );

  return results.some(Boolean);
}

async function detectLocalProbeResult(probeUrl, index) {
  const available = await detectUrlReachable(probeUrl, {
    mode: "same-origin",
    credentials: "same-origin",
    expectOk: true
  });

  if (!available) {
    return { blocked: false, unavailable: true };
  }

  const blocked = await detectScriptBlocked(probeUrl, { probeVar: `__romLocalAdProbeLoaded${index}` });
  return { blocked, unavailable: false };
}

async function detectFetchBlocked() {
  const fetchChecks = REMOTE_AD_SCRIPT_URLS.map(async (url) => {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = window.setTimeout(() => {
      controller?.abort();
    }, CHECK_TIMEOUT_MS);

    try {
      await fetch(`${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`, {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit",
        signal: controller?.signal
      });

      return false;
    } catch (_error) {
      return true;
    } finally {
      window.clearTimeout(timer);
    }
  });

  const results = await Promise.all(fetchChecks);
  return results.filter(Boolean).length;
}

async function collectSignals() {
  const baitBlocked = detectAdblock();
  const originAvailable = await detectOriginAvailable();
  const internetReachable = originAvailable ? await detectInternetReachable() : false;

  let localScriptBlocked = false;
  let localProbeUnavailable = false;
  let remoteScriptBlockedCount = 0;
  let remoteFetchBlockedCount = 0;
  let remoteChecksUnavailable = !internetReachable;

  if (originAvailable) {
    const localProbeResults = await Promise.all(
      LOCAL_ADS_PROBE_URLS.map((probeUrl, index) => detectLocalProbeResult(probeUrl, index))
    );

    localScriptBlocked = localProbeResults.some((result) => result.blocked);
    localProbeUnavailable = localProbeResults.some((result) => result.unavailable);
  } else {
    localProbeUnavailable = true;
  }

  if (internetReachable) {
    const [remoteScriptResults, fetchBlockedCount] = await Promise.all([
      Promise.all(REMOTE_AD_SCRIPT_URLS.map((remoteUrl) => detectScriptBlocked(remoteUrl))),
      detectFetchBlocked()
    ]);

    remoteScriptBlockedCount = remoteScriptResults.filter(Boolean).length;
    remoteFetchBlockedCount = fetchBlockedCount;
    remoteChecksUnavailable = false;
  }

  return {
    baitBlocked,
    localScriptBlocked,
    localProbeUnavailable,
    remoteScriptBlockedCount,
    remoteFetchBlockedCount,
    remoteChecksUnavailable
  };
}

function ensureOverlayStyles() {
  if (document.getElementById(OVERLAY_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = OVERLAY_STYLE_ID;
  style.textContent = `
    html.rom-adblock-locked,
    body.rom-adblock-locked {
      overflow: hidden !important;
    }

    #${OVERLAY_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(10, 10, 10, 0.92);
      color: #f4f4f4;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }

    #${OVERLAY_ID}[hidden] {
      display: none !important;
    }

    #${OVERLAY_ID} .rom-adblock-card {
      width: min(100%, 560px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      background: #151515;
      padding: 20px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
    }

    #${OVERLAY_ID} .rom-adblock-title {
      margin: 0 0 8px;
      font-size: 1.4rem;
      font-weight: 700;
    }

    #${OVERLAY_ID} .rom-adblock-text {
      margin: 0 0 14px;
      color: #dddddd;
      line-height: 1.45;
      font-size: 0.98rem;
    }

    #${OVERLAY_ID} .rom-adblock-status {
      margin: 0 0 16px;
      padding: 10px 12px;
      border-radius: 8px;
      background: #2f1616;
      color: #ffd0d0;
      font-size: 0.9rem;
    }

    #${OVERLAY_ID} .rom-adblock-button {
      border: 0;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 0.95rem;
      font-weight: 600;
      background: #f4f4f4;
      color: #111111;
      cursor: pointer;
    }

    #${OVERLAY_ID} .rom-adblock-button:disabled {
      opacity: 0.6;
      cursor: wait;
    }
  `;

  document.head.appendChild(style);
}

function ensureOverlay() {
  let overlay = document.getElementById(OVERLAY_ID);
  if (overlay) return overlay;

  ensureOverlayStyles();

  overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="rom-adblock-card" role="alertdialog" aria-modal="true" aria-labelledby="rom-adblock-title">
      <h2 id="rom-adblock-title" class="rom-adblock-title">Ad blocker detected</h2>
      <p class="rom-adblock-text">Disable your ad blocker to continue using this website.</p>
      <p class="rom-adblock-status" id="rom-adblock-status">Access is blocked until ad blocker protection is turned off.</p>
      <button type="button" class="rom-adblock-button" id="rom-adblock-recheck">I disabled it. Re-check now</button>
    </div>
  `;

  document.body.appendChild(overlay);

  const button = overlay.querySelector("#rom-adblock-recheck");
  button?.addEventListener("click", async () => {
    button.disabled = true;
    setOverlayStatus("Re-checking...");
    await checkAndRender();
    button.disabled = false;
  });

  return overlay;
}

function showOverlay() {
  const overlay = ensureOverlay();
  overlay.hidden = false;
  document.documentElement.classList.add("rom-adblock-locked");
  document.body.classList.add("rom-adblock-locked");
}

function hideOverlay() {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) overlay.hidden = true;
  document.documentElement.classList.remove("rom-adblock-locked");
  document.body.classList.remove("rom-adblock-locked");
}

function setOverlayStatus(message) {
  const status = document.getElementById("rom-adblock-status");
  if (status) status.textContent = message;
}

async function runDetectionOnce() {
  if (checkInFlight) return checkInFlight;

  checkInFlight = collectSignals().finally(() => {
    checkInFlight = null;
  });

  return checkInFlight;
}

async function checkAndRender() {
  const signals = await runDetectionOnce();
  const blocked = isBlockedBySignals(signals);
  const statusMessage = statusMessageFromSignals(signals);
  const debugMode = isDebugEnv();

  if (blocked) {
    showOverlay();
    setOverlayStatus(
      debugMode
        ? statusMessage
        : "Access is blocked until ad blocker protection is turned off."
    );
    return;
  }

  hideOverlay();
  if (debugMode && statusMessage !== "Ad blocker not detected.") {
    console.debug("[adblock-check] partial signals:", signals);
  }
}

function startAdblockMonitor() {
  if (window.__romAdblockMonitorStarted) return;
  window.__romAdblockMonitorStarted = true;
  window.setInterval(() => {
    checkAndRender();
  }, MONITOR_INTERVAL_MS);
}

function initAdblockBlocker() {
  if (!document.body) return;
  ensureBait();
  ensureOverlay();
  window.setTimeout(() => {
    checkAndRender();
  }, 120);
  startAdblockMonitor();
}

window.__romAdblockDebug = async () => {
  const signals = await collectSignals();
  return signals;
};

document.addEventListener("turbo:load", initAdblockBlocker);
