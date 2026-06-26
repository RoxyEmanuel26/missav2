const fs = require('fs');
const path = require('path');

function replaceInDir(dir, from, to) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      replaceInDir(fullPath, from, to);
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

replaceInDir(path.join(__dirname, 'assets'), '?v=2.3.2', '?v=2.3.2');
replaceInDir(__dirname, '?v=2.3.2', '?v=2.3.2');

// Also update sw.js CACHE_NAME
const swPath = path.join(__dirname, 'sw.js');
let swContent = fs.readFileSync(swPath, 'utf8');
swContent = swContent.replace('missavj-cache-v2.3.1', 'missavj-cache-v2.3.2');
swContent = swContent.replace(/v=2\.3\.1/g, 'v=2.3.2');
fs.writeFileSync(swPath, swContent, 'utf8');
console.log('Updated sw.js CACHE_NAME');
