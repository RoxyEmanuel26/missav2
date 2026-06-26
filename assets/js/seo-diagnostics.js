/**
 * MISSAV-J — Search Console Intelligence & Indexing Diagnostics
 * A lightweight automated SEO auditor that runs silently in the client
 * to detect Crawl Budget Waste, Soft 404s, and Duplicate Indexing risks.
 */

import { Telemetry } from './telemetry.js?v=2.2.2';

export const SeoDiagnostics = {
  runAudit() {
    // Run asynchronously to avoid blocking the main thread during route transition
    setTimeout(() => {
      try {
        this.checkCanonicalConsistency();
        this.checkSoft404();
        this.checkCrawlBudget();
        this.checkOrphanRisk();
      } catch (e) {
        console.warn('[SEO Diagnostics] Audit execution failed:', e);
      }
    }, 1000);
  },

  checkCanonicalConsistency() {
    const canonicalEl = document.querySelector('link[rel="canonical"]');
    if (!canonicalEl) return;
    
    const canonicalUrl = canonicalEl.href;
    const currentUrlObj = new URL(window.location.href);
    
    // Detect tracking parameter bloat which can cause duplicate indexing
    // if Googlebot ignores or misinterprets the canonical tag.
    const dangerousParams = ['utm_source', 'utm_medium', 'ref', 'gclid', 'fbclid', 'session_id'];
    let hasBloat = false;
    
    for (const param of dangerousParams) {
      if (currentUrlObj.searchParams.has(param)) {
        hasBloat = true;
        break;
      }
    }

    if (hasBloat && !canonicalUrl.includes(currentUrlObj.search)) {
      Telemetry.logAnomaly('SEO_DuplicateIndexingRisk', { 
        current: window.location.href, 
        canonical: canonicalUrl,
        reason: 'Tracking parameters detected on canonical mismatch.'
      });
    }
  },

  checkSoft404() {
    // Soft 404: HTTP 200 but page has no content or shows an error.
    const grid = document.getElementById('video-grid');
    const emptyState = document.querySelector('.empty-state, .empty-state-premium');
    
    // If it's a feed route, it has a grid. If grid is totally empty and there's no "Empty State" UI,
    // the page is rendering a blank view -> High Soft 404 risk for Googlebot.
    if (grid && grid.children.length === 0 && !emptyState && !document.querySelector('.skeleton')) {
      Telemetry.logAnomaly('SEO_Soft404Risk', {
        url: window.location.href,
        reason: 'Feed grid is rendered but contains 0 items and no fallback UI.'
      });
    }
  },

  checkCrawlBudget() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('page')) {
      const pageNum = parseInt(urlParams.get('page'), 10);
      // Paginating beyond depth 10 is considered extreme crawl budget waste for SPA bots
      if (pageNum > 10) {
        Telemetry.logAnomaly('SEO_CrawlBudgetWaste', {
          url: window.location.href,
          depth: pageNum
        });
      }
    }
  },

  checkOrphanRisk() {
    // Detect deep entry hits with no referrer. 
    // If a watch route is constantly hit by bots with no referrer, it might be an orphaned sitemap URL.
    const isWatchRoute = window.location.pathname.startsWith('/watch/');
    if (isWatchRoute && !document.referrer) {
      Telemetry.logVital('SEO_OrphanHit', 1, { url: window.location.pathname });
    }
  }
};
