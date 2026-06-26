const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  await page.goto('http://127.0.0.1:8788/', { waitUntil: 'networkidle0' });
  
  const html = await page.evaluate(() => {
    const cards = document.querySelectorAll('.video-card');
    if (cards.length === 0) return 'NO CARDS FOUND';
    
    // Return outer HTML of first 3 cards to debug layout
    return Array.from(cards).slice(0, 3).map(c => c.outerHTML).join('\n\n');
  });
  
  console.log(html);
  
  // Let's also check if any images have weird dimensions
  const dims = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.video-card')).slice(0, 3).map(c => {
      const rect = c.getBoundingClientRect();
      const img = c.querySelector('img');
      const imgRect = img ? img.getBoundingClientRect() : null;
      return `Card: ${rect.width}x${rect.height}, Img: ${imgRect ? imgRect.width + 'x' + imgRect.height : 'none'}`;
    });
  });
  
  console.log('\nDimensions:', dims);

  await browser.close();
})();
