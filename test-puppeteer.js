const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log(`PAGE LOG [${msg.type()}]:`, msg.text());
  });
  
  page.on('pageerror', error => {
    console.log(`PAGE ERROR:`, error.message);
  });
  
  page.on('requestfailed', request => {
    console.log(`REQUEST FAILED: ${request.url()} - ${request.failure().errorText}`);
  });

  try {
    await page.goto('http://127.0.0.1:8788/', { waitUntil: 'networkidle2', timeout: 10000 });
    console.log('Page loaded successfully!');
  } catch (err) {
    console.log('Error navigating to page:', err.message);
  }

  await browser.close();
})();
