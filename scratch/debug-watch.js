const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('BROWSER ERROR:', msg.text());
      if (msg.args().length > 0) {
        msg.args().forEach(arg => console.log(arg.toString()));
      }
    } else {
      console.log('BROWSER LOG:', msg.text());
    }
  });

  page.on('pageerror', error => {
    console.log('PAGE ERROR:', error.message);
    console.log('STACK:', error.stack);
  });

  try {
    await page.goto('http://127.0.0.1:8788');
    await page.waitForSelector('.video-card');
    
    console.log('Clicking a video...');
    const video = await page.$('.video-card');
    await video.click();
    
    await new Promise(r => setTimeout(r, 2000));
    
  } catch (err) {
    console.error('Puppeteer Error:', err);
  } finally {
    await browser.close();
  }
})();
