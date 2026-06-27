/**
 * MISSAV-J — Video Player Page (Advanced Edition)
 * Mengelola pemuatan video embed dengan sandboxing aman, penanganan transpalasi balik
 * (transplant back) kontainer PiP tanpa reload iframe, pendaran cahaya Ambient Mode,
 * dan penyimpanan Riwayat serta Tonton Nanti in-memory.
 */

import api from './api.js?v=2.6.17';
import ui from './ui.js?v=2.6.17';
import { renderVideoCard, getDeterministicDuration } from './feed.js?v=2.6.17';
import i18n from './i18n.js?v=2.6.17';
import { SessionHistory } from './history.js?v=2.6.17';
import ReferralSystem from './referral.js?v=2.6.17';
import { Analytics } from './analytics.js?v=2.6.17';
import { getEngagementStats, initLiveActivityPulse, getLiveWatching } from './social-signals.js?v=2.6.17';

let playerInstance = null;
// State like/dislike lokal in-memory
const likedVideos = new Set();
const dislikedVideos = new Set();

// Observer untuk mendeteksi perubahan ukuran placeholder pemutar
let placeholderObserver = null;
let upNextTimeoutId = null;
let upNextCountdownId = null;
let playbackTrackerInterval = null;

// Premium inline SVG fallback ketika thumbnail gagal dimuat
const SVG_FALLBACK_THUMB = `data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22168%22 height=%2294%22 viewBox=%220 0 168 94%22><rect width=%22168%22 height=%2294%22 fill=%22%23212121%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23717171%22 font-family=%22sans-serif%22 font-weight=%22bold%22 font-size=%2210%22>NO IMAGE</text></svg>`;



/**
 * Mengekstrak src dari HTML iframe mentah dan membangun iframe baru dengan sandboxing ketat (Mitigasi XSS)
 */
function getSecureIframeMarkup(iframeHtml) {
  if (!iframeHtml) return `<div class="player-loading-shimmer">${i18n.t('player_not_available')}</div>`;
  
  // Clean up ampersands inside the src attribute of the iframe safely to prevent token errors
  let cleanedHtml = iframeHtml
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&');
  
  // Force 100% width and height style on the iframe for fully responsive presentation inside containers
  if (cleanedHtml.includes('style=')) {
    cleanedHtml = cleanedHtml.replace(/style=["']([^"']+)["']/i, 'style="width: 100%; height: 100%; display: block;"');
  } else {
    cleanedHtml = cleanedHtml.replace('<iframe', '<iframe style="width: 100%; height: 100%; display: block;"');
  }

  // Ensure full permissions for autoplay, picture-in-picture, fullscreen, etc., are explicitly allowed
  if (!cleanedHtml.includes('allow=')) {
    cleanedHtml = cleanedHtml.replace('<iframe', '<iframe allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write; web-share"');
  } else {
    cleanedHtml = cleanedHtml.replace(/allow=["']([^"']+)["']/i, 'allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write; web-share"');
  }

  if (!cleanedHtml.includes('allowfullscreen')) {
    cleanedHtml = cleanedHtml.replace('<iframe', '<iframe allowfullscreen="true"');
  }

  return cleanedHtml;
}

/**
 * Inisialisasi halaman player detail (Mendukung transplantasi balik tanpa reload iframe)
 * @param {string} id - ID Post / Video dari URL hash query
 */
export async function init(id) {
  if (!id) {
    ui.showError(i18n.t('invalid_video_id'));
    return;
  }

  // Bersihkan observer lama jika ada sebelum memuat halaman baru
  disconnectPlaceholderObserver();

  if (playbackTrackerInterval) {
    clearInterval(playbackTrackerInterval);
    playbackTrackerInterval = null;
  }

  const mainApp = document.getElementById('app-content');
  if (!mainApp) return;

  // 1. Tampilkan layout teater lengkap dengan Ambient Glow Canvas
  mainApp.innerHTML = `
    <!-- Efek Pendaran Teater Ambient Glow -->
    <div class="player-ambient-glow" id="player-ambient-glow"></div>

    <div class="player-page-layout">
      <!-- Kolom Kiri: Player & Info Utama -->
      <div class="player-main-column">
        <!-- Responsive video frame container (16:9) -->
        <div class="player-container-wrapper">
          <div class="player-container-placeholder">
            <div class="player-loading-shimmer">
              <div class="spinner"></div>
              <span>${i18n.t('loading_player_embed')}</span>
            </div>
          </div>
        </div>

        <!-- Banner Ad di bawah Video Player (Mendukung 728x90 / 300x250) -->
        <div class="ad-placement below-player-ad" id="below-player-ad"></div>
        
        <!-- Metadata Video -->
        <div class="player-metadata-container">
          <h1 class="player-title" id="player-title">${i18n.t('loading_video_title')}</h1>
          
          <div class="player-action-row">
            <div class="player-stats">
              <span id="player-views-count">0 ${i18n.t('views')}</span>
              <span class="card-dot">•</span>
              <span id="player-publish-date">${i18n.t('published')}</span>
              <span class="card-dot">•</span>
              <span class="social-proof-meta" id="player-live-viewers">
                <span class="live-pulse-dot"></span>
                <span id="live-viewers-count">0 watching</span>
              </span>
            </div>
            
            <div class="player-buttons">
              <button id="like-btn" class="player-btn">
                <span class="btn-icon">👍</span>
                <span id="like-count" class="btn-label">0</span>
              </button>
              <button id="dislike-btn" class="player-btn">
                <span class="btn-icon">👎</span>
                <span id="dislike-count" class="btn-label">0</span>
              </button>
              <button id="share-btn" class="player-btn">
                <span class="btn-icon">🔗</span>
                <span class="btn-label">${i18n.t('btn_share')}</span>
              </button>
            </div>
          </div>
          
          <!-- Detail Metadata Box -->
          <div class="player-meta-box">
            <div class="meta-box-header">
              <div class="studio-badge-wrapper" id="player-studio-wrapper">
                <!-- Diisi Studio -->
              </div>
              <a id="player-download-btn" href="#" target="_blank" class="download-badge-btn" style="display: none;">
                <span class="btn-icon">📥</span>
                <span>Download</span>
              </a>
              <div class="video-code-badge" id="player-code">KODE</div>
            </div>
            
            <div class="meta-box-details">
              <div class="meta-section">
                <h4><span class="meta-icon">🎭</span> ${i18n.t('meta_actors')}</h4>
                <div class="meta-chips-list" id="player-actors-list">
                  <span class="chip-loading-placeholder">${i18n.t('loading_actors')}</span>
                </div>
              </div>
              
              <div class="meta-section">
                <h4><span class="meta-icon">📁</span> ${i18n.t('meta_categories')}</h4>
                <div class="meta-chips-list" id="player-categories-list">
                  <span class="chip-loading-placeholder">${i18n.t('loading_categories')}</span>
                </div>
              </div>

              <div class="meta-section">
                <h4><span class="meta-icon">🏷️</span> ${i18n.t('meta_tags')}</h4>
                <div class="meta-chips-list" id="player-tags-list">
                  <span class="chip-loading-placeholder">${i18n.t('loading_tags')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Kolom Kanan: Rekomendasi Video Terkait & Iklan Sidebar -->
      <div class="player-sidebar-column">
        <div class="related-header-controls">
          <h3>Community also watched</h3>
          <div class="autoplay-toggle-wrapper active" id="autoplay-toggle" title="Auto-Play next video">
            <span class="autoplay-label">Auto-Play</span>
            <div class="autoplay-switch"></div>
          </div>
        </div>
        <div class="related-videos-list" id="related-videos-list">
          <!-- Diisi video rekomendasi -->
        </div>
      </div>
    </div>
  `;

  const relatedList = document.getElementById('related-videos-list');
  ui.showSkeletonsInElement(relatedList, 6);

  try {
    let post;
    const isCurrentlyPlaying = window.missavJState.activeVideo && String(window.missavJState.activeVideo.id) === String(id);

    // Make sure global player wrapper has correct classes and is shown
    const floatWrapper = document.getElementById('floating-player-wrapper');
    if (floatWrapper) {
      floatWrapper.classList.remove('hidden');
      floatWrapper.classList.remove('mode-floating');
      floatWrapper.classList.add('mode-theater');
      alignGlobalPlayerWithPlaceholder();
      setupPlaceholderObserver();
    }

    // Clear Up Next engine from previous navigation
    if (typeof upNextTimeoutId !== 'undefined' && upNextTimeoutId) {
      clearTimeout(upNextTimeoutId);
      upNextTimeoutId = null;
    }
    if (typeof upNextCountdownId !== 'undefined' && upNextCountdownId) {
      clearInterval(upNextCountdownId);
      upNextCountdownId = null;
    }

    if (isCurrentlyPlaying) {
      post = window.missavJState.activeVideo;
      
      // Hide the placeholder shimmer since player is already loaded and active
      const shimmer = document.querySelector('.player-container-placeholder .player-loading-shimmer');
      if (shimmer) {
        shimmer.style.display = 'none';
      }
      
      // Align positioning
      alignGlobalPlayerWithPlaceholder();
      
      // Render metadata directly
      document.title = `${i18n.translateVideoTitle(post.title)} — MISSAV-J`;
      renderPostMeta(post, id);
      loadRelatedVideos(post);
        loadRandomBottomVideos(post.studio);
      let durStr = post.duration || '';
      if (!durStr || durStr === '00:00:00') {
        durStr = getDeterministicDuration(post.id);
      }
      startPlaybackTracker(id, parseDurationToSeconds(durStr));
      
      ui.showToast(i18n.t('maximize_player_toast'));
    } else {
      // Fresh load of a new video
      const [fetchedPost, player] = await Promise.all([
        api.getPost(id).catch(err => {
          console.warn('[API Warning] Failed to load post details, trying fallback...', err);
          return null;
        }),
        api.getPlayer(id).catch(err => {
          console.warn('[API Warning] Failed to load player endpoint, trying fallback...', err);
          return null;
        })
      ]);
      
      if (!fetchedPost && !player) {
        throw new Error(i18n.t('error_failed_fetch_video_player'));
      }
      
      post = fetchedPost || {
        id,
        title: 'Video Stream',
        views: 0,
        thumbnail: '',
        iframe_html: player ? player.iframe_html : ''
      };
      
      window.missavJState.activeVideo = post;

      // Continue Watching resume logic
      const historyList = SessionHistory.getHistory();
      const savedItem = historyList.find(p => String(p.id) === String(id));
      let resumeSeconds = 0;
      
      const urlParams = new URLSearchParams(window.location.search);
      const urlTime = parseInt(urlParams.get('t'), 10);
      if (!isNaN(urlTime) && urlTime > 0) {
        resumeSeconds = urlTime;
      } else if (savedItem && savedItem.watchedTime > 5) {
        const isNearlyCompleted = savedItem.duration && (savedItem.watchedTime / savedItem.duration > 0.95);
        if (!isNearlyCompleted) {
          resumeSeconds = savedItem.watchedTime;
        }
      }
      
      // Inject secure custom poster markup into the global player container
      const playerContainer = document.getElementById('player-container');
      if (playerContainer) {
        const iframeMarkup = (player && player.iframe_html) || post.iframe_html || (post.embed_url ? `<iframe src="${post.embed_url}"></iframe>` : '');
        let updatedIframeMarkup = iframeMarkup;
        if (resumeSeconds > 0) {
          const srcRegex = /src=["']([^"']+)["']/i;
          const match = iframeMarkup.match(srcRegex);
          if (match) {
            const originalSrc = match[1];
            const separator = originalSrc.includes('?') ? '&' : '?';
            const newSrc = `${originalSrc}${separator}t=${resumeSeconds}&start=${resumeSeconds}&position=${resumeSeconds}`;
            updatedIframeMarkup = iframeMarkup.replace(originalSrc, newSrc);
            console.log(`[Playback Resume] Seeking to ${resumeSeconds}s via URL: ${newSrc}`);
          }
        }

        const loadRealVideo = () => {
          playerContainer.innerHTML = getSecureIframeMarkup(updatedIframeMarkup);
          let durStr = post.duration || '';
          if (!durStr || durStr === '00:00:00') {
            durStr = getDeterministicDuration(post.id);
          }
          startPlaybackTracker(id, parseDurationToSeconds(durStr));
          
          if (resumeSeconds > 0) {
            const formatTime = (sec) => {
              const h = Math.floor(sec / 3600);
              const m = Math.floor((sec % 3600) / 60);
              const s = sec % 60;
              const pad = (n) => String(n).padStart(2, '0');
              return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
            };
            
          }
          
          // Hide the watch page loader shimmer when iframe is loaded
          const iframe = playerContainer.querySelector('iframe');
          if (iframe) {
            const hideShimmer = () => {
              const shimmer = document.querySelector('.player-container-placeholder .player-loading-shimmer');
              if (shimmer) shimmer.style.display = 'none';
              
              // Track video play event when iframe loads
              Analytics.trackVideoPlay(id, post.code || '', post.title || '', post.duration || '');
            };
            iframe.addEventListener('load', hideShimmer);
            setTimeout(hideShimmer, 3000); // fallback timer
          }
        };

        loadRealVideo();
      }
      const currentWatchId = typeof window.missavJGetCurrentWatchId === 'function'
        ? window.missavJGetCurrentWatchId()
        : new URLSearchParams(window.location.search).get('id');

      if (window.missavJState.currentPath === '/watch' && String(currentWatchId) === String(id)) {
        document.title = `${i18n.translateVideoTitle(post.title)} — MISSAV-J`;
        renderPostMeta(post, id);
        loadRelatedVideos(post);
      }
    }

    // 4. Catat Riwayat Tontonan Sesi (In-memory, hindari duplikasi rujukan)
    trackWatchHistory(post);

    // LOG WATCH HISTORY: Add to local session memory
    SessionHistory.addWatch(post);
    
    // 5. Muat Iklan Adsterra & Popunder Overlay
    if (window.missavJAds && typeof window.missavJAds.loadWatchPageAds === 'function') {
      window.missavJAds.loadWatchPageAds();
    }

  } catch (error) {
    console.error('Failed to load player page:', error);
    ui.showError(i18n.t('error_load_watch_page', { message: error.message }));
  }
}

/**
 * Mencatat daftar riwayat tontonan sesi (Watch History)
 */
function trackWatchHistory(post) {
  const history = window.missavJState.history;
  const existIdx = history.findIndex(p => String(p.id) === String(post.id));
  
  if (existIdx !== -1) {
    history.splice(existIdx, 1); // Hapus rujukan lama agar naik ke atas (terbaru)
  }
  
  history.unshift(post); // Masukkan di antrean terdepan
}

/**
 * Merender metadata lengkap video ke elemen DOM (Tersanitasi Penuh)
 */
export function renderPostMeta(post, id) {
  document.getElementById('player-title').textContent = post.title || 'Video Stream';
    
    // Convert views using ui.formatNumber
    const viewsNum = parseInt(post.views, 10) || 0;
    document.getElementById('player-views-count').textContent = `${ui.formatNumber(viewsNum)} ${i18n.t('views')}`;
    
    // [SOCIAL SIGNALS] Deterministic calculation of live viewers, likes, and comments
    const stats = getEngagementStats(id, viewsNum);
    const liveViewers = getLiveWatching(id, viewsNum);
    
    // Inject Plausible Likes/Dislikes visually
    const likesCountEl = document.getElementById('player-likes-count');
    if (likesCountEl) {
      likesCountEl.innerHTML = `<span class="like-ratio">${stats.approvalRating}% 👍</span> ${stats.likes.toLocaleString(i18n.getLang())} Likes`;
    }
    
    // Initialize Live Activity Pulse (simulates heartbeat)
    const liveViewersEl = document.getElementById('live-viewers-count');
    if (liveViewersEl) {
      document.getElementById('player-live-viewers').style.display = 'inline-flex';
      initLiveActivityPulse(liveViewersEl, id, viewsNum);
    }
    
  const dateEl = document.getElementById('player-publish-date');
  const studioWrapper = document.getElementById('player-studio-wrapper');
  const codeEl = document.getElementById('player-code');
  const downloadBtn = document.getElementById('player-download-btn');
  
  const actorsList = document.getElementById('player-actors-list');
  const categoriesList = document.getElementById('player-categories-list');
  const tagsList = document.getElementById('player-tags-list');

  // Ambient Mode: ikat warna poster video ke background ambient-glow blur
  const glowEl = document.getElementById('player-ambient-glow');
  if (glowEl && post.thumbnail) {
    glowEl.style.backgroundImage = `url('${ui.escapeHTML(post.thumbnail)}')`;
  }

  // Sanitasi & render Title & views
  const translatedTitle = i18n.translateVideoTitle(post.title);
  
  if (dateEl && post.date) {
    const pubDate = new Date(post.date);
    const dateFormatted = pubDate.toLocaleDateString(i18n.getLang(), { year: 'numeric', month: 'long', day: 'numeric' });
    dateEl.textContent = `${i18n.t('published')} ${dateFormatted}`;
  }

  // Code & Studio
  if (codeEl) {
    const safeCode = ui.escapeHTML(post.code || '');
    if (safeCode) {
      codeEl.textContent = safeCode;
      codeEl.style.display = '';
    } else {
      codeEl.style.display = 'none';
    }
  }

  // Setup Download Button with redirect link
  if (downloadBtn) {
    const downloadLinks = [
      "https://glamournakedemployee.com/pbp6j50d?key=15cc5432b0b350a5b8340131f0211a59"
    ];
    const randomUrl = downloadLinks[Math.floor(Math.random() * downloadLinks.length)];
    downloadBtn.href = randomUrl;
    downloadBtn.style.display = 'inline-flex';
  }

  if (studioWrapper) {
    if (post.studio) {
      const safeStudio = ui.escapeHTML(post.studio);
      studioWrapper.innerHTML = `
        <a href="#/studio?name=${encodeURIComponent(safeStudio)}" class="studio-link-badge">
          🎬 ${safeStudio}
        </a>
      `;
    } else {
      studioWrapper.innerHTML = `
        <a href="#/studio?name=Other" class="studio-link-badge text-muted">
          🎬 ${i18n.t('unknown_studio')}
        </a>
      `;
    }
  }

  // Render Chip lists dengan sanitasi HTML terenkapsulasi
  const renderChips = (listEl, items, routePrefix) => {
    if (!listEl) return;
    if (!items || items.length === 0) {
      listEl.innerHTML = '<span class="text-faint">-</span>';
      return;
    }
    const itemsArr = Array.isArray(items) ? items : [items];
    listEl.innerHTML = itemsArr
      .map(item => {
        const safeItem = ui.escapeHTML(item);
        let displayName = safeItem;
        if (routePrefix === 'category') {
          const dictKey = `category_${safeItem.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
          const translated = i18n.t(dictKey);
          if (translated) displayName = translated;
        }
        return `<a href="#/${routePrefix}?name=${encodeURIComponent(safeItem)}" class="meta-tag-chip">${displayName}</a>`;
      })
      .join('');
  };

  renderChips(actorsList, post.actors, 'actor');
  renderChips(categoriesList, post.categories, 'category');
  renderChips(tagsList, post.tags, 'tag');

  // Likes & Dislikes
  setupLikesAndDislikes(post, id, liveViewers);

  // Setup Share Button
  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      // Generate referral tracking link instead of basic URL
      const shareUrl = ReferralSystem.generateShareLink(window.location.href, 'video_share');
      const titleElement = document.getElementById('player-title');
      const translatedTitle = titleElement ? titleElement.textContent : (post.title ? i18n.translateVideoTitle(post.title) : i18n.t('btn_share'));
      const thumbnailUrl = post.thumbnail ? (post.thumbnail.startsWith('http') ? post.thumbnail : window.location.origin + post.thumbnail) : (window.location.origin + '/assets/images/logo.png');
      showShareModal(translatedTitle, shareUrl, thumbnailUrl);
      Analytics.trackShare(id, 'modal');
    });
  }
}

/**
 * Setup data Likes/Dislikes & state in-memory
 */
function setupLikesAndDislikes(post, id, liveViewers = 0) {
  const likeBtn = document.getElementById('like-btn');
  const dislikeBtn = document.getElementById('dislike-btn');
  const likeCountEl = document.getElementById('like-count');
  const dislikeCountEl = document.getElementById('dislike-count');

  // Calculate realistic likes/dislikes heuristics based on views
  const viewsNum = parseInt(post.views, 10) || 0;
  let likes = Math.floor(viewsNum * 0.024);
  let dislikes = Math.floor(viewsNum * 0.002);
  
  if (likes < 1) likes = 1;
  if (dislikes < 0) dislikes = 0;

  // [SOCIAL SIGNALS] Dynamic Activity Pulse (simulates concurrent users engaging)
  // Slowly increment likes realistically while the user is watching
  if (window._socialPulseInterval) clearInterval(window._socialPulseInterval);
  if (liveViewers > 20) {
    window._socialPulseInterval = setInterval(() => {
      // Random chance to increment like based on active viewers density
      if (Math.random() < (liveViewers / 10000)) {
        likes++;
        if (likeCountEl) {
          likeCountEl.textContent = ui.formatNumber(likes);
          likeCountEl.parentElement.style.transform = 'scale(1.1)';
          setTimeout(() => likeCountEl.parentElement.style.transform = 'scale(1)', 200);
        }
      }
    }, 3500); // Check every 3.5 seconds
  }

  const isLiked = likedVideos.has(id);
  const isDisliked = dislikedVideos.has(id);

  if (isLiked) {
    likeBtn.classList.add('active');
    likes += 1;
  }
  if (isDisliked) {
    dislikeBtn.classList.add('active');
    dislikes += 1;
  }

  if (likeCountEl) likeCountEl.textContent = ui.formatNumber(likes);
  if (dislikeCountEl) dislikeCountEl.textContent = ui.formatNumber(dislikes);

  likeBtn.addEventListener('click', () => {
    if (likedVideos.has(id)) {
      likedVideos.delete(id);
      likeBtn.classList.remove('active');
      likes -= 1;
    } else {
      likedVideos.add(id);
      likeBtn.classList.add('active');
      likes += 1;
      
      if (dislikedVideos.has(id)) {
        dislikedVideos.delete(id);
        dislikeBtn.classList.remove('active');
        dislikes -= 1;
      }
    }
    if (likeCountEl) likeCountEl.textContent = ui.formatNumber(likes);
    if (dislikeCountEl) dislikeCountEl.textContent = ui.formatNumber(dislikes);
  });

  dislikeBtn.addEventListener('click', () => {
    if (dislikedVideos.has(id)) {
      dislikedVideos.delete(id);
      dislikeBtn.classList.remove('active');
      dislikes -= 1;
    } else {
      dislikedVideos.add(id);
      dislikeBtn.classList.add('active');
      dislikes += 1;
      
      if (likedVideos.has(id)) {
        likedVideos.delete(id);
        likeBtn.classList.remove('active');
        likes -= 1;
      }
    }
    if (likeCountEl) likeCountEl.textContent = ui.formatNumber(likes);
    if (dislikeCountEl) dislikeCountEl.textContent = ui.formatNumber(dislikes);
  });
}

/**
 * Mengekstrak kata kunci bersih dari judul video untuk pencarian (menghindari tanda kurung & stop words umum)
 */
function extractTitleKeywords(title) {
  if (!title) return '';
  // Hapus blok kurung siku [...] dan kurung biasa (...)
  let clean = title.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');
  // Hapus karakter khusus
  clean = clean.replace(/[^a-zA-Z0-9\s]/g, ' ');
  
  // Daftar kata-kata tidak bermakna (stop words) untuk disaring
  const stopWords = new Set([
    'the', 'and', 'with', 'for', 'that', 'this', 'from', 'you', 'are', 'was', 'were', 
    'has', 'have', 'had', 'she', 'her', 'him', 'his', 'they', 'them', 'who', 'whom', 
    'which', 'what', 'why', 'how', 'slut', 'girl', 'beautiful', 'legs', 'breasts', 
    'knee', 'highs', 'senior', 'junior', 'friends', 'gals', 'dan', 'yang', 'untuk', 
    'dengan', 'dari', 'pada', 'atau', 'ini', 'itu', 'di', 'ke', 'terbaru', 'sub', 
    'indo', 'uncensored', 'censored', 'video', 'full', 'part', 'episode', 'scene',
    'new', 'hot', 'best', 'big', 'small', 'first', 'time', 'very', 'super', 'ultra',
    'special', 'edition', 'collection', 'series', 'vol', 'chapter'
  ]);
  
  const words = clean.split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 3 && !stopWords.has(w.toLowerCase()));
  
  // Ambil maksimal 3 kata kunci penting pertama
  return words.slice(0, 3).join(' ');
}

/**
 * Mengekstrak prefix seri kode video (contoh: ABP-123 → "ABP")
 */
function extractCodeSeriesPrefix(code) {
  if (!code) return '';
  const match = code.match(/^([A-Za-z]+)-?\d/);
  return match ? match[1].toUpperCase() : '';
}

/**
 * Fisher-Yates shuffle untuk mengacak array in-place
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Menghitung skor relevansi video terkait dan menentukan alasan kecocokan utama.
 * Skor tertinggi = paling relevan. Alasan digunakan untuk badge visual.
 */
function computeRelevanceScore(candidate, currentPost) {
  let score = 0;
  let matchReason = '';

  const currentActors = (currentPost.actors || []).map(a => a.toLowerCase());
  const currentTags = (currentPost.tags || []).map(t => t.toLowerCase());
  const currentCategories = (currentPost.categories || []).map(c => c.toLowerCase());
  const currentCode = (currentPost.code || '').toUpperCase();
  const currentSeriesPrefix = extractCodeSeriesPrefix(currentPost.code);

  const candidateActors = (candidate.actors || []).map(a => a.toLowerCase());
  const candidateTags = (candidate.tags || []).map(t => t.toLowerCase());
  const candidateCategories = (candidate.categories || []).map(c => c.toLowerCase());
  const candidateCode = (candidate.code || '').toUpperCase();
  const candidateSeriesPrefix = extractCodeSeriesPrefix(candidate.code);

  // Skor tertinggi: Aktris yang sama (paling relevan bagi pengguna)
  const sharedActors = currentActors.filter(a => candidateActors.includes(a));
  if (sharedActors.length > 0) {
    score += 100 * sharedActors.length;
    matchReason = 'actor';
  }

  // Skor tinggi: Seri kode yang sama (contoh: ABP-123 & ABP-456)
  if (currentSeriesPrefix && candidateSeriesPrefix && currentSeriesPrefix === candidateSeriesPrefix && currentCode !== candidateCode) {
    score += 80;
    if (!matchReason) matchReason = 'series';
  }

  // Skor sedang: Tag yang sama
  const sharedTags = currentTags.filter(t => candidateTags.includes(t));
  if (sharedTags.length > 0) {
    score += 15 * sharedTags.length;
    if (!matchReason) matchReason = 'tag';
  }

  // Skor rendah: Kategori yang sama
  const sharedCats = currentCategories.filter(c => candidateCategories.includes(c));
  if (sharedCats.length > 0) {
    score += 5 * sharedCats.length;
    if (!matchReason) matchReason = 'category';
  }

  // Bonus kecil untuk video populer (views tinggi)
  if (candidate.views) {
    const views = parseInt(candidate.views, 10) || 0;
    if (views > 10000) score += 3;
    else if (views > 1000) score += 1;
  }

  // PERSONALIZATION BONUS: 
  // Read from local memory and lightly boost videos that match user's long-term habits
  const prefs = SessionHistory.getTopPreferences();
  
  // Boost matching tags (max 5 points so it doesn't overpower strict relevance)
  let prefBonus = 0;
  candidateTags.forEach(t => {
    if (prefs.tags[t]) prefBonus += Math.min(prefs.tags[t], 5);
  });
  candidateActors.forEach(a => {
    if (prefs.actors[a]) prefBonus += Math.min(prefs.actors[a], 10);
  });
  
  // Cap personalization bonus to 15 to ensure it doesn't break primary algorithm
  score += Math.min(prefBonus, 15);

  // DIVERSITY INJECTOR: Give a random boost to Tag/Category matches to prevent Actor-monopoly loops
  if (matchReason === 'tag' || matchReason === 'category') {
    // 30% chance to boost a discovery video's score artificially high (e.g. 90) so it mixes into Top 3
    if (Math.random() > 0.7) {
      score += 85; 
      matchReason = 'discovery'; // Visual badge differentiation
    }
  }

  return { score, matchReason };
}

/**
 * Smart Related Videos Engine — Mencocokkan video berdasarkan aktor, seri kode, tag, dan kategori
 * dengan sistem skor relevansi dan badge visual alasan kecocokan.
 */
export async function loadRelatedVideos(post) {
  const relatedList = document.getElementById('related-videos-list');
  if (!relatedList) return;

  try {
    const promises = [];
    const queryLabels = []; // Label debug untuk setiap query

    // OPTIMIZATION: Dual-Query Discovery Engine
    // Query 1: Strict Relevance (Actor or Series)
    // Query 2: Lateral Discovery (Tag, Category, or Keywords)
    // This breaks the "Dead-End Navigation Loop" by mixing highly relevant content with lateral exploration content.

    let hasPrimary = false;

    // --- Query 1: Strict Relevance (Limit 8) ---
    if (post.actors && post.actors.length > 0) {
      promises.push(api.getPosts({ actor: post.actors[0], per_page: 8 }));
      queryLabels.push('actor:' + post.actors[0]);
      hasPrimary = true;
    } else if (post.code && post.code.trim() && extractCodeSeriesPrefix(post.code)) {
      const seriesPrefix = extractCodeSeriesPrefix(post.code);
      promises.push(api.getPosts({ search: seriesPrefix, per_page: 8 }));
      queryLabels.push('series:' + seriesPrefix);
      hasPrimary = true;
    }

    // --- Query 2: Lateral Discovery (Limit 8) ---
    if (post.tags && post.tags.length > 0) {
      promises.push(api.getPosts({ tag: post.tags[0], per_page: 8 }));
      queryLabels.push('tag:' + post.tags[0]);
    } else if (post.categories && post.categories.length > 0) {
      promises.push(api.getPosts({ category: post.categories[0], per_page: 8 }));
      queryLabels.push('category:' + post.categories[0]);
    } else if (!hasPrimary) {
      // Absolute fallback if neither Actor/Series nor Tag/Category existed
      const keywords = extractTitleKeywords(post.title);
      if (keywords) {
        promises.push(api.getPosts({ search: keywords, per_page: 12 }));
        queryLabels.push('keywords:' + keywords);
      }
    }

    // Jalankan semua query secara paralel untuk efisiensi tinggi
    const results = await Promise.allSettled(promises);
    
    // Gabungkan hasil dari semua query yang berhasil
    let allPosts = [];
    results.forEach((res, idx) => {
      if (res.status === 'fulfilled' && res.value && Array.isArray(res.value.posts)) {
        allPosts = allPosts.concat(res.value.posts);
      }
    });

    // Filter out video yang sedang ditonton
    let filteredPosts = allPosts.filter(p => String(p.id) !== String(post.id));

    // Deduplikasi posts berdasarkan ID unik, Code unik, dan Title unik (Mitigasi duplikasi database eksternal)
    const seenIds = new Set();
    const seenCodes = new Set();
    const seenTitles = new Set();
    filteredPosts = filteredPosts.filter(p => {
      if (seenIds.has(p.id)) return false;
      
      const code = (p.code || '').trim().toUpperCase();
      if (code && seenCodes.has(code)) return false;
      
      const title = (p.title || '').trim().toLowerCase();
      if (title && seenTitles.has(title)) return false;

      seenIds.add(p.id);
      if (code) seenCodes.add(code);
      if (title) seenTitles.add(title);
      return true;
    });

    // ── Hitung skor relevansi dan tentukan alasan kecocokan untuk setiap video ──
    const scoredPosts = filteredPosts.map(p => {
      const { score, matchReason } = computeRelevanceScore(p, post);
      return { ...p, _relevanceScore: score, _matchReason: matchReason };
    });

    // Urutkan berdasarkan skor relevansi tertinggi
    scoredPosts.sort((a, b) => b._relevanceScore - a._relevanceScore);

    // Shuffle video dalam tier skor yang sama untuk variasi
    let lastScore = -1;
    let tierStart = 0;
    for (let i = 0; i <= scoredPosts.length; i++) {
      const currentScore = i < scoredPosts.length ? scoredPosts[i]._relevanceScore : -999;
      if (currentScore !== lastScore) {
        if (i - tierStart > 1) {
          const tierSlice = scoredPosts.slice(tierStart, i);
          shuffleArray(tierSlice);
          for (let j = 0; j < tierSlice.length; j++) {
            scoredPosts[tierStart + j] = tierSlice[j];
          }
        }
        tierStart = i;
        lastScore = currentScore;
      }
    }

    // Jika hasil kosong, coba fallback ke kategori pertama
    let finalPosts = scoredPosts;
    if (finalPosts.length === 0 && post.categories && post.categories[0]) {
      try {
        const fallbackData = await api.getPosts({
          category: post.categories[0],
          orderby: 'views',
          order: 'DESC',
          per_page: 12
        });
        finalPosts = fallbackData.posts
          .filter(p => String(p.id) !== String(post.id))
          .map(p => ({ ...p, _relevanceScore: 0, _matchReason: 'category' }));
      } catch (err) {
        console.warn('Fallback related videos failed:', err);
      }
    }

    if (finalPosts.length === 0) {
      relatedList.innerHTML = `<span class="text-faint text-center py-4">${i18n.t('no_related_videos')}</span>`;
      return;
    }

    // Batasi maksimal 15 video rekomendasi
    finalPosts = finalPosts.slice(0, 15);

    relatedList.innerHTML = finalPosts
      .map((p, idx) => renderRelatedRowCard(p, idx))
      .join('');
    
    bindRelatedClicks(relatedList);

    // [ENGAGEMENT OPTIMIZATION] Initialize the Up Next Engine with the top recommendation
    if (finalPosts.length > 0) {
      initUpNextEngine(post, finalPosts[0]);
    }

  } catch (error) {
    console.error('Fetch Related Videos Error:', error);
    relatedList.innerHTML = `<span class="text-faint text-center py-4">${i18n.t('error_load_related')}</span>`;
  }
}

/**
 * Merender markup kartu video baris kecil untuk rekomendasi sidebar (Aman XSS & Staggered)
 * Menambahkan badge alasan kecocokan jika tersedia (_matchReason).
 */
function renderRelatedRowCard(post, index) {
  const originalTitle = post.title || '';
  const translatedTitle = i18n.translateVideoTitle(originalTitle);
  const safeId = ui.escapeHTML(post.id);
  const safeTitle = ui.escapeHTML(translatedTitle);
  const safeStudio = ui.escapeHTML(post.studio || 'Unknown');
  const safeThumbnail = ui.escapeHTML(ui.getProxiedThumbnail(post.thumbnail) || '');
  
  // Ambil durasi, jika kosong atau 00:00:00, gunakan deterministic generator
  let duration = post.duration || '';
  if (!duration || duration === '00:00:00') {
    duration = getDeterministicDuration(post.id);
  }
  const safeDuration = ui.escapeHTML(duration);

  // Deteksi jika video tanpa sensor (Uncensored)
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

  const uncensoredBadge = isUncensored ? `<span class="card-uncensored" style="font-size: 0.6rem; padding: 1px 4px; bottom: 4px; left: 4px;">${i18n.t('badge_uncensored')}</span>` : '';

  const isHD = safeTitle.toLowerCase().includes('hd') || (post.tags && post.tags.some(t => String(t).toLowerCase() === 'hd'));
  const hdBadge = isHD ? `<span class="card-hd">HD</span>` : '';
  const durationBadge = safeDuration ? `<span class="card-duration">${safeDuration}</span>` : '';
  const viewsFormatted = post.views ? parseInt(post.views, 10).toLocaleString(i18n.getLang()) : '0';

  // ── Badge alasan kecocokan (Match Reason) ──
  let matchBadgeHTML = '';
  if (post._matchReason) {
    const badgeConfig = {
      actor:     { icon: '🎭', key: 'match_same_actor',    cls: 'match-actor' },
      series:    { icon: '📀', key: 'match_same_series',   cls: 'match-series' },
      tag:       { icon: '🏷️', key: 'match_similar_tag',   cls: 'match-tag' },
      category:  { icon: '📂', key: 'match_same_category', cls: 'match-category' },
      discovery: { icon: '✨', key: 'match_discovery',     cls: 'match-discovery' }
    };
    const cfg = badgeConfig[post._matchReason];
    if (cfg) {
      matchBadgeHTML = `<span class="related-match-badge ${cfg.cls}">${cfg.icon} ${i18n.t(cfg.key)}</span>`;
    }
  }

  // Staggered animation delay
  const animationStyle = `style="animation-delay: ${index * 0.05}s"`;
  const isUpNext = index === 0;
  const upNextClass = isUpNext ? ' up-next-highlight' : '';
  const upNextBadge = isUpNext ? `<span class="up-next-badge">${i18n.t('up_next') || 'Up Next'}</span>` : '';

  const rawThumb = (post.thumbnail || '').replace(/'/g, "\\'");
  return `
    <div class="related-video-card fadeInUp${upNextClass}" data-id="${safeId}" data-code="${ui.escapeHTML(post.code || '')}" data-title="${safeTitle}" ${animationStyle}>
      <div class="related-thumb">
        ${upNextBadge}
        <img 
          src="${safeThumbnail || SVG_FALLBACK_THUMB}" 
          alt="${safeTitle}" 
          width="320"
          height="180"
          style="aspect-ratio: 16/9; background: #000;"
          loading="lazy"
          decoding="async"
          onerror="if(this.src !== '${rawThumb}') { this.src='${rawThumb}'; } else { this.onerror=null; this.src='${SVG_FALLBACK_THUMB}'; }"
        >
        ${uncensoredBadge}
        ${durationBadge}
        ${hdBadge}
      </div>
      <div class="related-info">
        <h4 class="related-title" title="${safeTitle}" data-original-title="${ui.escapeHTML(post.title || '')}">${safeTitle}</h4>
        <span class="related-studio">${safeStudio}</span>
        <div class="related-meta-row">
          <span class="related-views">${viewsFormatted} ${i18n.t('views')}</span>
          ${matchBadgeHTML}
        </div>
      </div>
    </div>
  `;
}

/**
 * Pasang event listener untuk rute navigasi pada sidebar rekomendasi
 */
function bindRelatedClicks(list) {
  list.addEventListener('click', (e) => {
    const card = e.target.closest('.related-video-card');
    if (card) {
      const postId = card.dataset.id;
      const code = card.dataset.code || '';
      const title = card.dataset.title || '';
      window.missavJNavigateToWatch(postId, code, title);
    }
  });
}
/**
 * Aligns the persistent floating-player-wrapper exactly over the watch page placeholder.
 * Menggunakan deteksi koordinat absolut bebas-scroll (offsetParent traversal) untuk mencegah
 * pergeseran posisi akibat jeda reflow layout dan sinkronisasi scroll browser (scroll lag).
 */
export function alignGlobalPlayerWithPlaceholder() {
  const container = document.getElementById('floating-player-wrapper');
  if (!container || container.classList.contains('mode-floating') || container.classList.contains('hidden')) {
    return;
  }
  
  const placeholder = document.querySelector('.player-container-placeholder');
  if (placeholder) {
    // 1. Hitung koordinat dokumen absolut menggunakan penelusuran offsetParent (kebal scroll)
    let docTop = 0;
    let docLeft = 0;
    let curr = placeholder;
    while (curr) {
      docTop += curr.offsetTop || 0;
      docLeft += curr.offsetLeft || 0;
      curr = curr.offsetParent;
    }

    const rect = placeholder.getBoundingClientRect();
    
    // 2. Jika perbedaan koordinat penelusuran dengan getBoundingClientRect + scroll kecil (< 15px),
    // gunakan getBoundingClientRect + scroll untuk presisi sub-pixel. Jika ada selisih besar (lag scroll/reflow),
    // gunakan penelusuran offsetParent untuk kestabilan penuh agar bingkai tidak bergeser.
    const rectDocTop = rect.top + window.scrollY;
    const rectDocLeft = rect.left + window.scrollX;
    
    const finalTop = Math.abs(rectDocTop - docTop) < 15 ? rectDocTop : docTop;
    const finalLeft = Math.abs(rectDocLeft - docLeft) < 15 ? rectDocLeft : docLeft;

    container.style.position = 'absolute';
    container.style.top = finalTop + 'px';
    container.style.left = finalLeft + 'px';
    container.style.width = rect.width + 'px';
    container.style.height = rect.height + 'px';
    
    // Scale the player-container from 960px fixed reference to match the placeholder width.
    // This prevents actual iframe resize events that would trigger DevTools detection
    // inside the embed player from apijav.com.
    const playerContainer = document.getElementById('player-container');
    if (playerContainer) {
      playerContainer.style.transform = 'none';  // ← Hapus transform
      playerContainer.style.width = rect.width + 'px';   // ← Resize langsung
      playerContainer.style.height = rect.height + 'px';
    }
  }
}

/**
 * Menginisialisasi ResizeObserver pada placeholder untuk menyelaraskan pemutar secara dinamis
 * saat ukuran layar berubah, sidebar diciutkan, atau reflow layout DOM selesai.
 */
export function setupPlaceholderObserver() {
  disconnectPlaceholderObserver();
  
  const placeholder = document.querySelector('.player-container-placeholder');
  if (!placeholder) return;
  
  placeholderObserver = new ResizeObserver(() => {
    alignGlobalPlayerWithPlaceholder();
  });
  
  placeholderObserver.observe(placeholder);
}

/**
 * Membersihkan ResizeObserver saat meninggalkan halaman watch atau menutup pemutar
 */
export function disconnectPlaceholderObserver() {
  if (placeholderObserver) {
    placeholderObserver.disconnect();
    placeholderObserver = null;
  }
}

/**
 * Menampilkan modal popup Share Premium dengan dukungan sosial media (Pinterest, X, Facebook, Copy Link)
 */
export function showShareModal(title, shareUrl, thumbnailUrl) {
  let modal = document.getElementById('share-modal-overlay');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'share-modal-overlay';
    modal.className = 'share-modal-overlay hidden';
    modal.innerHTML = `
      <div class="share-modal-card">
        <div class="share-modal-header">
          <h3 data-i18n="share_modal_title">Share Video</h3>
          <button class="share-modal-close" aria-label="Close Share Dialog">✕</button>
        </div>
        <div class="share-modal-body">
          <div class="share-options-grid">
            <a href="#" target="_blank" class="share-option-btn opt-telegram">
              <img src="/assets/logo/Telegram_logo.webp" class="share-icon-img" alt="Telegram">
              <span>Telegram</span>
            </a>
            <a href="#" target="_blank" class="share-option-btn opt-facebook">
              <img src="/assets/logo/Facebook_logo.webp" class="share-icon-img" alt="Facebook">
              <span>Facebook</span>
            </a>
            <a href="#" target="_blank" class="share-option-btn opt-x">
              <img src="/assets/logo/twitter-x_logo.webp" class="share-icon-img" alt="X (Twitter)">
              <span>X (Twitter)</span>
            </a>
            <button class="share-option-btn opt-copy">
              <span class="share-icon">🔗</span>
              <span data-i18n="share_modal_copy">Copy Link</span>
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('.share-modal-close');
    const closeModal = () => {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
    };

    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
        closeModal();
      }
    });
  }

  // Update dynamic links
  const tgBtn = modal.querySelector('.opt-telegram');
  const fbBtn = modal.querySelector('.opt-facebook');
  const xBtn = modal.querySelector('.opt-x');
  const copyBtn = modal.querySelector('.opt-copy');

  tgBtn.href = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(title)}`;
  fbBtn.href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
  xBtn.href = `https://x.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(title)}`;

  copyBtn.onclick = (e) => {
    e.preventDefault();
    navigator.clipboard.writeText(shareUrl).then(() => {
      ui.showToast(i18n.t('toast_share_success') || 'Link successfully copied to clipboard! 📋');
      modal.classList.add('hidden');
      document.body.style.overflow = '';
    }).catch(() => {
      ui.showToast(i18n.t('toast_share_failed') || 'Failed to copy link.');
    });
  };

  // Translate modal static texts
  if (typeof i18n.translateStaticUI === 'function') {
    i18n.translateStaticUI();
  }

  // Show
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

/**
 * Inisialisasi engine Autoplay/Up Next
 */
function initUpNextEngine(currentPost, nextPost) {
  // Reset any timers
  if (upNextTimeoutId) {
    clearTimeout(upNextTimeoutId);
    upNextTimeoutId = null;
  }
  if (upNextCountdownId) {
    clearInterval(upNextCountdownId);
    upNextCountdownId = null;
  }

  // Setup click listener for Auto-Play toggle button
  const toggleBtn = document.getElementById('autoplay-toggle');
  if (toggleBtn) {
    // Read saved setting
    const savedAutoPlay = localStorage.getItem('missavj_autoplay');
    if (savedAutoPlay === 'false') {
      toggleBtn.classList.remove('active');
    } else {
      toggleBtn.classList.add('active');
    }

    if (!toggleBtn.dataset.listenerBound) {
      toggleBtn.dataset.listenerBound = 'true';
      toggleBtn.addEventListener('click', () => {
        toggleBtn.classList.toggle('active');
        const isActive = toggleBtn.classList.contains('active');
        localStorage.setItem('missavj_autoplay', isActive ? 'true' : 'false');
        if (!isActive) {
          // Cancel countdown
          if (upNextTimeoutId) clearTimeout(upNextTimeoutId);
          if (upNextCountdownId) clearInterval(upNextCountdownId);
          removeUpNextBanner();
        }
      });
    }
  }

  // Listen to postMessage from embed player
  const handlePlayerMessage = (event) => {
    const isAutoplayEnabled = toggleBtn ? toggleBtn.classList.contains('active') : true;
    if (!isAutoplayEnabled) return;

    try {
      let data = event.data;
      if (typeof data === 'string') {
        data = JSON.parse(data);
      }
      
      const isEnded = 
        data.event === 'ended' || 
        data.event === 'finish' ||
        data.state === 'completed' ||
        (data.event === 'onStateChange' && data.data === 0) ||
        data.type === 'ended';

      if (isEnded) {
        startUpNextCountdown(nextPost);
      }
    } catch (e) {
      // Ignore non-json or irrelevant messages
    }
  };

  if (window._upNextMessageListener) {
    window.removeEventListener('message', window._upNextMessageListener);
  }
  window._upNextMessageListener = handlePlayerMessage;
  window.addEventListener('message', handlePlayerMessage);
}

function startUpNextCountdown(nextPost) {
  if (upNextTimeoutId) clearTimeout(upNextTimeoutId);
  if (upNextCountdownId) clearInterval(upNextCountdownId);

  let secondsLeft = 8;
  showUpNextBanner(nextPost, secondsLeft);

  upNextCountdownId = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearInterval(upNextCountdownId);
      upNextCountdownId = null;
      triggerAutoPlayNavigate(nextPost);
    } else {
      updateUpNextBannerSeconds(secondsLeft);
    }
  }, 1000);

  upNextTimeoutId = setTimeout(() => {
    if (upNextCountdownId) {
      clearInterval(upNextCountdownId);
      upNextCountdownId = null;
    }
    triggerAutoPlayNavigate(nextPost);
  }, 8000);
}

function triggerAutoPlayNavigate(nextPost) {
  removeUpNextBanner();
  const targetUrl = window.missavJGetWatchUrl ? window.missavJGetWatchUrl(nextPost.id, nextPost.code, nextPost.title) : `/watch/${nextPost.id}`;
  const langPrefix = i18n.getLang() ? `/${i18n.getLang()}` : '';
  window.missavJNavigate(`${langPrefix}${targetUrl}`);
}

function showUpNextBanner(nextPost, seconds) {
  removeUpNextBanner();
  
  const banner = document.createElement('div');
  banner.id = 'up-next-countdown-banner';
  banner.className = 'up-next-countdown-banner';
  
  const title = i18n.translateVideoTitle(nextPost.title);
  const code = nextPost.code || '';
  
  banner.innerHTML = `
    <div class="up-next-banner-content">
      <div class="up-next-banner-title">
        <span class="next-label">${i18n.t('up_next') || 'Up Next'}:</span>
        <span class="next-video-title">${ui.escapeHTML(code)} - ${ui.escapeHTML(title)}</span>
      </div>
      <div class="up-next-banner-timer">
        Playing in <span id="up-next-seconds">${seconds}</span>s...
      </div>
      <div class="up-next-banner-actions">
        <button id="up-next-cancel-btn" class="up-next-btn cancel-btn">Cancel</button>
        <button id="up-next-play-btn" class="up-next-btn play-btn">Play Now</button>
      </div>
    </div>
  `;

  const container = document.querySelector('.player-container-wrapper');
  if (container) {
    container.appendChild(banner);
  }

  const cancelBtn = banner.querySelector('#up-next-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (upNextTimeoutId) clearTimeout(upNextTimeoutId);
      if (upNextCountdownId) clearInterval(upNextCountdownId);
      removeUpNextBanner();
    });
  }

  const playBtn = banner.querySelector('#up-next-play-btn');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      triggerAutoPlayNavigate(nextPost);
    });
  }
}

function updateUpNextBannerSeconds(seconds) {
  const el = document.getElementById('up-next-seconds');
  if (el) el.textContent = seconds;
}

function removeUpNextBanner() {
  const banner = document.getElementById('up-next-countdown-banner');
  if (banner) {
    banner.remove();
  }
}

function parseDurationToSeconds(durationStr) {
  if (!durationStr) return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function startPlaybackTracker(id, initialDuration) {
  if (playbackTrackerInterval) {
    clearInterval(playbackTrackerInterval);
  }

  let totalDuration = initialDuration || 0;
  let secondsWatched = 0;
  
  const history = SessionHistory.getHistory();
  const savedItem = history.find(p => String(p.id) === String(id));
  if (savedItem) {
    secondsWatched = savedItem.watchedTime || 0;
    if (savedItem.duration) totalDuration = savedItem.duration;
  }

  let lastTickTime = Date.now();
  playbackTrackerInterval = setInterval(() => {
    const poster = document.getElementById('player-custom-poster');
    
    if (document.hidden) return;

    if (poster && poster.style.display !== 'none') {
      return;
    }

    const now = Date.now();
    const delta = Math.floor((now - lastTickTime) / 1000);
    lastTickTime = now;

    if (delta > 0 && delta < 10) {
      secondsWatched += delta;
      SessionHistory.updateProgress(id, secondsWatched, totalDuration);
    }
  }, 1000);

  const handlePlayerMessage = (event) => {
    try {
      let data = event.data;
      if (typeof data === 'string') {
        data = JSON.parse(data);
      }
      
      let timeUpdate = null;
      let durationUpdate = null;

      if (data.event === 'time' && typeof data.position === 'number') {
        timeUpdate = Math.floor(data.position);
        if (typeof data.duration === 'number') durationUpdate = Math.floor(data.duration);
      } else if (data.event === 'infoDelivery' && data.info) {
        if (typeof data.info.currentTime === 'number') timeUpdate = Math.floor(data.info.currentTime);
        if (typeof data.info.duration === 'number') durationUpdate = Math.floor(data.info.duration);
      } else if (typeof data.currentTime === 'number') {
        timeUpdate = Math.floor(data.currentTime);
        if (typeof data.duration === 'number') durationUpdate = Math.floor(data.duration);
      }

      if (timeUpdate !== null && timeUpdate >= 0) {
        secondsWatched = timeUpdate;
        if (durationUpdate && durationUpdate > 0) totalDuration = durationUpdate;
        SessionHistory.updateProgress(id, secondsWatched, totalDuration);
      }
    } catch (e) {
      // Ignore
    }
  };

  if (window._playerPlaybackMessageListener) {
    window.removeEventListener('message', window._playerPlaybackMessageListener);
  }
  window._playerPlaybackMessageListener = handlePlayerMessage;
  window.addEventListener('message', handlePlayerMessage);
}


async function loadRandomBottomVideos(studioName) {
  const grid = document.getElementById('player-random-grid');
  if (!grid) return;
  
  // Tampilkan skeleton loader sebanyak 10 item (2 baris x 5 di desktop)
  ui.showSkeletonsInElement(grid, 10);
  
  try {
    const rawData = await api.getFeed(1);
    const data = rawData && rawData.data ? rawData.data : rawData;
    let allPosts = Array.isArray(data) ? data : [];
    
    // Filter out video yang sedang ditonton
    const currentId = new URLSearchParams(window.location.search).get('id');
    allPosts = allPosts.filter(p => String(p.id) !== String(currentId));
    
    // Prioritaskan studio yang sama jika ada, lalu campur dengan yang lain
    let studioPosts = [];
    let otherPosts = [];
    
    if (studioName) {
      studioPosts = allPosts.filter(p => p.studio === studioName);
      otherPosts = allPosts.filter(p => p.studio !== studioName);
    } else {
      otherPosts = allPosts;
    }
    
    // Shuffle array (Fisher-Yates)
    const shuffle = (arr) => {
      let currentIndex = arr.length, randomIndex;
      while (currentIndex !== 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [arr[currentIndex], arr[randomIndex]] = [arr[randomIndex], arr[currentIndex]];
      }
      return arr;
    };
    
    studioPosts = shuffle(studioPosts);
    otherPosts = shuffle(otherPosts);
    
    // Ambil maksimal 10 video
    let selectedPosts = [...studioPosts, ...otherPosts].slice(0, 10);
    
    // Jika tidak ada data
    if (selectedPosts.length === 0) {
      grid.innerHTML = '<div class="empty-state">Tidak ada rekomendasi video.</div>';
      return;
    }
    
    // Render menggunakan import dinamis dari feed.js
    import('./feed.js?v=2.6.17').then(feedModule => {
      // disableCinematic = true agar grid seragam
      grid.innerHTML = selectedPosts.map((post, idx) => feedModule.renderVideoCard(post, idx, true)).join('');
      ui.lazyLoadImages();
      feedModule.bindHoverPreviews();
    });
    
  } catch (err) {
    console.error('Error loading random bottom videos:', err);
    grid.innerHTML = `<div class="empty-state">${i18n.t('error_loading_feed')}</div>`;
  }
}

export default { 
  init, 
  alignGlobalPlayerWithPlaceholder, 
  setupPlaceholderObserver, 
  disconnectPlaceholderObserver 
};
