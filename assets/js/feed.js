/**
 * MISSAV-J — Homepage Feed & Infinite Scroll (Secured & Optimized)
 * Manages loading and rendering of primary video listings on the homepage,
 * infinite scrolling navigations, integrated horizontal filter listing triggers,
 * featuring complete XSS sanitization, premium inline SVG thumbnail fallbacks, and staggered delays.
 */

import api from './api.js?v=2.6.32';
import ui from './ui.js?v=2.6.32';
import filter from './filter.js?v=2.6.32';
import i18n from './i18n.js?v=2.6.32';
import { SessionHistory } from './history.js?v=2.6.32';
import { getLiveWatching, getTrendingBadge } from './social-signals.js?v=2.6.32';

// Feed State (In-memory, isolated per lifecycle page reload)
let currentPage = 1;
let totalPages = 1;
let isLoading = false;
let hasMore = true;
let currentFilters = {};
let isRandomizing = false;
let intersectionObserver = null;
let lastScrollTrigger = 0; // Throttle to prevent scroll floods
let scrollPenaltyUntil = 0; // Backoff cooldown when API fails
let seenCodes = new Set();
let seenTitles = new Set();
let totalRenderedVideos = 0;

// Random Mode State — used on the homepage to show a fresh mix of videos each visit
let randomMode = false;
let usedPages = new Set();

/**
 * Fisher-Yates in-place shuffle for randomizing video card order
 * @param {Array} arr - Array to shuffle
 * @returns {Array} The same array, shuffled in-place
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Premium inline SVG fallback used when video thumbnail fails to load
const SVG_FALLBACK_THUMB = `data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22180%22 viewBox=%220 0 320 180%22><rect width=%22320%22 height=%22180%22 fill=%22%23212121%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23717171%22 font-family=%22sans-serif%22 font-weight=%22bold%22 font-size=%2213%22>NO IMAGE</text></svg>`;

/**
 * Deterministically generates realistic and consistent video duration strings based on post ID if empty or zero.
 * @param {string|number} id - Post / Video ID reference
 * @returns {string} Duration formatted as HH:MM:SS
 */
export function getDeterministicDuration(id) {
  const numId = parseInt(id) || 12345;
  const hours = (numId % 2) + 1; // 1 or 2 hours
  const minutes = numId % 60;
  const seconds = (numId * 7) % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Renders single video card markup adhering to YouTube + apiJAV clean layout guidelines (Safe from XSS, featuring Staggered Delay)
 * @param {Object} post - API Video/post data object
 * @param {number} [index=0] - Card order index utilized for staggered animation delays
 * @param {boolean} [disableCinematic=false] - Disable the cinematic feature
 * @returns {string} Sanitized HTML markup template string
 */
export function renderVideoCard(post, index = 0, disableCinematic = false) {
  // 1. Sanitize API data to defeat XSS and translate the title dynamically
  const originalTitle = post.title || '';
  const translatedTitle = i18n.translateVideoTitle(originalTitle);
  const safeId = ui.escapeHTML(post.id);
  const safeTitle = ui.escapeHTML(translatedTitle);
  const safeOriginalTitleAttr = ui.escapeHTML(originalTitle);
  const safeStudio = ui.escapeHTML(post.studio || '');
  const safeCode = ui.escapeHTML(post.code || '');
  const safeThumbnail = ui.escapeHTML(ui.getProxiedThumbnail(post.thumbnail) || '');
  
  // Resolve duration fallback if missing or invalid
  let duration = post.duration || '';
  if (!duration || duration === '00:00:00') {
    duration = getDeterministicDuration(post.id);
  }
  const safeDuration = ui.escapeHTML(duration);

  // Uncensored badge detection (run on original title to guarantee correct matches regardless of language)
  const safeOriginalTitle = originalTitle.toLowerCase();
  const isUncensored = 
    (post.categories && post.categories.some(c => {
      const s = String(c).toLowerCase();
      return s.includes('uncensored') || s.includes('tanpa sensor') || s.includes('no sensor') || s.includes('mosaic-less') || s.includes('mosaicless');
    })) ||
    (post.tags && post.tags.some(t => {
      const s = String(t).toLowerCase();
      return s.includes('uncensored') || s.includes('tanpa sensor') || s.includes('no sensor') || s.includes('mosaic-less') || s.includes('mosaicless');
    })) ||
    safeOriginalTitle.includes('uncensored') || 
    safeOriginalTitle.includes('tanpa sensor') || 
    safeOriginalTitle.includes('no sensor') || 
    safeOriginalTitle.includes('leak') ||
    safeOriginalTitle.includes('tanpa-sensor') ||
    safeOriginalTitle.includes('no-sensor') ||
    safeOriginalTitle.includes('no-mosaic') ||
    safeOriginalTitle.includes('nomosaic');

  const uncensoredBadge = isUncensored ? `<span class="card-uncensored">${i18n.t('badge_uncensored')}</span>` : '';

  const currentLang = i18n.getLang();

  // Sanitize actor listings (Limit to first 3 chips for UX clarity)
  const actors = Array.isArray(post.actors) ? post.actors : (post.actors ? [post.actors] : []);
  const actorsMarkup = actors
    .slice(0, 3) 
    .map(a => {
      const safeActor = ui.escapeHTML(a);
      return `<a href="/${currentLang}/actor?name=${encodeURIComponent(safeActor)}" class="actor-chip" data-actor="${encodeURIComponent(safeActor)}">${safeActor}</a>`;
    })
    .join('');

  // Render HD badge indicator if present in titles/tags
  const isHD = safeOriginalTitle.includes('hd') || (post.tags && post.tags.some(t => String(t).toLowerCase() === 'hd'));
  const hdBadge = isHD ? `<span class="card-hd">HD</span>` : '';
  
  // Format Duration indicator
  const durationBadge = safeDuration ? `<span class="card-duration">${safeDuration}</span>` : '';

  // Format Studio link
  const studioMarkup = safeStudio 
    ? `<a href="/${currentLang}/studio?name=${encodeURIComponent(safeStudio)}" class="text-tag" data-studio="${encodeURIComponent(safeStudio)}">${safeStudio}</a>`
    : `<span class="text-tag text-muted" data-studio="Other">${i18n.t('unknown_studio')}</span>`;

  // Format views
  const viewsCount = post.views ? parseInt(post.views, 10) : 0;
  const viewsFormatted = viewsCount.toLocaleString(i18n.getLang());

  // Staggered animation delay
  // Removed artificial stagger animation delay to speed up perceived loading time
  const animationStyle = ``;

  const safeEmbedUrl = ui.escapeHTML((post.embed_url || '').replace(/&#038;/g, '&').replace(/&amp;/g, '&'));

  const isCinematic = index === 0 && !disableCinematic;
  const cardVariant = 'card-editorial';
  
  // Advanced Image Loading Strategy for Core Web Vitals
  const isLCP = index === 0;
  const isAboveFold = index < 8; // Load first 8 images immediately for faster perceived loading
  const rawThumb = (post.thumbnail || '').replace(/'/g, "\\'");
  const imgAttributes = `width="320" height="180" style="aspect-ratio: 16/9; background: #000;" ${isAboveFold ? 'decoding="sync"' : 'decoding="async" loading="lazy"'} ${isLCP ? 'fetchpriority="high"' : ''} onerror="if(this.src !== '${rawThumb}') { this.src='${rawThumb}'; } else { this.onerror=null; this.src='${SVG_FALLBACK_THUMB}'; }"`;

  // Semantic Watch Link
  const watchUrl = window.missavJGetWatchUrl ? window.missavJGetWatchUrl(safeId, safeCode, safeTitle) : `/watch/${safeId}`;
  
  // [SOCIAL SIGNALS] Deterministic calculation of live viewers and badges
  const rawViews = parseInt(post.views, 10) || 0;
  const liveViewers = getLiveWatching(post.id, rawViews);
  const trendingBadgeMarkup = getTrendingBadge(post.id, rawViews);

  let socialProofHtml = '';
  if (liveViewers > 5) {
    const isHot = liveViewers > 150 || post._isTrending;
    socialProofHtml = `
      <div class="social-proof-meta">
        <span class="live-pulse-dot ${isHot ? 'hot' : ''}"></span>
        <span>${liveViewers.toLocaleString(i18n.getLang())} ${i18n.t('watching_now') || 'watching now'}</span>
      </div>
    `;
  }

  const semanticHref = `/${currentLang}${watchUrl}`;

  const featuredClass = isCinematic ? 'card-featured' : '';

  return `
    <div class="video-card card-base ${cardVariant} ${featuredClass} fadeInUp" data-id="${safeId}" data-code="${safeCode}" data-title="${safeTitle}" data-embed-url="${safeEmbedUrl}" ${animationStyle}>
      <a href="${semanticHref}" class="card-main-link" aria-label="Watch ${safeTitle}"></a>
      <div class="card-thumb">
        <img src="${safeThumbnail || SVG_FALLBACK_THUMB}" alt="${safeTitle}" ${imgAttributes}>
        ${trendingBadgeMarkup || (post._isTrending ? `<span class="badge badge-trending">TRENDING</span>` : '')}
        ${uncensoredBadge ? `<span class="badge badge-uncensored">${i18n.t('badge_uncensored')}</span>` : ''}
        ${durationBadge ? `<span class="badge badge-duration">${safeDuration}</span>` : ''}
        ${hdBadge ? `<span class="badge badge-hd">HD</span>` : ''}
      </div>
      <div class="card-info">
        <h3 class="card-title" title="${safeTitle}" data-original-title="${safeOriginalTitleAttr}">${safeTitle}</h3>
        <div class="card-meta">
          ${studioMarkup}
          <span class="card-dot">•</span>
          <span class="card-code">${safeCode}</span>
          <span class="card-dot">•</span>
          <span class="card-views">${viewsFormatted} ${i18n.t('views')}</span>
        </div>
        ${socialProofHtml}
      </div>
    </div>
  `;
}

/**
 * Initializes the homepage feed listing
 * @param {Object} [filters] - Route filter overrides (e.g. category parsed from relative routing paths)
 * @param {AbortSignal} [signal] - Global route abort controller signal
 */
export async function init(filters = {}, signal) {
  // Dispose of active IntersectionObservers running from prior SPA page context loops
  if (intersectionObserver) {
    intersectionObserver.disconnect();
    intersectionObserver = null;
  }

  // Reset local page cycle memory states
  currentPage = 1;
  totalPages = 1;
  isLoading = false;
  hasMore = true;
  usedPages = new Set();
  seenCodes = new Set();
  seenTitles = new Set();
  totalRenderedVideos = 0;
  currentFilters = {
    per_page: 24,
    orderby: 'date',
    order: 'DESC',
    ...filters
  };

  // Enable random mode only on the unfiltered homepage (no actor/studio/category/tag/search)
  const hasSpecificFilter = filters.actor || filters.studio || filters.category || filters.tag || filters.search;
  randomMode = !hasSpecificFilter && !filters.orderby;

  // 1. Prepare Base Feed layout templates
  const mainApp = document.getElementById('app-content');
  if (!mainApp) return;

  // Build Taxonomy banner layouts dynamically if specialized filters are engaged
  let taxonomyBannerHtml = '';
  if (currentFilters.actor) {
    const actorName = ui.escapeHTML(currentFilters.actor);
    taxonomyBannerHtml = `
      <div class="taxonomy-banner fadeInUp" style="animation-delay: 50ms;">
        <div class="banner-icon">🎭</div>
        <div class="banner-content">
          <span class="banner-label">${i18n.t('banner_actor_label')}</span>
          <h2 class="banner-title">${actorName}</h2>
          <p class="banner-desc">${i18n.t('banner_actor_desc', { name: actorName })}</p>
        </div>
        <button class="banner-close" onclick="window.missavJNavigate('/')" title="Clear Filter">✕</button>
      </div>
    `;
  } else if (currentFilters.studio) {
    const studioName = ui.escapeHTML(currentFilters.studio);
    taxonomyBannerHtml = `
      <div class="taxonomy-banner fadeInUp" style="animation-delay: 50ms;">
        <div class="banner-icon">🎬</div>
        <div class="banner-content">
          <span class="banner-label">${i18n.t('banner_studio_label')}</span>
          <h2 class="banner-title">${studioName}</h2>
          <p class="banner-desc">${i18n.t('banner_studio_desc', { name: studioName })}</p>
        </div>
        <button class="banner-close" onclick="window.missavJNavigate('/')" title="Clear Filter">✕</button>
      </div>
    `;
  } else if (currentFilters.tag) {
    const tagName = ui.escapeHTML(currentFilters.tag);
    taxonomyBannerHtml = `
      <div class="taxonomy-banner fadeInUp" style="animation-delay: 50ms;">
        <div class="banner-icon">🏷️</div>
        <div class="banner-content">
          <span class="banner-label">${i18n.t('banner_tag_label')}</span>
          <h2 class="banner-title">${tagName}</h2>
          <p class="banner-desc">${i18n.t('banner_tag_desc', { name: tagName })}</p>
        </div>
        <button class="banner-close" onclick="window.missavJNavigate('/')" title="Clear Filter">✕</button>
      </div>
    `;
  } else if (currentFilters.category) {
    const catName = ui.escapeHTML(currentFilters.category);
    const dictKey = `category_${catName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const displayName = i18n.t(dictKey) || catName;
    
    // Render taxonomy banners only if category clicked is a non-standard curated header category
    const isSpecialCategory = ['Uncensored', 'Amateur', 'Subtitled', 'Creampie', 'Cosplay', 'Mosaic', 'POV'].indexOf(catName) === -1;
    if (isSpecialCategory) {
      taxonomyBannerHtml = `
        <div class="taxonomy-banner fadeInUp" style="animation-delay: 50ms;">
          <div class="banner-icon">📁</div>
          <div class="banner-content">
            <span class="banner-label">${i18n.t('banner_category_label')}</span>
            <h2 class="banner-title">${displayName}</h2>
            <p class="banner-desc">${i18n.t('banner_category_desc', { name: displayName })}</p>
          </div>
          <button class="banner-close" onclick="window.missavJNavigate('/')" title="Clear Filter">✕</button>
        </div>
      `;
    }
  }

  // --- Session Intelligence: Continue Watching ---
  let continueWatchingHtml = '';
  if (randomMode) { // Only on root homepage
    const history = SessionHistory.getHistory();
    if (history && history.length > 0) {
      // Render a mini-row of recently watched videos (up to 6 items)
      const historyCards = history.slice(0, 6).map(post => {
        const watched = post.watchedTime || 0;
        const dur = post.duration || 0;
        const pct = dur > 0 ? Math.min(Math.round((watched / dur) * 100), 100) : 0;
        
        const progressBar = watched > 0 ? `
          <div class="history-progress-bar">
            <div class="history-progress-fill" style="width: ${Math.max(pct, 1)}%"></div>
          </div>
        ` : '';
        
        let progressLabel = '';
        if (watched > 0 && dur > 0) {
          const leftSec = Math.max(dur - watched, 0);
          const leftMin = Math.floor(leftSec / 60);
          if (leftMin > 0) {
            progressLabel = `<span class="history-progress-label">${leftMin}m left</span>`;
          } else {
            progressLabel = `<span class="history-progress-label">${pct}%</span>`;
          }
        }
        
        const watchUrl = window.missavJGetWatchUrl ? window.missavJGetWatchUrl(post.id, post.code, post.title) : `/watch/${post.id}`;
        const currentLang = i18n.getLang() || 'en';
        const semanticHref = `/${currentLang}${watchUrl}`;
        const translatedTitle = i18n.translateVideoTitle(post.title || '');

        return `
          <div class="history-card-wrapper" id="history-card-${post.id}">
            <a href="${semanticHref}" class="history-card" title="${ui.escapeHTML(translatedTitle)}">
              <div class="history-thumb">
                <img src="${ui.getProxiedThumbnail(post.thumbnail)}" loading="lazy" style="aspect-ratio:16/9; width:100%; object-fit:cover; border-radius:8px;">
                ${progressBar}
                ${progressLabel}
              </div>
              <div class="history-card-info">
                ${post.code ? `<span class="history-code">${ui.escapeHTML(post.code)}</span>` : ''}
                <div class="history-title" title="${ui.escapeHTML(translatedTitle)}" data-original-title="${ui.escapeHTML(post.title || '')}">${ui.escapeHTML(translatedTitle)}</div>
              </div>
            </a>
            <button class="history-dismiss-btn" data-id="${post.id}" title="Remove from Continue Watching">✕</button>
          </div>
        `;
      }).join('');
      
      continueWatchingHtml = `
        <div class="continue-watching-section fadeInUp" style="margin-bottom: 24px; padding: 16px; background: rgba(255,255,255,0.02); border-radius: var(--radius-lg); border: 1px solid rgba(255,255,255,0.05);">
          <h3 style="margin: 0 0 12px 0; font-size: 1.1rem; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span style="display: flex; align-items: center; gap: 8px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              ${i18n.t('continue_watching') || 'Continue Watching'}
            </span>
          </h3>
          <div class="history-row">
            ${historyCards}
          </div>
        </div>
      `;
    }
  }

  mainApp.innerHTML = `
    <!-- Dynamic Taxonomy Banner -->
    ${taxonomyBannerHtml}
    
    <!-- Session Intelligence Row -->
    ${continueWatchingHtml}
    
    <div class="feed-controls-wrapper">
      <!-- Sticky Horizontal Filter Bar Container -->
      <div id="filter-bar-container" class="filter-bar-container"></div>
      
      <!-- Info bar & total video count tracking -->
      <div class="feed-info-bar">
        <div class="video-total-count" id="video-total-count">${i18n.t('loading_videos_count')}</div>
        <div class="page-track" id="page-track">${i18n.t('page_format', { current: 1, total: 1 })}</div>
      </div>
    </div>
    
    <!-- Main Video Grid container -->
    <div class="editorial-grid" id="video-grid"></div>

    <!-- Infinite Scroll Sentinel & Loading indicator -->
    <div id="infinite-loader" class="infinite-loader hidden">
      <div class="spinner"></div>
      <span>${i18n.t('loading_more_videos')}</span>
    </div>
    <div id="scroll-sentinel" class="scroll-sentinel"></div>
  `;

  // Bind Dismiss buttons for Continue Watching
  const dismissBtns = mainApp.querySelectorAll('.history-dismiss-btn');
  dismissBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const id = btn.dataset.id;
      SessionHistory.removeWatch(id);
      
      // Animate card dismissal (fade out)
      const wrapper = document.getElementById(`history-card-${id}`);
      if (wrapper) {
        wrapper.classList.add('dismissed');
        setTimeout(() => {
          wrapper.remove();
          // If no items are left, remove the entire continue watching section
          const row = mainApp.querySelector('.history-row');
          if (row && row.children.length === 0) {
            const section = mainApp.querySelector('.continue-watching-section');
            if (section) section.remove();
          }
        }, 300);
      }
    });
  });

  // 2. Render initial page skeletal loaders
  const grid = document.getElementById('video-grid');
  ui.showSkeletonsInElement(grid, 8);

  // 3. Mount homepage horizontal filter bar orchestration states
  filter.init(document.getElementById('filter-bar-container'), currentFilters, updateFeedFilters);

  // 4. Fire initial listings fetch
  await fetchAndRenderFeed(true, signal);

  // 5. Setup IntersectionObserver configurations for infinite scrolls
  setupInfiniteScroll();
  
  // 6. Connect delegators for grid actions
  bindGridClicks(grid);

  // 7. Mount hover listeners for dynamic Picture-in-Picture previews
  bindHoverPreviews(grid);
}

/**
 * Adaptive Client-Side Trending Engine
 * Calculates a momentum score to surface trending videos and simulate feed liveliness.
 */
function applyTrendingAlgorithm(posts) {
  // Use a time-based seed that shifts every 4 hours to keep the feed fresh
  const timeSeed = Math.floor(Date.now() / (1000 * 60 * 60 * 4)); 
  
  return posts.map(post => {
    const views = parseInt(post.views, 10) || 0;
    const id = parseInt(post.id, 10) || 0;
    
    // Create a pseudo-random multiplier based on video ID and the 4-hour time seed.
    // This gives some videos a temporary "viral boost" that rotates out.
    const livelinessFactor = 0.7 + (Math.abs(Math.sin(id + timeSeed)) * 0.6); // Multiplier between 0.7 and 1.3
    
    // Normalize recency (ID) into a bonus score (assuming IDs are in the tens of thousands)
    const recencyBonus = id * 0.05;
    
    // Final Momentum Score
    const score = (views * livelinessFactor) + recencyBonus;
    
    return { ...post, _trendScore: score };
  }).sort((a, b) => b._trendScore - a._trendScore);
}

/**
 * Fetch and render listings from API endpoints
 * @param {boolean} isInitial - Overwrites existing grid list markup if true
 * @param {AbortSignal} [signal] - Global route abort signal
 */
async function fetchAndRenderFeed(isInitial = false, signal) {
  isLoading = true;
  
  try {
    let fetchPage = currentPage;
    
    // OPTIMIZATION: Removed per_page: 1 probe. 
    // In random mode on initial load, we will fetch page 1 with full per_page.
    // We will discover totalPages from this fetch and randomize subsequent infinite scrolls.
    if (randomMode && isInitial && totalPages > 1) {
      // If we already know totalPages (e.g. returning to feed), we can pick random immediately.
      fetchPage = Math.floor(Math.random() * totalPages) + 1;
      currentPage = fetchPage;
    }
    
    usedPages.add(fetchPage);

    const data = await api.getPosts({ page: fetchPage, ...currentFilters, signal });

    // Zombie DOM Prevention: if route was aborted during fetch, abort render gracefully
    if (signal && signal.aborted) {
      isLoading = false;
      return;
    }

    // Shuffle results client-side in random mode for a fresh feel
    if (randomMode && data.posts.length > 1) {
      shuffleArray(data.posts);
    }
    
    const grid = document.getElementById('video-grid');
    if (!grid) return;

    const totalCountEl = document.getElementById('video-total-count');
    const pageTrackEl = document.getElementById('page-track');

    totalPages = data.totalPages;
    hasMore = currentPage < totalPages;

    // Render total listings count tracks in UI
    if (totalCountEl) {
      totalCountEl.textContent = i18n.t('video_available', { total: data.total.toLocaleString(i18n.getLang()) });
    }
    
    // Update pages tracking index
    if (pageTrackEl) {
      pageTrackEl.textContent = i18n.t('page_format', { current: currentPage, total: totalPages });
    }

    if (data.posts.length === 0 && isInitial) {
      // Smart Name-Swap Retry: If an actor search returned 0 results and the name
      // has 2+ words, automatically retry with the words reversed (handles
      // Japanese name order "Kano Yura" vs Western order "Yura Kano").
      if (currentFilters.actor) {
        const nameParts = currentFilters.actor.trim().split(/\s+/);
        if (nameParts.length >= 2) {
          const swappedName = nameParts.reverse().join(' ');
          console.log(`[Feed] Actor "${currentFilters.actor}" returned 0 results, retrying with swapped name: "${swappedName}"`);
          const retryData = await api.getPosts({ page: currentPage, ...currentFilters, actor: swappedName, signal });
          
          if (signal && signal.aborted) {
            isLoading = false;
            return;
          }

          if (retryData.posts.length > 0) {
            // Success! Update filters and UI to reflect the corrected name
            currentFilters.actor = swappedName;
            totalPages = retryData.totalPages;
            hasMore = currentPage < totalPages;

            // Update banner title to show the corrected name
            const bannerTitle = document.querySelector('.taxonomy-banner .banner-title');
            if (bannerTitle) bannerTitle.textContent = swappedName;

            if (totalCountEl) {
              totalCountEl.textContent = i18n.t('video_available', { total: retryData.total.toLocaleString(i18n.getLang()) });
            }
            if (pageTrackEl) {
              pageTrackEl.textContent = i18n.t('page_format', { current: currentPage, total: totalPages });
            }

            const uniqueRetryPosts = retryData.posts.filter(p => {
              const code = (p.code || '').trim().toUpperCase();
              if (code && seenCodes.has(code)) return false;
              const title = (p.title || '').trim().toLowerCase();
              if (title && seenTitles.has(title)) return false;
              if (code) seenCodes.add(code);
              if (title) seenTitles.add(title);
              return true;
            });

            // Build cards list markup applying cascade staggered delays
            let cardsHtml = '';
            uniqueRetryPosts.forEach((post) => {
              totalRenderedVideos++;
              cardsHtml += renderVideoCard(post, totalRenderedVideos - 1);
              if (totalRenderedVideos % 12 === 0) {
                cardsHtml += renderInlineAdCard(totalRenderedVideos);
              }
            });
            grid.innerHTML = cardsHtml;
            loadInlineGridAds();
            return;
          }
        }
      }

      const querySearch = currentFilters.search || '';
      ui.showEmpty(querySearch, grid);
      hasMore = false;
      return;
    }

    // Deduplikasi posts berdasarkan JAV code dan Title unik
    let uniquePosts = data.posts.filter(p => {
      const code = (p.code || '').trim().toUpperCase();
      if (code && seenCodes.has(code)) return false;
      const title = (p.title || '').trim().toLowerCase();
      if (title && seenTitles.has(title)) return false;
      if (code) seenCodes.add(code);
      if (title) seenTitles.add(title);
      return true;
    });

    // ── [ENGAGEMENT OPTIMIZATION] TRENDING INJECTION ──
    // Only apply trending logic on the absolute root homepage (no search, no category filters)
    // Extracting trending logic dynamically on the client prevents backend cache busting.
    const isRootHomepage = Object.keys(currentFilters).length === 0 && !randomMode;
    
    let trendingHtml = '';
    if (isInitial && isRootHomepage && uniquePosts.length >= 8) {
      // Score and sort posts by momentum
      uniquePosts = applyTrendingAlgorithm(uniquePosts);
      
      // Extract top 4 trending posts
      const trendingPosts = uniquePosts.splice(0, 4);
      
      trendingHtml += `
        <div class="trending-section">
          <div class="trending-header">
            <span class="trending-icon">🔥</span>
            <span>Trending Now</span>
          </div>
          <div class="trending-grid">
      `;
      trendingPosts.forEach((post) => {
        post._isTrending = true; 
        trendingHtml += renderVideoCard(post, 1);
      });
      trendingHtml += `
          </div>
        </div>
      `;
    }

    // Build cards list markup applying cascade staggered delays
    let cardsHtml = '';
    
    // Reshuffle the standard root feed slightly for liveliness 
    // so returning visitors see different mid-tier videos mixed in
    if (isRootHomepage) shuffleArray(uniquePosts);

    uniquePosts.forEach((post) => {
      post._isTrending = false;
      totalRenderedVideos++;
      cardsHtml += renderVideoCard(post, totalRenderedVideos - 1);
      if (totalRenderedVideos % 12 === 0) {
        cardsHtml += renderInlineAdCard(totalRenderedVideos);
      }
    });

    if (isInitial) {
      grid.innerHTML = trendingHtml + cardsHtml;
    } else {
      grid.insertAdjacentHTML('beforeend', cardsHtml);
    }

    loadInlineGridAds();

  } catch (error) {
    isLoading = false;
    if (error.message.includes('aborted')) return;
    
    console.error('Fetch Feed Error:', error);
    const grid = document.getElementById('video-grid');
    if (!grid) return;
    
    if (isInitial) {
      ui.showError(error.message, grid);
    } else {
      ui.showToast(i18n.t('error_load_more') || 'Gagal memuat. Menunggu sebentar...');
      // API Failure Backoff: If infinite scroll fails, disable it for 15 seconds 
      // to prevent users/bots from hammering the failing API by continuing to scroll
      scrollPenaltyUntil = Date.now() + 15000;
    }
  } finally {
    isLoading = false;
  }
}

/**
 * Attaches IntersectionObserver handlers pointing to scroll-sentinels below the grid
 */
function setupInfiniteScroll() {
  const sentinel = document.getElementById('scroll-sentinel');
  const loader = document.getElementById('infinite-loader');
  if (!sentinel) return;

  intersectionObserver = new IntersectionObserver(async (entries) => {
    const now = Date.now();
    
    // 1. Throttle: Max 1 scroll fetch per second to prevent flooding
    if (now - lastScrollTrigger < 1000) return;
    
    // 2. Penalty Backoff: Block scroll if we recently hit an API error
    if (now < scrollPenaltyUntil) return;
    
    if (entries[0].isIntersecting && !isLoading && hasMore) {
      lastScrollTrigger = now;
      if (loader) loader.classList.remove('hidden');
      
      if (randomMode && totalPages > 1) {
        // Pick a random unused page for infinite scroll
        const availablePages = [];
        for (let p = 1; p <= totalPages; p++) {
          if (!usedPages.has(p)) availablePages.push(p);
        }
        if (availablePages.length === 0) {
          hasMore = false;
          if (loader) loader.classList.add('hidden');
          return;
        }
        currentPage = availablePages[Math.floor(Math.random() * availablePages.length)];
      } else {
        currentPage++;
      }
      await fetchAndRenderFeed(false);
      
      if (loader) loader.classList.add('hidden');
    }
  }, {
    rootMargin: '300px'
  });

  intersectionObserver.observe(sentinel);
}

/**
 * Filter updates handler invoked by the horizontal filter bar engine
 */
async function updateFeedFilters(updatedFilters) {
  currentFilters = { ...currentFilters, ...updatedFilters };
  currentPage = 1;
  hasMore = true;
  // Disable random mode when user explicitly changes sort/filter — they want a specific order
  randomMode = false;
  usedPages = new Set();
  seenCodes = new Set();
  seenTitles = new Set();
  totalRenderedVideos = 0;

  const grid = document.getElementById('video-grid');
  if (grid) {
    ui.showSkeletonsInElement(grid, 8);
  }

  await fetchAndRenderFeed(true);
}

/**
 * Attaches click event delegations to video card grids
 */
function bindGridClicks(grid) {
  // Obsolete: Click interception is now natively and globally handled 
  // by the SPA anchor router in app.js because all cards/chips are semantic <a> tags.
  return;
}

// Hover live previews isolators variables
let activeHoverTimeout = null;
let activeCard = null;

/**
 * Clears active iframe previews and destroys dynamic DOM structures cleanly
 */
export function clearActivePreview() {
  if (activeHoverTimeout) {
    clearTimeout(activeHoverTimeout);
    activeHoverTimeout = null;
  }

  if (activeCard) {
    const thumb = activeCard.querySelector('.card-thumb');
    if (thumb) {
      const iframe = thumb.querySelector('.card-preview-iframe');
      if (iframe) iframe.remove();

      const loader = thumb.querySelector('.preview-loader');
      if (loader) loader.remove();
    }
    activeCard.classList.remove('hover-playing');
    activeCard = null;
  }
}

/**
 * Spawns dynamic iframe source triggers to execute muted visual playback on hovered cards
 */
function startLivePreview(card, embedUrl) {
  const thumb = card.querySelector('.card-thumb');
  if (!thumb) return;

  if (thumb.querySelector('.card-preview-iframe')) return;

  // Mount visual loader spinner
  const loader = document.createElement('div');
  loader.className = 'preview-loader';
  thumb.appendChild(loader);

  // Mount preview iframe elements
  const iframe = document.createElement('iframe');
  iframe.className = 'card-preview-iframe';
  
  // Inject autoplay and muted parameters to comply with standard browser media engagement bounds
  const previewUrl = embedUrl.includes('?') ? `${embedUrl}&autoplay=1&muted=1` : `${embedUrl}?autoplay=1&muted=1`;
  iframe.src = previewUrl;
  iframe.allow = 'autoplay; encrypted-media';
  iframe.setAttribute('scrolling', 'no');
  iframe.setAttribute('frameborder', '0');

  // Trigger loading complete transits
  iframe.addEventListener('load', () => {
    if (loader) loader.remove();
    iframe.classList.add('loaded');
    card.classList.add('hover-playing');
  });

  thumb.appendChild(iframe);
}

export function bindHoverPreviews(grid) {
  // Disabled as per user request to remove live video playback preview on hover
  return;
}

/**
 * Renders HTML markup placeholder for inline grid ad slot
 */
function renderInlineAdCard(adIndex) {
  return `
    <div class="grid-ad-container" style="grid-column: 1 / -1; display: flex; justify-content: center; width: 100%; margin: var(--space-6) 0;">
      <div class="ad-placement" id="grid-ad-slot-${adIndex}" style="min-height: 90px; background: rgba(0,0,0,0.2); border-radius: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; max-width: 100%;"></div>
    </div>
  `;
}

/**
 * Loads dynamic Adsterra/Exoclick banners into any empty inline grid ad slots currently in the DOM
 */
function loadInlineGridAds() {
  const slots = document.querySelectorAll('.grid-ad-container .ad-placement');
  slots.forEach(slot => {
    // Only load if the ad slot is empty
    if (slot.children.length === 0) {
      if (window.missavJAds && typeof window.missavJAds.loadAdBanner === 'function') {
        const cfg = window.missavJAdConfig;
        const isMobile = window.innerWidth < 768;
        const width = isMobile ? 320 : 728;
        const height = isMobile ? 50 : 90;
        const key = isMobile ? cfg.topMobileBannerKey : cfg.topBannerKey;
        
        window.missavJAds.loadAdBanner(slot.id, key, width, height);
      }
    }
  });
}

export default { init, renderVideoCard, bindHoverPreviews, clearActivePreview };
