
import asyncio
from playwright.async_api import async_playwright
import os

async def verify_final():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': 1280, 'height': 1000})

        content = """
        <!DOCTYPE html>
        <html>
        <head>
            <style>body { margin: 0; background: #eee; }</style>
        </head>
        <body>
            <div style="height: 300px; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: #999;">
                Page Content Above Footer
            </div>
            <menutech-footer
                brand="ELITE DINING"
                address="Paseo de la Reforma 296, Juárez, 06600 Ciudad de México"
                phone="+52 55 1234 5678"
                facebook="https://facebook.com"
                instagram="https://instagram.com"
                customcode='<button style="background:#ff9533; color:white; border:none; padding:15px; border-radius:12px; font-weight:bold; cursor:pointer; width:100%;">ORDER ONLINE</button>'
                schedules="Monday - Friday: 08:00 AM - 11:00 PM\nSaturday - Sunday: 10:00 AM - 01:00 AM"
                bgimage="https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=2070"
            ></menutech-footer>
            <script src="docs/menutechUI.js"></script>
        </body>
        </html>
        """

        with open('final_verify.html', 'w') as f:
            f.write(content)

        await page.goto(f'file://{os.path.abspath("final_verify.html")}')
        await page.wait_for_timeout(1000)

        await page.screenshot(path='final_footer_screenshot.png', full_page=True)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify_final())
