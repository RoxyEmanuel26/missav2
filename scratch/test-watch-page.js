const puppeteer = require('puppeteer');

(async () => {
  console.log("Launching Puppeteer browser...");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  let hasErrors = false;
  
  page.on('console', msg => {
    const text = msg.text();
    console.log(`[PAGE LOG] [${msg.type().toUpperCase()}]: ${text}`);
    if (msg.type() === 'error' || text.toLowerCase().includes('failed to load') || text.toLowerCase().includes('is not defined')) {
      hasErrors = true;
    }
  });
  
  page.on('pageerror', error => {
    console.error(`[PAGE ERROR]: ${error.message}`);
    hasErrors = true;
  });

  page.on('requestfailed', request => {
    const url = request.url();
    if (!url.includes('google-analytics') && !url.includes('doubleclick') && !url.includes('googlesyndication')) {
      console.error(`[REQUEST FAILED]: ${url} - ${request.failure().errorText}`);
    }
  });

  const routesToCheck = [
    'http://127.0.0.1:8788/',
    'http://127.0.0.1:8788/en/trending',
    'http://127.0.0.1:8788/en/recent',
    'http://127.0.0.1:8788/en/categories',
    'http://127.0.0.1:8788/en/actors',
    'http://127.0.0.1:8788/en/studios',
    'http://127.0.0.1:8788/en/history',
    'http://127.0.0.1:8788/en/search?q=tokyo'
  ];

  try {
    for (const route of routesToCheck) {
      console.log(`\n--- Testing route: ${route} ---`);
      await page.goto(route, { waitUntil: 'networkidle2', timeout: 15000 });
      console.log(`Successfully navigated to: ${route}`);
      
      // Let it run for 2 seconds to capture any delayed client-side runtime errors
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const content = await page.content();
      if (content.includes("Oops! Something went wrong")) {
        console.error(`FAIL: ${route} shows error banner!`);
        hasErrors = true;
      }
    }

    // Now test watch page specifically by clicking a video card from homepage
    console.log(`\n--- Testing watch page navigation ---`);
    await page.goto('http://127.0.0.1:8788/', { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForSelector('.card-main-link', { timeout: 10000 });
    
    // Get the href of the first video card
    const firstCardHref = await page.evaluate(() => {
      const link = document.querySelector('.card-main-link');
      return link ? link.href : null;
    });
    console.log(`First video card URL is: ${firstCardHref}`);

    if (!firstCardHref) {
      throw new Error("No video card links found!");
    }

    // Click the first card
    console.log("Clicking the first video card link...");
    await Promise.all([
      page.click('.card-main-link'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {
        console.log("Navigation resolved or completed client-side.");
      })
    ]);

    console.log("Waiting 5 seconds on watch page for JS execution and errors...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    const content = await page.content();
    if (content.includes("Oops! Something went wrong") || content.includes("Failed to load watch page")) {
      console.error("FAIL: Watch page shows error banner!");
      hasErrors = true;
    } else {
      console.log("SUCCESS: Watch page loaded without error banners.");
    }

  } catch (error) {
    console.error(`[TEST ERROR]: ${error.message}`);
    hasErrors = true;
  } finally {
    await browser.close();
    console.log("Browser closed.");
    process.exit(hasErrors ? 1 : 0);
  }
})();
