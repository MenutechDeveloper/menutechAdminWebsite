const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Set viewport to desktop
  await page.setViewportSize({ width: 1280, height: 800 });

  // Navigate to adminMenus.html
  // We need to bypass auth for screenshot, so we'll use our previous trick
  await page.goto('http://localhost:8000/adminMenus.html');

  // Mock session and profile
  await page.evaluate(() => {
    localStorage.setItem('sb-eemqyrysdgasfjlitads-auth-token', JSON.stringify({
      access_token: 'mock',
      refresh_token: 'mock',
      user: { id: 'mock-id', email: 'test@example.com' }
    }));

    // Inject a profile and trigger showApp manually since we can't easily mock Supabase responses here
    const mockProfile = {
        id: 'mock-id',
        username: 'La Salsita Pinchi',
        domain: 'lasalsitapinchi.com',
        role: 'admin'
    };

    // Override loadMenu to just render empty
    window.loadMenu = async () => {
        window.menuData = { cover_url: '', cover_type: 'image', menu_style: 'mode1', config: { categories: [], toppings: [] } };
        window.renderMenuEditor();
    };

    window.showApp(mockProfile);
  });

  await page.waitForTimeout(1000);

  await page.screenshot({ path: '/home/jules/verification/admin_menus_fixed.png' });

  await browser.close();
})();
