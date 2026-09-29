(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KuaitingLatencyController = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TARGET = 0.5, FLOOR = 0.3, MAX_STEP = 0.06, STEP_INTERVAL_MS = 250;
  class LatencyController {
    constructor() { this.reset(); }
    reset() { this.lastStepAt = -Infinity; }
    decide({ buffer, ready = true, seeking = false, paused = false, rate = 1, now }) {
      const result = { seek: 0, rate: 1, chasing: false, target: TARGET };
      if (!Number.isFinite(buffer) || buffer <= FLOOR || !ready || seeking || paused) return result;
      const excess = buffer - TARGET;
      if (excess <= 0.08) return result;
      result.chasing = true;
      result.rate = Math.min(Math.max(Math.min(1.08, 1.02 + excess * 0.025), rate), 1.5);
      if (now - this.lastStepAt >= STEP_INTERVAL_MS) {
        result.seek = Math.min(MAX_STEP, Math.max(0.02, excess * 0.06), buffer - TARGET);
        this.lastStepAt = now;
      }
      return result;
    }
  }
  LatencyController.config = Object.freeze({ target: TARGET, floor: FLOOR, maxStep: MAX_STEP, intervalMs: STEP_INTERVAL_MS });
  return LatencyController;
});
