const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== '.wrangler' && file !== '.agents') {
        getFiles(filePath, fileList);
      }
    } else if (file.endsWith('.js')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const jsFiles = [
  ...getFiles(path.join(__dirname, '..', 'assets', 'js')),
  path.join(__dirname, '..', 'sw.js'),
  path.join(__dirname, '..', 'update-cache-version.js')
];

console.log(`Found ${jsFiles.length} JavaScript files to check.`);
let hasError = false;

for (const file of jsFiles) {
  try {
    execSync(`node --check "${file}"`, { stdio: 'pipe' });
    console.log(`[PASS] ${path.relative(path.join(__dirname, '..'), file)}`);
  } catch (err) {
    console.error(`[FAIL] ${path.relative(path.join(__dirname, '..'), file)}`);
    console.error(err.stderr.toString());
    hasError = true;
  }
}

if (hasError) {
  process.exit(1);
} else {
  console.log('All files passed syntax check!');
}
