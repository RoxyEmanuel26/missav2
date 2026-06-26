const puppeteer = require('puppeteer');

(async () => {
  console.log("Launching Puppeteer browser...");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  // Mock document.hidden to be false so playback tracker runs in headless mode
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(document, 'hidden', { value: false });
  });

  let hasErrors = false;
  let resumeLogTriggered = false;
  
  page.on('console', msg => {
    const text = msg.text();
    console.log(`[PAGE LOG] [${msg.type().toUpperCase()}]: ${text}`);
    if (text.includes('[Playback Resume] Seeking to')) {
      resumeLogTriggered = true;
    }
    if (msg.type() === 'error' && !text.includes('SlowRouteTransition')) {
      hasErrors = true;
    }
  });
  
  page.on('pageerror', error => {
    console.error(`[PAGE ERROR]: ${error.message}`);
    hasErrors = true;
  });

  try {
    console.log("Navigating to homepage http://127.0.0.1:8788/ ...");
    await page.goto('http://127.0.0.1:8788/', { waitUntil: 'networkidle2', timeout: 15000 });
    
    // Wait for feed to load
    await page.waitForSelector('.card-main-link', { timeout: 10000 });
    console.log("Homepage loaded successfully. Clicking first video...");

    // Click the first card to watch
    await page.click('.card-main-link');

    // Wait for the active video state to be populated (meaning SPA route transition and API calls completed)
    console.log("Waiting for watch page API to load post details...");
    await page.waitForFunction(() => window.missavJState && window.missavJState.activeVideo, { timeout: 10000 });
    console.log("Watch page loaded and active video set.");

    console.log("Simulating play click to start playback tracker...");
    await page.waitForSelector('#poster-play-btn', { timeout: 10000 });
    await page.click('#poster-play-btn');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const posterExists = await page.evaluate(() => {
      const poster = document.getElementById('player-custom-poster');
      return !!poster;
    });
    if (posterExists) {
      console.log("Poster still visible (first click hit ad overlay), clicking play button again...");
      await page.click('#poster-play-btn');
    }

    // Wait 10 seconds to accumulate watched progress
    console.log("Simulating watch progress... Waiting 10 seconds...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Log localStorage before navigating
    const localHistory = await page.evaluate(() => localStorage.getItem('missavj_watch_history'));
    console.log(`[LocalStorage History before navigation]: ${localHistory}`);

    const historyObj = JSON.parse(localHistory || '[]');
    if (historyObj.length === 0 || historyObj[0].watchedTime === 0) {
      throw new Error("Watched time progress was NOT saved/incremented in localStorage!");
    }
    console.log(`Watched time is recorded as: ${historyObj[0].watchedTime}s`);

    // Navigate back to home page
    console.log("Navigating back to homepage...");
    await page.goto('http://127.0.0.1:8788/', { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(resolve => setTimeout(resolve, 2000)); // wait for client-side rendering

    // Verify continue watching section is rendered
    console.log("Checking Continue Watching section...");
    const sectionExists = await page.evaluate(() => {
      const section = document.querySelector('.continue-watching-section');
      return !!section;
    });
    
    if (!sectionExists) {
      throw new Error("Continue Watching section was NOT rendered on the homepage!");
    }
    console.log("Continue Watching section is present.");

    // Verify progress bar is rendered inside the card
    const progressBarExists = await page.evaluate(() => {
      const bar = document.querySelector('.history-progress-bar');
      return !!bar;
    });
    
    if (!progressBarExists) {
      throw new Error("Progress bar was NOT rendered on the history card!");
    }
    console.log("Progress bar is visible on the history card.");

  } catch (error) {
    console.error(`[TEST ERROR]: ${error.message}`);
    hasErrors = true;
  } finally {
    await browser.close();
    console.log("Browser closed.");
    process.exit(hasErrors ? 1 : 0);
  }
})();
