/**
 * MISSAV-J — API Client Wrapper
 * Mengintegrasikan front-end dengan apiJAV REST API.
 * Menyediakan fungsi-fungsi fetch terbungkus dengan penanganan error.
 */
import { Telemetry } from './telemetry.js?v=2.6.34';

const BASE = (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'https://server.apijav.com/wp-json/myvideo/v1'
  : '/api';

function getActiveLang() {
  const segments = window.location.pathname.replace(/^\//, '').split('/');
  const lang = segments[0] || 'en';
  const validLangs = ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'ms', 'th', 'de', 'fr', 'vi', 'id', 'fil', 'pt'];
  return validLangs.includes(lang) ? lang : 'en';
}

// In-memory cache to prevent redundant API network requests (with 5-minute TTL)
const apiCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

// Promise registry to deduplicate identical in-flight API requests
const fetchPromises = new Map();

// Circuit Breaker to prevent API death spirals during backend failure
const circuitBreaker = {
  failures: 0,
  lastFailureTime: 0,
  isOpen: false,
  MAX_FAILURES: 3,
  COOLDOWN_MS: 30000,
  
  recordFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.MAX_FAILURES && !this.isOpen) {
      this.isOpen = true;
      Telemetry.logAnomaly('CircuitBreakerTripped', { time: new Date().toISOString() });
      console.error('[API] Circuit Breaker TRIPPED. Blocking network requests for 30s.');
    }
  },
  
  recordSuccess() {
    if (this.isOpen) {
      console.log('[API] Circuit Breaker RECOVERED.');
    }
    this.failures = 0;
    this.isOpen = false;
  },
  
  check() {
    if (this.isOpen) {
      if (Date.now() - this.lastFailureTime > this.COOLDOWN_MS) {
        // Half-open state: allow a request through to test the waters
        this.isOpen = false;
        this.failures = this.MAX_FAILURES - 1; 
        return true;
      }
      return false; // Still open, block
    }
    return true;
  }
};

/**
 * Validates if a cache entry is still fresh.
 * Supports Stale-While-Revalidate (SWR).
 * Returns { data, isStale } or null.
 */
function getCachedData(key) {
  if (apiCache.has(key)) {
    const entry = apiCache.get(key);
    const isStale = (Date.now() - entry.timestamp) >= CACHE_TTL_MS;
    return { data: entry.data, isStale };
  }
  return null;
}

/**
 * Caches data with a timestamp
 */
function setCachedData(key, data) {
  apiCache.set(key, {
    data,
    timestamp: Date.now()
  });
}

/**
 * Fetch wrapper that handles internal timeout and supports external AbortSignal overrides
 */
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  // If an external signal is provided, link it to our internal abort controller
  if (options.signal) {
    options.signal.addEventListener('abort', () => {
      controller.abort();
    });
    // If it was already aborted before we even attached the listener
    if (options.signal.aborted) {
      controller.abort();
    }
  }

  if (!circuitBreaker.check()) {
    throw new Error('SERVER_OVERLOADED');
  }

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    
    // Log non-2xx responses as anomalies for diagnostics
    if (!response.ok) {
      circuitBreaker.recordFailure();
      Telemetry.logAnomaly('ApiHttpError', { url, status: response.status, statusText: response.statusText });
    } else {
      circuitBreaker.recordSuccess();
    }
    return response;
  } catch (error) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      if (options.signal && options.signal.aborted) {
        throw new Error('Fetch aborted by client navigation');
      }
      circuitBreaker.recordFailure();
      Telemetry.logAnomaly('ApiTimeout', { url, timeout });
      throw new Error('SERVER_TIMEOUT');
    }
    circuitBreaker.recordFailure();
    Telemetry.logAnomaly('ApiFetchFailed', { url, error: error.message });
    throw error;
  }
}

const api = {
  /**
   * Mengambil daftar video (feed & listing) dengan query parameters.
   * @param {Object} params - Query parameters (per_page, page, search, category, tag, actor, studio, orderby, order, after)
   * @returns {Promise<{posts: Array, total: number, totalPages: number}>}
   */
  async getPosts(params = {}) {
    try {
      const lang = getActiveLang();
      const cleanParams = { lang };
      const { signal, ...restParams } = params;
      
      // Bersihkan parameter dari nilai kosong/null/undefined agar tidak mengotori query string
      Object.keys(restParams).forEach(key => {
        if (restParams[key] !== undefined && restParams[key] !== null && restParams[key] !== '') {
          cleanParams[key] = restParams[key];
        }
      });

      const qs = new URLSearchParams(cleanParams).toString();
      const url = `${BASE}/posts?${qs}`;
      
      const cached = getCachedData(url);
      if (cached && !cached.isStale) {
        return cached.data;
      }

      // Deduplicate in-flight requests
      if (fetchPromises.has(url)) {
        return fetchPromises.get(url);
      }
      
      const fetchPromise = (async () => {
        try {
          const res = await fetchWithTimeout(url, { signal });
          
          if (!res.ok) {
            throw new Error(`API Error ${res.status}: ${res.statusText}`);
          }
          
          const posts = await res.json();
          
          // Baca dan parse response headers untuk keperluan pagination di UI
          const total = parseInt(res.headers.get('X-WP-Total') || '0', 10);
          const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10);
          const isOfflineFallback = res.headers.has('X-Offline-Fallback');
          
          const result = {
            posts: Array.isArray(posts) ? posts : [],
            total,
            totalPages,
            isOfflineFallback
          };
          
          setCachedData(url, result);
          return result;
        } catch (err) {
          // Graceful Stale Fallback
          if (cached && cached.data) {
            Telemetry.logAnomaly('StaleFallbackTriggered', { url, error: err.message });
            return cached.data;
          }
          // Normalize error messages for UI
          if (err.message === 'SERVER_OVERLOADED') throw new Error('Server sedang sibuk. Silakan coba beberapa saat lagi.');
          if (err.message === 'SERVER_TIMEOUT') throw new Error('Koneksi terputus: Server memakan waktu terlalu lama.');
          throw err;
        }
      })();
      
      fetchPromises.set(url, fetchPromise);
      
      // SWR: If we have stale cache, return it immediately while fetchPromise updates cache in background
      if (cached && cached.isStale) {
        // We don't await fetchPromise here, but we attach a cleanup
        fetchPromise.finally(() => fetchPromises.delete(url)).catch(() => {});
        return cached.data;
      }
      
      try {
        const result = await fetchPromise;
        fetchPromises.delete(url);
        return result;
      } catch (err) {
        fetchPromises.delete(url);
        throw err;
      }
    } catch (error) {
      console.error('[API getPosts Error]', error);
      throw error;
    }
  },

  /**
   * Mengambil detail lengkap video tunggal berdasarkan ID.
   * @param {string|number} id - ID Post / Video
   * @returns {Promise<Object>} Detail post/video
   */
  async getPost(id, options = {}) {
    try {
      if (!id) throw new Error('Post ID wajib disertakan');
      const lang = getActiveLang();
      const cacheKey = `post:${id}:${lang}`;
      const url = `${BASE}/posts/${id}?lang=${lang}`;
      
      const cached = getCachedData(cacheKey);
      if (cached && !cached.isStale) {
        return cached.data;
      }
      
      if (fetchPromises.has(cacheKey)) {
        return fetchPromises.get(cacheKey);
      }
      
      const fetchPromise = (async () => {
        try {
          const res = await fetchWithTimeout(url, { signal: options.signal });
          
          if (!res.ok) {
            throw new Error(`Post dengan ID ${id} tidak ditemukan (${res.status})`);
          }
          
          const isOfflineFallback = res.headers.has('X-Offline-Fallback');
          const post = await res.json();
          post.isOfflineFallback = isOfflineFallback;
          
          setCachedData(cacheKey, post);
          return post;
        } catch (err) {
          if (cached && cached.data) {
            Telemetry.logAnomaly('StaleFallbackTriggered', { url, error: err.message });
            return cached.data;
          }
          if (err.message === 'SERVER_OVERLOADED') throw new Error('Server sedang sibuk. Silakan coba beberapa saat lagi.');
          if (err.message === 'SERVER_TIMEOUT') throw new Error('Koneksi terputus: Server memakan waktu terlalu lama.');
          throw err;
        }
      })();
      
      fetchPromises.set(cacheKey, fetchPromise);
      
      if (cached && cached.isStale) {
        fetchPromise.finally(() => fetchPromises.delete(cacheKey)).catch(() => {});
        return cached.data;
      }
      
      try {
        const result = await fetchPromise;
        fetchPromises.delete(cacheKey);
        return result;
      } catch (err) {
        fetchPromises.delete(cacheKey);
        throw err;
      }
    } catch (error) {
      console.error(`[API getPost ${id} Error]`, error);
      throw error;
    }
  },

  /**
   * Mengambil data embed player berdasarkan ID video.
   * @param {string|number} id - ID Post / Video
   * @returns {Promise<{iframe_html: string}>} Data player berisi markup iframe
   */
  async getPlayer(id, options = {}) {
    try {
      if (!id) throw new Error('Player ID wajib disertakan');
      const lang = getActiveLang();
      const cacheKey = `player:${id}:${lang}`;
      const url = `${BASE}/player/${id}?lang=${lang}`;
      
      const cached = getCachedData(cacheKey);
      if (cached && !cached.isStale) {
        return cached.data;
      }
      
      if (fetchPromises.has(cacheKey)) {
        return fetchPromises.get(cacheKey);
      }
      
      const fetchPromise = (async () => {
        try {
          const res = await fetchWithTimeout(url, { signal: options.signal });
          
          if (!res.ok) {
            throw new Error(`Player untuk ID ${id} gagal dimuat (${res.status})`);
          }
          
          const player = await res.json();
          setCachedData(cacheKey, player);
          return player;
        } catch (err) {
          if (cached && cached.data) {
            Telemetry.logAnomaly('StaleFallbackTriggered', { url, error: err.message });
            return cached.data;
          }
          if (err.message === 'SERVER_OVERLOADED') throw new Error('Server sedang sibuk. Silakan coba beberapa saat lagi.');
          if (err.message === 'SERVER_TIMEOUT') throw new Error('Koneksi terputus: Server memakan waktu terlalu lama.');
          throw err;
        }
      })();
      
      fetchPromises.set(cacheKey, fetchPromise);
      
      if (cached && cached.isStale) {
        fetchPromise.finally(() => fetchPromises.delete(cacheKey)).catch(() => {});
        return cached.data;
      }
      
      try {
        const result = await fetchPromise;
        fetchPromises.delete(cacheKey);
        return result;
      } catch (err) {
        fetchPromises.delete(cacheKey);
        throw err;
      }
    } catch (error) {
      console.error(`[API getPlayer ${id} Error]`, error);
      throw error;
    }
  }
};

export default api;
