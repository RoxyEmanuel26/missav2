/**
 * MISSAV-J — Local Behavioral Memory Engine
 * Privacy-safe, 100% client-side session memory for personalized UX.
 * Zero cookies, zero backend tracking.
 */

const HISTORY_KEY = 'missavj_watch_history';
const MAX_HISTORY = 12; // Provides enough history for 1-2 rows on the homepage

export const SessionHistory = {
  /**
   * Returns the user's recently watched videos.
   */
  getHistory() {
    try {
      const data = localStorage.getItem(HISTORY_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  /**
   * Adds a video to the local watch history, pushing it to the front.
   * Deduplicates if the video is already in history.
   */
  addWatch(post) {
    if (!post || !post.id) return;

    try {
      let history = this.getHistory();
      
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
        timestamp: Date.now()
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
