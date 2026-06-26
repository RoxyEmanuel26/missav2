/**
 * MISSAV-J — Predictive Hover Prefetcher
 * Intelligently preloads JS chunks and warms up API caches based on user hover intent.
 * Highly bandwidth-safe: disables itself on 3G/2G or Data Saver mode.
 */

import api from './api.js?v=2.3.2';
import { Telemetry } from './telemetry.js?v=2.3.2';

const Prefetcher = {
  hoverTimers: new Map(),
  prefetchedUrls: new Set(),
  HOVER_DELAY_MS: 150, // Time required to prove intent

  init() {
    // Global event delegation for hovering
    document.addEventListener('mouseover', this.handleInteraction.bind(this), { passive: true });
    document.addEventListener('touchstart', this.handleInteraction.bind(this), { passive: true });
    
    // Cleanup if they abort hover
    document.addEventListener('mouseout', this.handleMouseOut.bind(this), { passive: true });
    document.addEventListener('touchend', this.handleMouseOut.bind(this), { passive: true });
    
    console.log('[Prefetcher] Predictive Engine Active (Bandwidth Safe)');
  },

  isBandwidthSafe() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      if (conn.saveData) return false;
      if (['slow-2g', '2g', '3g'].includes(conn.effectiveType)) return false;
    }
    return true;
  },

  handleInteraction(e) {
    if (!this.isBandwidthSafe()) return;

    // Find closest anchor tag
    const link = e.target.closest('a');
    if (!link || !link.href) return;
    
    // Ignore external links
    if (!link.href.startsWith(window.location.origin)) return;

    const href = link.href;
    
    // Don't prefetch if already done
    if (this.prefetchedUrls.has(href)) return;

    // Set a timer to confirm intent (not just passing over)
    const timer = setTimeout(() => {
      this.executePrefetch(link);
      this.prefetchedUrls.add(href);
    }, this.HOVER_DELAY_MS);

    this.hoverTimers.set(link, timer);
  },

  handleMouseOut(e) {
    const link = e.target.closest('a');
    if (link && this.hoverTimers.has(link)) {
      clearTimeout(this.hoverTimers.get(link));
      this.hoverTimers.delete(link);
    }
  },

  executePrefetch(link) {
    const url = new URL(link.href);
    const path = url.pathname;
    
    // 1. Module Prefetching
    // Extract base route ignoring language prefixes
    const cleanPath = path.replace(/^\/(?:[a-z]{2}(?:-[a-zA-Z]{2})?)\//, '/');
    
    try {
      if (cleanPath.startsWith('/watch')) {
        import('./player.js?v=2.3.2');
      } else if (cleanPath.startsWith('/search')) {
        import('./search.js?v=2.3.2');
      } else if (cleanPath.startsWith('/trending')) {
        import('./trending.js?v=2.3.2');
      } else if (cleanPath.startsWith('/recent')) {
        import('./recent.js?v=2.3.2');
      } else {
        // Fallback for categories, tags, homepage etc.
        import('./feed.js?v=2.3.2');
      }
    } catch (err) {
      // Ignore dynamic import aborts or failures on prefetch
    }

    // 2. Data-Layer Warmup (API Cache)
    const videoId = link.getAttribute('data-id');
    if (videoId) {
      // Fire a low-priority API fetch that we DO NOT await.
      // This warms up `apiCache` or `fetchPromises` in api.js.
      // If the user clicks 100ms later, player.js will latch onto this in-flight promise.
      api.getPost(videoId).catch(() => {});
      Telemetry.logVital('Prefetch', 1, { type: 'API', id: videoId });
    }
  }
};

export default Prefetcher;
