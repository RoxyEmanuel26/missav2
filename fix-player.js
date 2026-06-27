const fs = require('fs');
let content = fs.readFileSync('assets/js/player.js', 'utf8');

// 1. Remove custom poster and fix double click issue
let newLines = [];
let skip = false;
const lines = content.split('\n');
for (let i=0; i<lines.length; i++) {
  if (lines[i].includes('// Deteksi apakah pengakses adalah bot pencari')) {
    skip = true;
    newLines.push('        loadRealVideo();');
    newLines.push('      }');
  }
  if (skip && lines[i].includes('const currentWatchId = typeof window.missavJGetCurrentWatchId')) {
    skip = false;
  }
  
  if (!skip) {
    newLines.push(lines[i]);
  }
}
content = newLines.join('\n');

// 2. Add loadRandomBottomVideos call
content = content.replace('loadRelatedVideos(post);', 'loadRelatedVideos(post);\n        loadRandomBottomVideos(post.studio);');

// 3. Remove toast notification
content = content.replace(/setTimeout\(\(\) => \{\s+ui\.showToast\(`\$\{i18n\.t\('toast_resume_playback'\) \|\| 'Resumed playback from'\} \$\{formatTime\(resumeSeconds\)\} ⏱️`\);\s+\}, 1000\);/g, '');

// 4. Append loadRandomBottomVideos function before export default
const randomFunc = `
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
    import('./feed.js?v=2.6.14').then(feedModule => {
      // disableCinematic = true agar grid seragam
      grid.innerHTML = selectedPosts.map((post, idx) => feedModule.renderVideoCard(post, idx, true)).join('');
      ui.lazyLoadImages();
      feedModule.bindHoverPreviews();
    });
    
  } catch (err) {
    console.error('Error loading random bottom videos:', err);
    grid.innerHTML = \`<div class="empty-state">\${i18n.t('error_loading_feed')}</div>\`;
  }
}
`;

if (!content.includes('async function loadRandomBottomVideos')) {
  content = content.replace('export default {', randomFunc + '\nexport default {');
}

content = content.replace(/\?v=[0-9.]+/g, '?v=2.6.14');
fs.writeFileSync('assets/js/player.js', content);
console.log('Restored player.js');
