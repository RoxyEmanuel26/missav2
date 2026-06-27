const fs = require('fs');

const version = '?v=2.6.15';
const swVersion = 'missavj-cache-v2.6.15';

function bumpFile(filename, regex, newVer) {
  try {
    let content = fs.readFileSync(filename, 'utf8');
    content = content.replace(regex, newVer);
    fs.writeFileSync(filename, content);
    console.log(`Bumped ${filename}`);
  } catch (err) {
    console.error(`Error in ${filename}:`, err);
  }
}

const fileRegex = /\?v=[0-9.]+/g;
bumpFile('assets/js/app.js', fileRegex, version);
bumpFile('assets/js/feed.js', fileRegex, version);
bumpFile('assets/js/player.js', fileRegex, version);
bumpFile('assets/js/api.js', fileRegex, version);
bumpFile('assets/js/ui.js', fileRegex, version);
bumpFile('index.html', fileRegex, version);

bumpFile('sw.js', /missavj-cache-v[0-9.]+/g, swVersion);
