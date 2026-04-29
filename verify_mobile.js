const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 375, height: 667 }
  });
  await page.goto('http://localhost:8080/docs/templateMenutech.html');
  await page.waitForTimeout(2000); // Wait for scripts/components to load
  await page.screenshot({ path: '/home/jules/verification/template_mobile.png' });

  const buttonsBox = await page.locator('.hero-buttons').boundingBox();
  console.log('Hero Buttons Box:', buttonsBox);

  const ordersBox = await page.locator('menutech-orders').boundingBox();
  const resBox = await page.locator('menutech-reservations').boundingBox();

  console.log('Orders Box:', ordersBox);
  console.log('Reservations Box:', resBox);

  if (resBox.y > ordersBox.y) {
    console.log('Mobile Verification: Buttons are stacked vertically.');
  } else {
    console.log('Mobile Verification: Buttons are NOT stacked vertically.');
  }

  await browser.close();
})();
