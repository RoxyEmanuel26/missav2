const fs = require('fs');
let content = fs.readFileSync('assets/js/player.js', 'utf8');

const regex = /<img\s+src="\$\{safeThumbnail \|\| SVG_FALLBACK_THUMB\}"\s+alt="\$\{safeTitle\}"\s+width="320"\s+height="180"\s+style="aspect-ratio: 16\/9; background: #000;"\s+loading="lazy"\s+decoding="async"\s+onerror="this\.onerror=null; this\.src='(?:\\\$)?\{SVG_FALLBACK_THUMB\}';">/g;

const replacement = `<img 
          src="\${safeThumbnail || SVG_FALLBACK_THUMB}" 
          alt="\${safeTitle}" 
          width="320"
          height="180"
          style="aspect-ratio: 16/9; background: #000;"
          loading="lazy"
          decoding="async"
          onerror="if(this.src !== '\${(post.thumbnail || \\'\\').replace(/\\'/g, \\"\\\\\\\\\\"\\")}') { this.src='\${(post.thumbnail || \\'\\').replace(/\\'/g, \\"\\\\\\\\\\"\\")}'; } else { this.onerror=null; this.src='\${SVG_FALLBACK_THUMB}'; }">`;

content = content.replace(regex, replacement);

fs.writeFileSync('assets/js/player.js', content);
console.log('player.js updated');
