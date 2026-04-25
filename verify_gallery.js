const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 1200 });

  // Go to the admin page
  await page.goto('file://' + process.cwd() + '/docs/adminTemplate.html');

  // Wait for loading to finish
  await page.waitForSelector('#loading-overlay', { state: 'hidden' });

  // Scroll the iframe to the gallery section
  const frame = page.frameLocator('#preview-iframe');
  await frame.locator('#gallery').scrollIntoViewIfNeeded();

  // Wait a bit for images to load (though they are just placeholders/the same image)
  await page.waitForTimeout(1000);

  await page.screenshot({ path: '/home/jules/verification/gallery_desktop.png' });

  // Toggle mobile
  await page.click('button:has-text("MOBILE")');
  await page.waitForTimeout(500);
  await frame.locator('#gallery').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/home/jules/verification/gallery_mobile.png' });

  await browser.close();
})();
