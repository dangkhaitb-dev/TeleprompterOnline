// storage-monitor.js — Real-time storage quota monitor for long recordings.
//
// Dynamic warning tiers based on browser quota percentages (clamped for mobile/desktop):
//   Tier 1 (Warning)   : free space drops below WARN threshold (5% of quota, clamped 200MB - 500MB)
//   Tier 2 (Auto-Stop) : free space drops below AUTO-STOP threshold (2% of quota, clamped 50MB - 200MB)
//   Block Start        : free space drops below BLOCK threshold (0.5% of quota, clamped 30MB - 100MB)
//
// Before recording starts, call checkBeforeRecord() to get a pre-flight result.

/** Poll interval while recording is active (ms). */
const POLL_INTERVAL_MS = 12_000;

// Default fallbacks when quota estimate is unavailable.
const DEFAULT_WARN_BYTES = 200 * 1024 * 1024;
const DEFAULT_AUTO_STOP_BYTES = 50 * 1024 * 1024;
const DEFAULT_BLOCK_BYTES = 30 * 1024 * 1024;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read current storage estimate from the browser.
 * Returns { usage, quota, free } in bytes, or null if unsupported.
 * @returns {Promise<{usage:number, quota:number, free:number}|null>}
 */
export async function getStorageInfo() {
  try {
    if (!navigator?.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, free: Math.max(0, quota - usage) };
  } catch {
    return null;
  }
}

/**
 * Format bytes into a human-readable string (e.g. "1.2 GB", "450 MB").
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024)      return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * Calculate dynamic thresholds based on the browser's quota.
 * @param {number} quota
 */
export function getThresholds(quota) {
  if (!quota) {
    return {
      warnBytes: DEFAULT_WARN_BYTES,
      autoStopBytes: DEFAULT_AUTO_STOP_BYTES,
      blockBytes: DEFAULT_BLOCK_BYTES,
    };
  }

  // Warn: 5% of quota, minimum 200MB, maximum 500MB
  const warnBytes = Math.min(500 * 1024 * 1024, Math.max(DEFAULT_WARN_BYTES, quota * 0.05));

  // Auto-Stop: 2% of quota, minimum 50MB, maximum 200MB
  const autoStopBytes = Math.min(200 * 1024 * 1024, Math.max(DEFAULT_AUTO_STOP_BYTES, quota * 0.02));

  // Block: 0.5% of quota, minimum 30MB, maximum 100MB
  const blockBytes = Math.min(100 * 1024 * 1024, Math.max(DEFAULT_BLOCK_BYTES, quota * 0.005));

  return { warnBytes, autoStopBytes, blockBytes };
}

// ── Pre-flight check ─────────────────────────────────────────────────────────

/**
 * Check storage before starting a recording.
 *
 * Returns one of:
 *   { ok: true }
 *   { ok: false, blocked: true,  free, message }   → not enough space to start
 *   { ok: false, blocked: false, free, message }   → warn but allow
 *   { ok: true,  unknown: true }                   → could not read quota (allow)
 *
 * @returns {Promise<{ok:boolean, blocked?:boolean, free?:number, message?:string, unknown?:boolean}>}
 */
export async function checkBeforeRecord() {
  const info = await getStorageInfo();
  if (!info) return { ok: true, unknown: true };

  const { free, quota } = info;
  const { warnBytes, blockBytes } = getThresholds(quota);

  if (free < blockBytes) {
    return {
      ok: false,
      blocked: true,
      free,
      message: `Only ${formatBytes(free)} free — need at least ${formatBytes(blockBytes)} to record.`,
    };
  }
  if (free < warnBytes) {
    return {
      ok: false,
      blocked: false,
      free,
      message: `Low storage: ${formatBytes(free)} free. Recording may stop automatically.`,
    };
  }
  return { ok: true, free };
}

// ── Runtime monitor ──────────────────────────────────────────────────────────

/**
 * Create a storage monitor that polls while recording is active.
 *
 * Options:
 *   onWarn(free)      — called once when storage < warnBytes
 *   onAutoStop(free)  — called once when storage < autoStopBytes
 *
 * Returns { start(), stop() }.
 *
 * @param {{ onWarn?: (free:number)=>void, onAutoStop?: (free:number)=>void }} opts
 * @returns {{ start: ()=>void, stop: ()=>void }}
 */
export function createStorageMonitor({ onWarn, onAutoStop } = {}) {
  let timerId = null;
  let warnFired = false;
  let autoStopFired = false;

  async function poll() {
    const info = await getStorageInfo();
    if (!info) return;
    const { free, quota } = info;
    const { warnBytes, autoStopBytes } = getThresholds(quota);

    // Auto-stop tier — fires once, takes priority over warn.
    if (free < autoStopBytes && !autoStopFired) {
      autoStopFired = true;
      warnFired = true; // suppress lower-tier toast
      if (typeof onAutoStop === 'function') onAutoStop(free);
      return;
    }

    // Warning tier — fires once.
    if (free < warnBytes && !warnFired) {
      warnFired = true;
      if (typeof onWarn === 'function') onWarn(free);
    }
  }

  return {
    start() {
      warnFired = false;
      autoStopFired = false;
      if (timerId !== null) clearInterval(timerId);
      poll();
      timerId = setInterval(poll, POLL_INTERVAL_MS);
    },
    stop() {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    },
  };
}
