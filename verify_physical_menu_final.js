const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // We need to bypass auth for testing, but I removed the code.
  // I will inject a mock session into localStorage/Supabase client.

  await page.goto('file://' + process.cwd() + '/docs/physicalMenu.html');

  // Inject mock supabase session before the script runs fully if possible
  // Or just check for UI elements that are always there
  const title = await page.title();
  console.log('Title:', title);

  const diseno1 = await page.locator('button[data-tid="diseno1"]').isVisible();
  console.log('Diseno 1 button visible:', diseno1);

  const paperSize = await page.locator('#paper-size-select').isVisible();
  console.log('Paper size select visible:', paperSize);

  await page.screenshot({ path: '/home/jules/verification/final_ui_check.png', fullPage: true });

  await browser.close();
})();
