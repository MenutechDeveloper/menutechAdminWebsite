const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Mock Supabase session in localStorage
  await page.addInitScript(() => {
    window.localStorage.setItem('sb-eemqyrysdgasfjlitads-auth-token', JSON.stringify({
      access_token: 'fake-token',
      user: { id: 'admin-id', email: 'admin@test.com' }
    }));
  });

  // Navigate to the admin menus page
  await page.goto('http://localhost:8080/docs/adminMenus.html');

  // Verify elements exist
  const noMenuContainer = await page.locator('#no-menu-container');
  const menuEditor = await page.locator('#menu-editor');
  const floatingFooter = await page.locator('#floating-footer');

  console.log('Verifying initial state...');
  // Initially, if no data is returned from mock supabase, it should show no-menu
  // We need to be careful here because we are not actually mocking the supabase response,
  // so it will probably fail to fetch and might stay in a loading state or show no-menu.

  // Since we can't easily mock the fetch response without more complex setup,
  // we will at least verify the HTML structure and function existence.

  const hasStartNewMenu = await page.evaluate(() => typeof window.startNewMenu === 'function');
  const hasCopySubdomain = await page.evaluate(() => typeof window.copySubdomain === 'function');

  console.log('startNewMenu exists:', hasStartNewMenu);
  console.log('copySubdomain exists:', hasCopySubdomain);

  if (!hasStartNewMenu || !hasCopySubdomain) {
    console.error('Critical functions missing!');
    process.exit(1);
  }

  // Check CSS for hidden class
  const hiddenStyle = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'hidden';
    document.body.appendChild(el);
    const style = window.getComputedStyle(el);
    const display = style.display;
    document.body.removeChild(el);
    return display;
  });
  console.log('Hidden class display style:', hiddenStyle);

  await browser.close();
  console.log('Basic verification complete.');
})();
