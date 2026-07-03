const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Set viewport to a large size to capture the designer
  await page.setViewportSize({ width: 1600, height: 1200 });

  // Navigate to physicalMenu.html
  // We'll use a data URL for the config and supabase to mock the session
  await page.goto('file://' + process.cwd() + '/docs/physicalMenu.html');

  // Wait for loading overlay to disappear (3s + buffer)
  await page.waitForTimeout(4000);

  // Check if designer workspace is visible
  const workspaceVisible = await page.isVisible('#designer-workspace');
  console.log('Designer Workspace Visible:', workspaceVisible);

  // Switch to preview mode
  await page.click('#btn-toggle-mode');
  await page.waitForTimeout(2000);

  // Check if preview container is active
  const previewActive = await page.isVisible('#preview-container.active');
  console.log('Preview Container Active:', previewActive);

  // Capture screenshot of preview mode
  await page.screenshot({ path: 'verification_updated_designer.png' });

  await browser.close();
})();
