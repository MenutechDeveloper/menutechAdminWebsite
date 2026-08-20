const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const assert = require('assert');

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? 'docs/extractor.html' : req.url);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html');
    if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'text/javascript');
    res.writeHead(200);
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = 8089;

server.listen(PORT, async () => {
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/docs/extractor.html`);

    await page.waitForFunction(() => typeof window.exportCanvaSVG === 'function');

    await page.evaluate(() => {
      window.extractedData = {
        restaurant: {
          name: 'Tacos El Rey',
          address: 'Av. Principal 123',
          phone: '555-0199',
          hours: '10:00 - 22:00',
          websiteUrl: 'https://example.com'
        },
        categories: [
          {
            name: 'Tacos',
            dishes: [
              { name: 'Taco al Pastor', description: 'Delicioso taco de carne adobada', price: '$25.00', sizes: [], extras: [], image: '' },
              { name: 'Taco de Bisteck', description: 'Taco de jugosa carne asada', price: '$30.00', sizes: [], extras: [], image: '' }
            ]
          }
        ],
        allImages: []
      };
      document.getElementById('results-wrapper').style.display = 'block';
    });

    const canvaBtn = page.locator('button:has-text("Descargar para Canva")');
    const isVisible = await canvaBtn.isVisible();
    assert.strictEqual(isVisible, true, 'Descargar para Canva button should be visible');

    const result = await page.evaluate(() => {
      let downloadedContent = null;
      let downloadedFilename = null;

      const origAppendChild = document.body.appendChild.bind(document.body);
      document.body.appendChild = (node) => {
        if (node.tagName === 'A' && node.download) {
          downloadedFilename = node.download;
        }
        return origAppendChild(node);
      };

      const origBlob = window.Blob;
      window.Blob = function(parts, options) {
        if (options && options.type === 'image/svg+xml') {
          downloadedContent = parts.join('');
        }
        return new origBlob(parts, options);
      };

      window.exportCanvaSVG();

      return {
        svg: downloadedContent,
        filename: downloadedFilename
      };
    });

    assert.strictEqual(result.filename, 'canva_tacos_el_rey.svg');
    assert.ok(result.svg.includes('Tacos El Rey'), 'SVG contains restaurant name');
    assert.ok(result.svg.includes('Dirección: Av. Principal 123'), 'SVG contains address');
    assert.ok(result.svg.includes('Tel: 555-0199'), 'SVG contains phone');
    assert.ok(result.svg.includes('Taco al Pastor'), 'SVG contains dish name');
    assert.ok(result.svg.includes('$25.00'), 'SVG contains price');
    assert.strictEqual(result.svg.includes('<style>'), false, 'SVG does not contain style tags');

    console.log('Test passed successfully!');
    await browser.close();
    server.close();
  } catch (err) {
    console.error('Test failed:', err);
    if (server) server.close();
    process.exit(1);
  }
});
