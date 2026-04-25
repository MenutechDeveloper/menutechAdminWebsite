import asyncio
from playwright.async_api import async_playwright
import os

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page = await context.new_page()

        # Listen for console messages
        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))

        print("Navigating to page...")
        await page.goto("http://localhost:8001/docs/adminTemplate.html")

        # Wait for loading overlay to disappear
        print("Waiting for loading overlay...")
        await page.wait_for_selector("#loading-overlay", state="hidden", timeout=10000)

        os.makedirs("verification", exist_ok=True)
        await page.screenshot(path="verification/step1_load.png")
        print("Screenshot 1 saved.")

        # Check window.setLang
        exists = await page.evaluate("typeof window.setLang")
        print(f"window.setLang type: {exists}")

        # Check current language button status
        en_active = await page.evaluate("document.getElementById('lang-en-btn').classList.contains('active')")
        es_active = await page.evaluate("document.getElementById('lang-es-btn').classList.contains('active')")
        print(f"Initial - EN active: {en_active}, ES active: {es_active}")

        # Click ES button
        print("Clicking ES button...")
        await page.click("#lang-es-btn")

        # Wait a bit
        await asyncio.sleep(1)
        await page.screenshot(path="verification/step2_es_clicked.png")
        print("Screenshot 2 saved.")

        # Check label text
        label_text = await page.inner_text("label[data-i18n='generalSettings']")
        print(f"General Settings label text: {label_text}")

        # Type in phone
        print("Typing phone number...")
        await page.fill("#contact-phone", "123456789")
        await asyncio.sleep(0.5)
        await page.screenshot(path="verification/step3_phone_typed.png")
        print("Screenshot 3 saved.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
