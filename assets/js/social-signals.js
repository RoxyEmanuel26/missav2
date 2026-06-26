/**
 * MISSAV-J — Social Signals & Community Psychology Engineering
 * 
 * Simulated (but deterministic) community signals to enhance engagement.
 * Generates live viewer counts, trending badges, and engagement metrics
 * completely client-side to build a "live platform" perception.
 */
import i18n from './i18n.js?v=2.3.2';

// Simple deterministic hash from string (e.g. video ID)
function hashString(str) {
  let hash = 0;
  if (!str || str.length === 0) return hash;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Calculates a plausible "Live Viewers" count for a video.
 * Uses the video ID hash and the current hour/minute to create a slow-moving,
 * consistent number across page reloads.
 * 
 * @param {string} videoId - The video ID string
 * @param {number} baseViews - The actual total views of the video (optional)
 * @returns {number} The simulated live viewer count
 */
export function getLiveWatching(videoId, baseViews = 0) {
  const hash = hashString(videoId);
  const now = new Date();
  
  // Create a time seed that changes slightly every 5 minutes
  const timeSeed = now.getHours() * 60 + Math.floor(now.getMinutes() / 5);
  
  // Base watching calculation:
  // Usually, live viewers are roughly 0.05% to 0.2% of total views,
  // or a baseline driven by the hash if views are unknown/small.
  let baseWatching = baseViews > 10000 ? Math.floor(baseViews * 0.0005) : (hash % 150) + 12;
  
  // Add a sine wave based on time to simulate peak hours
  const peakMultiplier = 1 + (Math.sin((now.getHours() / 24) * Math.PI * 2) * 0.3); // +/- 30%
  
  // Modulate based on the 5-minute timeSeed to make it look "active" over time
  const noise = ((hash + timeSeed) % 30) - 15; // +/- 15 viewers fluctuation
  
  let finalWatching = Math.floor(baseWatching * peakMultiplier) + noise;
  return Math.max(finalWatching, 3); // Minimum 3 people watching to avoid sadness
}

/**
 * Determines if a video gets a "Trending" or "Hot" badge.
 * 
 * @param {string} videoId - The video ID
 * @param {number} baseViews - The actual total views
 * @returns {string} The badge HTML string or empty string
 */
export function getTrendingBadge(videoId, baseViews = 0) {
  const hash = hashString(videoId);
  
  // If the video has huge views, it's a candidate
  if (baseViews > 50000) {
    if (hash % 5 === 0) {
      return `<span class="badge badge-trending">📈 ${i18n.t('badge_trending') || 'Trending'}</span>`;
    } else if (hash % 7 === 0) {
      return `<span class="badge badge-hot">🔥 ${i18n.t('badge_hot') || 'Hot'}</span>`;
    }
  }
  
  // Even for lower views, simulate a localized trend breakout (FOMO)
  if (hash % 42 === 0) {
    return `<span class="badge badge-popular">🌟 ${i18n.t('badge_popular') || 'Popular'}</span>`;
  }
  
  return ''; // No badge
}

/**
 * Generates plausible likes and comments for the player page.
 * Deterministic based on total views and video ID.
 * 
 * @param {string} videoId 
 * @param {number} baseViews 
 * @returns {Object} { likes, comments, approvalRating }
 */
export function getEngagementStats(videoId, baseViews = 0) {
  const hash = hashString(videoId);
  
  // Typical like ratio is 1-4% of views
  const likeRatio = 0.01 + ((hash % 30) / 1000); // 1.0% to 3.9%
  let likes = Math.floor(baseViews * likeRatio);
  
  // If views are 0 or very small, give it some baseline likes based on hash
  if (likes < 5) likes = (hash % 100) + 5;
  
  // Comments are usually 5-10% of likes
  const commentRatio = 0.05 + ((hash % 50) / 1000);
  let comments = Math.floor(likes * commentRatio);
  
  // Like vs Dislike ratio (e.g. 92% to 99% positive)
  const approvalRating = 90 + (hash % 10);
  
  return {
    likes,
    comments,
    approvalRating
  };
}

/**
 * Periodically updates an element with fluctuating live numbers.
 * @param {HTMLElement} element - The DOM node to update
 * @param {string} videoId 
 * @param {number} baseViews 
 */
export function initLiveActivityPulse(element, videoId, baseViews) {
  if (!element) return;
  
  const updatePulse = () => {
    // We add a tiny random jitter strictly for the live page session
    // (This part doesn't need to be strictly deterministic across reloads,
    // it's just the moment-to-moment fluctuation).
    const currentWatching = getLiveWatching(videoId, baseViews);
    const jitter = Math.floor(Math.random() * 5) - 2; // -2 to +2
    const displayValue = Math.max(currentWatching + jitter, 1);
    
    // Add pulsing dot
    element.innerHTML = `<span class="live-pulse"></span> ${displayValue.toLocaleString(i18n.getLang())} ${i18n.t('watching_now') || 'watching now'}`;
  };

  updatePulse();
  
  // Fluctuate every 8-15 seconds
  setInterval(updatePulse, 8000 + (Math.random() * 7000));
}
