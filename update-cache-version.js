const fs = require('fs');
const path = require('path');

function replaceInDir(dir, from, to) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== '.vscode') {
        replaceInDir(fullPath, from, to);
      }
    } else if (stat.isFile() && (fullPath.endsWith('.js') || fullPath.endsWith('.css') || fullPath.endsWith('.html'))) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes(from)) {
        content = content.split(from).join(to);
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}

const oldVersion = '2.6.1';
const newVersion = '2.6.2';

// Replace ?v= strings across all files
replaceInDir(path.join(__dirname, 'assets'), `?v=${oldVersion}`, `?v=${newVersion}`);
replaceInDir(__dirname, `?v=${oldVersion}`, `?v=${newVersion}`);

// Also update sw.js CACHE_NAME specifically
const swPath = path.join(__dirname, 'sw.js');
let swContent = fs.readFileSync(swPath, 'utf8');
swContent = swContent.replace(`missavj-cache-v${oldVersion}`, `missavj-cache-v${newVersion}`);
fs.writeFileSync(swPath, swContent, 'utf8');
console.log(`Updated sw.js CACHE_NAME to missavj-cache-v${newVersion}`);
