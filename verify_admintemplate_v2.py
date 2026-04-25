import asyncio
from playwright.async_api import async_playwright
import time
import os
import subprocess

async def run_test():
    # Start a simple HTTP server to serve the docs directory
    server_process = subprocess.Popen(["python3", "-m", "http.server", "8080"], cwd="docs")
    time.sleep(2) # Wait for server to start

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        print("Navigating to adminTemplate.html...")
        start_time = time.time()

        try:
            await page.goto("http://localhost:8080/adminTemplate.html", timeout=10000)
        except Exception as e:
            print(f"Navigation error: {e}")

        # Wait up to 3 seconds for the loading overlay to be hidden
        print("Waiting for loading overlay to disappear...")
        try:
            # We check if it is hidden OR removed from DOM (display: none is set by my script)
            # The wait_for_selector(..., state="hidden") checks for display:none
            await page.wait_for_selector("#loading-overlay", state="hidden", timeout=5000)
            elapsed = time.time() - start_time
            print(f"Loading overlay hidden after {elapsed:.2f} seconds.")
        except Exception as e:
            print(f"Loading overlay still visible: {e}")
            await page.screenshot(path="loading_still_there.png")

        # Take a final screenshot
        await page.screenshot(path="docs/verify_v2.png")

        await browser.close()

    server_process.terminate()

if __name__ == "__main__":
    asyncio.run(run_test())
