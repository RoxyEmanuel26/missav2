/**
 * MISSAV-J — Local Behavioral Memory Engine
 * Privacy-safe, 100% client-side session memory for personalized UX.
 * Zero cookies, zero backend tracking.
 */

const HISTORY_KEY = 'missavj_watch_history';
const MAX_HISTORY = 12; // Provides enough history for 1-2 rows on the homepage

function parseDurationToSeconds(durationStr) {
  if (!durationStr) return 0;
  if (typeof durationStr === 'number') return durationStr;
  const parts = String(durationStr).split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function getDeterministicDuration(id) {
  const numId = parseInt(id) || 12345;
  const hours = (numId % 2) + 1; // 1 or 2 hours
  const minutes = numId % 60;
  const seconds = (numId * 7) % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export const SessionHistory = {
  /**
   * Returns the user's recently watched videos.
   */
  getHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },

  /**
   * Adds a video to the local watch history, pushing it to the front.
   * Deduplicates if the video is already in history.
   */
  addWatch(post) {
    if (!post || !post.id) {
      console.warn(`[SessionHistory addWatch] Bypassed addWatch, post or post.id is missing:`, post);
      return;
    }

    try {
      let history = this.getHistory();
      
      // Preserve existing watchedTime and duration if available
      const existing = history.find(p => String(p.id) === String(post.id));
      const watchedTime = existing ? (existing.watchedTime || 0) : 0;
      
      let duration = existing ? (existing.duration || 0) : 0;
      if (!duration) {
        let durStr = post.duration || '';
        if (!durStr || durStr === '00:00:00') {
          durStr = getDeterministicDuration(post.id);
        }
        duration = parseDurationToSeconds(durStr);
      }
      
      // Remove if already exists to push it to the front
      history = history.filter(p => String(p.id) !== String(post.id));
      
      // Add to front (most recent)
      history.unshift({
        id: post.id,
        code: post.code || '',
        title: post.title || '',
        thumbnail: post.thumbnail || '',
        studio: post.studio || '',
        actors: post.actors || [],
        tags: post.tags || [],
        categories: post.categories || [],
        timestamp: Date.now(),
        watchedTime,
        duration
      });

      // Cap at MAX_HISTORY to prevent localStorage bloat
      if (history.length > MAX_HISTORY) {
        history = history.slice(0, MAX_HISTORY);
      }

      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      console.warn('[SessionHistory] Failed to save to localStorage:', e);
    }
  },

  /**
   * Updates progress for a video in history.
   */
  updateProgress(id, watchedTime, duration) {
    try {
      let history = this.getHistory();
      const item = history.find(p => String(p.id) === String(id));
      if (item) {
        item.watchedTime = watchedTime;
        if (duration) item.duration = duration;
        item.timestamp = Date.now();
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      }
    } catch (e) {
      console.warn('[SessionHistory] Failed to update progress:', e);
    }
  },

  /**
   * Removes a video from history.
   */
  removeWatch(id) {
    try {
      let history = this.getHistory();
      history = history.filter(p => String(p.id) !== String(id));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      console.warn('[SessionHistory] Failed to remove watch item:', e);
    }
  },

  /**
   * Computes top tags and actors based on history to drive the Personalization Bonus.
   * Uses a recency-weighted algorithm (recently watched videos influence scores more).
   */
  getTopPreferences() {
    const history = this.getHistory();
    const scores = {
      actors: {},
      tags: {}
    };

    history.forEach((post, index) => {
      // Recency weight: newest video = 12 pts, oldest = 1 pt
      const weight = MAX_HISTORY - index; 

      if (post.actors) {
        post.actors.forEach(a => {
          const key = a.toLowerCase();
          scores.actors[key] = (scores.actors[key] || 0) + weight;
        });
      }
      
      if (post.tags) {
        post.tags.forEach(t => {
          const key = t.toLowerCase();
          scores.tags[key] = (scores.tags[key] || 0) + weight;
        });
      }
    });

    return scores;
  }
};
