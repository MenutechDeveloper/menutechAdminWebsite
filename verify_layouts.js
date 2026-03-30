const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Create a simple HTTP server to serve the root directory
  const { createServer } = require('http');
  const server = createServer((req, res) => {
    let filePath = path.join(process.cwd(), req.url);
    if (filePath === process.cwd() + '/') filePath = path.join(process.cwd(), 'test_layouts.html');

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end(JSON.stringify(err));
        return;
      }
      res.writeHead(200);
      res.end(data);
    });
  });

  server.listen(8080);

  // Desktop View
  await page.setViewportSize({ width: 1280, height: 2500 });
  await page.goto('http://localhost:8080/test_layouts.html');
  await page.waitForTimeout(2000); // Wait for Swiper and images to load
  await page.screenshot({ path: 'verify_desktop.png', fullPage: true });

  // Mobile View
  await page.setViewportSize({ width: 375, height: 3500 });
  await page.goto('http://localhost:8080/test_layouts.html');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'verify_mobile.png', fullPage: true });

  await browser.close();
  server.close();
  console.log('Screenshots saved: verify_desktop.png, verify_mobile.png');
})();
