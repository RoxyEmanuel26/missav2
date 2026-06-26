/**
 * MISSAV-J — UI State Helper (Secured & Optimized)
 * Mengelola elemen UI visual seperti loading skeleton, toast alert,
 * tema warna in-memory, serta tampilan error dan empty states yang aman dari XSS.
 */

// State Tema global (In-memory, tidak disimpan ke localStorage/sessionStorage)
let currentTheme = 'dark';

const ui = {
  /**
   * Format numbers with localized separators (e.g. 1.000.000)
   */
  formatNumber(num) {
    if (isNaN(num)) return num;
    return new Intl.NumberFormat(window.i18n ? window.i18n.getLang() : 'id-ID').format(num);
  },

  /**
   * Mengamankan teks dari serangan XSS dengan melakukan encoding pada karakter HTML
   * @param {string} str - Teks input mentah dari API atau input user
   * @returns {string} Teks tersanitasi aman dimasukkan ke innerHTML
   */
  escapeHTML(str) {
    if (str === null || str === undefined) return '';
    if (typeof str !== 'string') return String(str);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  /**
   * Mengubah URL thumbnail eksternal agar dimuat melalui Cloudflare Worker Proxy
   * jika diakses dari situs produksi (menghindari blokir ISP/Internet Positif & AdBlocker)
   * @param {string} url - URL thumbnail asli
   * @returns {string} URL proxy atau URL asli
   */
  getProxiedThumbnail(url) {
    if (!url) return '';
    const isLocal = window.location.protocol === 'file:' || 
                    window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1';
    if (isLocal) {
      // Use a fast public image proxy on local to resize images (simulating production behavior)
      // This prevents loading massive original images which causes slow perceived performance
      try {
        const cleanUrl = url.replace(/^https?:\/\//, '');
        return `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&w=320&output=webp&we`;
      } catch (e) {
        return url;
      }
    }
    try {
      // Base64 encode the URL to bypass AdBlocker keyword blocks on "apijav"
      // Add &w=320 hint for Edge CDN resizer to massively save bandwidth
      return `/api/image?url=${btoa(url)}&w=320`;
    } catch (e) {
      return `/api/image?url=${encodeURIComponent(url)}&w=320`;
    }
  },

  /**
   * Menampilkan skeleton loader dengan efek shimmer di area konten utama
   * @param {number} count - Jumlah kartu skeleton yang ingin dirender
   */
  showSkeletons(count = 8) {
    const mainApp = document.getElementById('app-content');
    if (!mainApp) return;

    mainApp.innerHTML = `
      <div class="editorial-grid" id="video-grid">
        ${Array(count).fill(0).map(() => `
          <div class="video-card card-base card-editorial skeleton-card">
            <div class="skeleton skeleton-image card-thumb"></div>
            <div class="card-info">
              <div class="skeleton skeleton-text" style="width:90%"></div>
              <div class="skeleton skeleton-text" style="width:65%"></div>
              <div class="skeleton skeleton-text" style="width:40%"></div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  /**
   * Menyisipkan skeleton loader ke dalam elemen grid tertentu
   * (Misalnya sidebar video terkait)
   * @param {HTMLElement} element - Target element penampung
   * @param {number} count - Jumlah skeleton
   */
  showSkeletonsInElement(element, count = 4) {
    if (!element) return;
    element.innerHTML = Array(count).fill(0).map(() => `
      <div class="video-card card-base card-compact skeleton-card-row">
        <div class="skeleton skeleton-image-row card-thumb"></div>
        <div class="card-info-row">
          <div class="skeleton skeleton-text" style="width:85%"></div>
          <div class="skeleton skeleton-text" style="width:50%"></div>
        </div>
      </div>
    `).join('');
  },

  /**
   * Menampilkan pesan toast melayang di bagian bawah layar
   * @param {string} message - Pesan toast
   * @param {number} duration - Durasi tampil (ms)
   */
  showToast(message, duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast show';
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.remove('show');
      toast.classList.add('hide');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, duration);
  },

  /**
   * Menampilkan loading spinner
   * @param {HTMLElement} [container] - Container opsional
   */
  showLoading(container = null) {
    const target = container || document.getElementById('app-content');
    if (target) {
      target.innerHTML = `
        <div class="loader-container">
          <div class="spinner"></div>
        </div>
      `;
    }
  },

  /**
   * Menampilkan halaman error dengan tombol "Coba Lagi" (Aman XSS)
   * @param {string} message - Deskripsi kesalahan
   * @param {HTMLElement} [container] - Container opsional
   */
  showError(message, container = null) {
    const target = container || document.getElementById('app-content');
    if (!target) return;

    const safeMessage = this.escapeHTML(message);
    const i18n = window.i18n;
    const titleText = i18n ? i18n.t('error_title') : 'Oops! Terjadi kesalahan';
    const btnText = i18n ? i18n.t('error_retry') : 'Coba Lagi';

    target.innerHTML = `
      <div class="empty-state-premium error-state-premium">
        <div class="error-state-glow"></div>
        <div class="empty-icon-wrapper error-icon-wrapper">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="premium-empty-icon">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </div>
        <h3 class="empty-state-title">${titleText}</h3>
        <p class="empty-state-desc">${safeMessage}</p>
        <button id="error-retry-btn" class="empty-state-btn error-state-btn">
          <span>${btnText}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        </button>
      </div>
    `;

    const retryBtn = document.getElementById('error-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        window.location.reload();
      });
    }
  },

  /**
   * Shows a dedicated Offline UI when no network and no cache is available.
   */
  showOfflineState(container = null) {
    const target = container || document.getElementById('app-content');
    if (!target) return;

    const i18n = window.i18n;
    const title = i18n ? i18n.t('offline_title') || 'No Internet Connection' : 'No Internet Connection';
    const msg = i18n ? i18n.t('offline_desc') || 'Please check your network and try again.' : 'Please check your network and try again.';
    const btn = i18n ? i18n.t('offline_retry') || 'Reconnect' : 'Reconnect';

    target.innerHTML = `
      <div class="empty-state-premium error-state-premium">
        <div class="error-state-glow" style="background: radial-gradient(circle at center, rgba(150, 150, 150, 0.15), transparent 70%);"></div>
        <div class="empty-icon error-icon" style="color: var(--color-text-muted);">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l20 20"/><path d="M8.53 8.53C5.52 10.3 3.1 13.06 1.5 16.5c4.71-3.69 10.22-4.47 15.53-2.61"/><path d="M16.74 12.74C18.8 13.72 20.61 15 22.5 16.5c-2.35-3.32-5.46-5.83-9-7.34"/><path d="M4.66 4.66C8.2 3.01 12 2.5 15.8 3.32"/></svg>
        </div>
        <h3 class="error-title">${title}</h3>
        <p class="error-desc">${msg}</p>
        <button onclick="window.location.reload()" class="error-state-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          ${btn}
        </button>
      </div>
    `;
  },

  /**
   * Menampilkan halaman kosong jika pencarian tidak ditemukan (Aman XSS)
   * @param {string} query - Kata kunci pencarian yang gagal
   * @param {HTMLElement} [container] - Container opsional
   */
  showEmpty(query, container = null) {
    const target = container || document.getElementById('app-content');
    if (!target) return;

    const safeQuery = this.escapeHTML(query);
    const i18n = window.i18n;
    const titleText = i18n ? i18n.t('no_results_for', { query: safeQuery }) : `Tidak ada hasil untuk "${safeQuery}"`;
    const descText = i18n ? i18n.t('no_results_desc') : 'Coba kata kunci yang berbeda, periksa ejaan, atau hapus filter aktif.';
    const btnText = i18n ? i18n.t('empty_clear_btn') : 'Kembali ke Beranda';

    target.innerHTML = `
      <div class="empty-state-premium">
        <div class="empty-state-glow"></div>
        <div class="empty-icon-wrapper">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="premium-empty-icon">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            <line x1="11" y1="8" x2="11" y2="14"></line>
            <line x1="8" y1="11" x2="14" y2="11"></line>
          </svg>
        </div>
        <h3 class="empty-state-title">${titleText}</h3>
        <p class="empty-state-desc">${descText}</p>
        <button id="empty-clear-btn" class="empty-state-btn">
          <span>${btnText}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
        </button>
      </div>
    `;

    const clearBtn = document.getElementById('empty-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        window.missavJNavigate('/');
      });
    }
  },

  /**
   * Inisialisasi tema pertama kali
   */
  initTheme() {
    document.documentElement.setAttribute('data-theme', currentTheme);
    this.updateThemeButtonIcon();
    
    // Watch for system preference changes if no user preference is stored
    if (!localStorage.getItem('missav_theme')) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
      if (!prefersDark.matches) {
        currentTheme = 'light';
        document.documentElement.setAttribute('data-theme', currentTheme);
        this.updateThemeButtonIcon();
      }
    }
  },

  /**
   * Toggle tema (Dark <=> Light)
   */
  toggleTheme() {
    // Add transition class to body to make switching smooth
    document.body.classList.add('theme-transitioning');
    
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('missav_theme', currentTheme);
    this.updateThemeButtonIcon();
    
    // Remove transition class after animation completes
    setTimeout(() => {
      document.body.classList.remove('theme-transitioning');
    }, 500);

    const i18n = window.i18n;
    if (currentTheme === 'dark') {
      this.showToast(i18n ? i18n.t('theme_switched_dark') : 'Beralih ke Mode Gelap');
    } else {
      this.showToast(i18n ? i18n.t('theme_switched_light') : 'Beralih ke Mode Terang');
    }
  },

  /**
   * Mengubah ikon tombol tema sesuai tema aktif saat ini
   */
  updateThemeButtonIcon() {
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (!themeBtn) return;

    // We use a single sophisticated SVG icon that animates based on state, 
    // but here we can just supply the right SVG states for our CSS to animate
    if (currentTheme === 'dark') {
      themeBtn.innerHTML = `
        <div class="theme-icon-container dark-active">
          <svg class="sun-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
          </svg>
          <svg class="moon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
        </div>
      `;
      themeBtn.setAttribute('title', window.i18n ? window.i18n.t('theme_switched_light') : 'Ganti ke Mode Terang');
    } else {
      themeBtn.innerHTML = `
        <div class="theme-icon-container light-active">
          <svg class="sun-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
          </svg>
          <svg class="moon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
        </div>
      `;
      themeBtn.setAttribute('title', window.i18n ? window.i18n.t('theme_switched_dark') : 'Ganti ke Mode Gelap');
    }
  },

  /**
   * Render dynamic breadcrumbs based on the current path and active language
   */
  renderBreadcrumbs(routePath, title = '') {
    const breadcrumbNav = document.getElementById('breadcrumb-nav');
    if (!breadcrumbNav) return;
    
    // Check if we are on the homepage
    if (routePath === '/' || routePath === '') {
      breadcrumbNav.classList.add('hidden');
      breadcrumbNav.innerHTML = '';
      return;
    }
    
    const lang = localStorage.getItem('missav_lang') || 'en';
    const segments = routePath.split('?')[0].split('/').filter(Boolean);
    
    let html = `<ol itemscope itemtype="https://schema.org/BreadcrumbList" class="breadcrumb-list">`;
    
    // Home
    html += `
      <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
        <a itemprop="item" href="/${lang}/">
          <span itemprop="name">Beranda</span>
        </a>
        <meta itemprop="position" content="1" />
      </li>
    `;
    
    let currentPath = `/${lang}`;
    let position = 2;
    
    if (segments.length > 0 && segments[0] !== '') {
      const rootSegment = segments[0];
      
      const rootNames = {
        'trending': 'Trending',
        'categories': 'Kategori',
        'actors': 'Aktor',
        'studios': 'Studio',
        'recent': 'Terbaru',
        'watch': 'Watch',
        'actor': 'Aktor',
        'studio': 'Studio',
        'search': 'Pencarian'
      };
      
      const rootName = rootNames[rootSegment] || (rootSegment.charAt(0).toUpperCase() + rootSegment.slice(1));
      const isWatch = rootSegment === 'watch';
      const isLast = segments.length === 1 && !title;
      
      if (!isWatch) {
        html += `
          <li class="breadcrumb-separator">/</li>
          <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
            ${isLast || rootSegment === 'search' || rootSegment === 'actor' || rootSegment === 'studio'
              ? `<span itemprop="name">${rootName}</span>` 
              : `<a itemprop="item" href="${currentPath}/${rootSegment}"><span itemprop="name">${rootName}</span></a>`
            }
            <meta itemprop="position" content="${position}" />
          </li>
        `;
        position++;
      }
      
      if (rootSegment === 'actor' || rootSegment === 'studio' || rootSegment === 'search') {
         const urlParams = new URLSearchParams(window.location.search);
         const q = urlParams.get('name') || urlParams.get('q');
         if (q) {
           html += `
             <li class="breadcrumb-separator">/</li>
             <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
               <span itemprop="name">${this.escapeHTML(q)}</span>
               <meta itemprop="position" content="${position}" />
             </li>
           `;
           position++;
         }
      } else if (title) {
        const shortTitle = title.length > 40 ? title.substring(0, 40) + '...' : title;
        html += `
          <li class="breadcrumb-separator">/</li>
          <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
            <span itemprop="name" title="${this.escapeHTML(title)}">${this.escapeHTML(shortTitle)}</span>
            <meta itemprop="position" content="${position}" />
          </li>
        `;
        position++;
      }
    }
    
    html += `</ol>`;
    breadcrumbNav.innerHTML = html;
    breadcrumbNav.classList.remove('hidden');
  }
};

export default ui;
