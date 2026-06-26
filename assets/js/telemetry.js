/**
 * MISSAV-J — Telemetry & Diagnostics Engine
 * Lightweight, native performance observability and error tracking.
 * Zero 3rd-party SDK bloat. Uses native PerformanceObserver.
 */

export const Telemetry = {
  vitals: {},
  
  init() {
    this.setupErrorBoundaries();
    this.setupWebVitalsObserver();
    console.log('[Telemetry] Native Observability Engine Active');
  },

  setupErrorBoundaries() {
    // Global Uncaught Exceptions
    window.addEventListener('error', (event) => {
      this.logAnomaly('ClientError', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        url: window.location.href
      });
    });

    // Unhandled Promise Rejections (e.g. failed fetches not caught by try/catch)
    window.addEventListener('unhandledrejection', (event) => {
      this.logAnomaly('UnhandledPromise', {
        reason: event.reason?.message || event.reason,
        url: window.location.href
      });
    });
  },

  setupWebVitalsObserver() {
    if (!('PerformanceObserver' in window)) return;

    try {
      // 1. Largest Contentful Paint (LCP)
      const lcpObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const lastEntry = entries[entries.length - 1];
        this.vitals.LCP = lastEntry.startTime;
        this.logVital('LCP', lastEntry.startTime);
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });

      // 2. Cumulative Layout Shift (CLS)
      let clsValue = 0;
      const clsObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
          }
        }
        this.vitals.CLS = clsValue;
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true });

      // 3. Interaction to Next Paint (INP) / First Input Delay (FID) fallback
      const eventObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          // Calculate the interaction delay
          const delay = entry.processingStart - entry.startTime;
          this.logVital('InteractionDelay', delay, { name: entry.name });
        }
      });
      eventObserver.observe({ type: 'first-input', buffered: true });
      eventObserver.observe({ type: 'event', buffered: true }); // Captures INP candidates

    } catch (e) {
      console.warn('[Telemetry] Web Vitals Observer unsupported in this environment.');
    }
  },

  logVital(name, value, meta = {}) {
    // Threshold logging (visible warnings for poor performance)
    if (name === 'LCP' && value > 2500) {
      console.warn(`[Telemetry Anomaly] Slow LCP detected: ${Math.round(value)}ms`);
      this.logAnomaly('WebVitals_PoorLCP', { value: Math.round(value), url: window.location.pathname });
    } else if (name === 'InteractionDelay' && value > 200) {
      console.warn(`[Telemetry Anomaly] High Interaction Delay (${meta.name}): ${Math.round(value)}ms`);
      this.logAnomaly('WebVitals_PoorINP', { value: Math.round(value), url: window.location.pathname });
    } else if (name === 'CLS' && value > 0.1) {
      this.logAnomaly('WebVitals_PoorCLS', { value, url: window.location.pathname });
    }
    
    // In production, you would pipe this to GA4 or custom endpoint:
    // Analytics.trackEvent('web_vitals', { metric_name: name, metric_value: value });
  },

  logAnomaly(type, details) {
    // Distinguish SEO anomalies from runtime errors
    if (type.startsWith('SEO_')) {
      console.warn(`[SEO Diagnostics: ${type}]`, details);
      // Backend should route these to an SEO monitoring dashboard instead of Sentry/Crashlytics
    } else {
      console.error(`[Telemetry Anomaly: ${type}]`, details);
    }
  },

  trackRouteTransition(path, durationMs) {
    if (durationMs > 800) {
      this.logAnomaly('SlowRouteTransition', { path, durationMs: Math.round(durationMs) });
    } else {
      console.log(`[Telemetry] Route Transition ${path} — ${Math.round(durationMs)}ms`);
    }
  }
};
