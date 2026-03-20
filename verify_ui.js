const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.addInitScript(() => {
    window.supabase = {
      auth: {
        getSession: () => Promise.resolve({ data: { session: { user: {
          id: '123', email: 'admin@test.com', user_metadata: { username: 'antonio', role: 'admin' }, email_confirmed_at: '2023-01-01'
        } } } }),
        onAuthStateChange: (cb) => { cb('SIGNED_IN', { user: { id: '123' } }); return { data: { subscription: { unsubscribe: () => {} } } }; }
      },
      from: (table) => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: { role: 'admin', username: 'antonio' }, error: null })
          }),
          order: () => Promise.resolve({ data: [], error: null })
        })
      })
    };
  });

  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/home/jules/verification/pill_new.png' });

  await page.goto('http://localhost:8000/adminWeb.html');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/home/jules/verification/sidebar_collapsed.png' });

  // Click tab to open
  await page.click('#sidebar-tab');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/jules/verification/sidebar_open.png' });

  await browser.close();
})();
