const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log(`[PAGE LOG] ${msg.type().toUpperCase()}: ${msg.text()}`));
  
  page.on('pageerror', error => {
    console.error(`[PAGE ERROR] ${error.message}`);
  });

  page.on('requestfailed', request => {
    // Ignore images or tracking scripts failure to not clutter
    if (request.resourceType() === 'image') return;
    console.error(`[REQUEST FAILED] ${request.url()} - ${request.failure()?.errorText || 'unknown'}`);
  });

  try {
    await page.goto('http://127.0.0.1:8788/', { waitUntil: 'networkidle0', timeout: 10000 });
    console.log("Page loaded successfully.");
  } catch (error) {
    console.error(`[NAVIGATION ERROR] ${error.message}`);
  }

  await browser.close();
})();
