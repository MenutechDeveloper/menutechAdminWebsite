const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  // Mock data and bypass auth
  await page.addInitScript(() => {
    localStorage.setItem('mt_test_mode', 'true');
    window.menuData = {
      config: {
        categories: [
          {
            name: "Starters",
            dishes: [
              { name: "Mock Dish 1", price: "10", description: "Delicious mock starter" }
            ]
          },
          {
            name: "Main Course",
            dishes: [
              { name: "Mock Dish 2", price: "20", description: "Hearty mock main" }
            ]
          }
        ]
      },
      cover_url: "https://menutech.services/assets/img/logomt.png"
    };
    window.restaurantInfo = {
      name: "Mock Restaurant",
      logo_url: "https://menutech.services/assets/img/logomt.png",
      address: "123 Mock St",
      phone: "555-0000"
    };
  });

  await page.goto('http://localhost:8080/docs/physicalMenu.html');

  // Helper to capture a design
  async function captureDesign(id, filename) {
    console.log(`Capturing ${id}...`);
    await page.evaluate((tid) => {
        const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.innerText.includes(tid.replace('diseno', '')));
        window.switchTemplate(tid, btn);
    }, id);

    // Wait for elements to be rendered on canvas
    await page.waitForFunction(() => document.querySelectorAll('#menu-canvas .canvas-element').length > 0);
    await page.waitForTimeout(1000); // Wait for transitions
    await page.screenshot({ path: path.join(__dirname, 'verification', filename), fullPage: true });
  }

  // Ensure verification directory exists
  const fs = require('fs');
  if (!fs.existsSync('verification')) fs.mkdirSync('verification');

  await captureDesign('diseno1', 'final_diseno1.png');
  await captureDesign('diseno2', 'final_diseno2.png');
  await captureDesign('diseno3', 'final_diseno3.png');

  await browser.close();
})();
