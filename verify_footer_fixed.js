const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Set viewport for a standard 1080p display
  await page.setViewportSize({ width: 1920, height: 1080 });

  const filePath = 'file://' + path.resolve('docs/test_footer_v2.html');
  await page.goto(filePath);

  // Wait for the custom element to be defined and rendered
  await page.waitForSelector('menutech-footer');
  // Wait a bit for the internal shadow DOM to render
  await new Promise(r => setTimeout(r, 500));

  await page.screenshot({ path: 'verification/footer_fixed.png', fullPage: true });

  // Verify English label "Opening" exists in shadow DOM
  const footer = await page.locator('menutech-footer');
  const openingLabel = await footer.evaluate(el => {
    return el.shadowRoot.querySelector('h3').textContent;
  });

  console.log('Detected Header in Footer:', openingLabel);
  if (openingLabel === 'Opening') {
    console.log('Verification SUCCESS: Label is "Opening"');
  } else {
    console.log('Verification FAILED: Label is', openingLabel);
    process.exit(1);
  }

  await browser.close();
})();
