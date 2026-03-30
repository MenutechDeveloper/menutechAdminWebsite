from playwright.sync_api import sync_playwright, expect
import os

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # 1. Desktop Verification
        context = browser.new_context(viewport={'width': 1200, 'height': 1200})
        page = context.new_page()

        # Path to test_layouts.html
        file_path = f"file://{os.getcwd()}/test_layouts.html"
        page.goto(file_path)

        # Wait for the Bento gallery in admin mode to render
        admin_gallery = page.locator('#bento-admin menutech-gallery')
        admin_gallery.wait_for()

        # Screenshot initial desktop state
        page.screenshot(path="/home/jules/verification/bento_desktop_init.png", full_page=True)

        # Test Resizing (Bottom-Right)
        # We need to make sure we are looking inside the shadow DOM
        first_item = admin_gallery.locator('.gallery-item').first
        handle_br = first_item.locator('.handle-br')

        # Hover to make handles visible
        first_item.hover()

        # Drag handle-br to the right
        box = handle_br.bounding_box()
        if box:
            page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
            page.mouse.down()
            page.mouse.move(box['x'] + 200, box['y'] + 150)
            page.mouse.up()
            page.screenshot(path="/home/jules/verification/bento_desktop_resized_br.png")
        else:
            print("Could not find handle-br bounding box")

        # 2. Mobile Verification
        mobile_context = browser.new_context(viewport={'width': 375, 'height': 800}, is_mobile=True)
        mobile_page = mobile_context.new_page()
        mobile_page.goto(file_path)

        mobile_page.locator('#bento menutech-gallery').wait_for()

        # Screenshot mobile state
        mobile_page.screenshot(path="/home/jules/verification/bento_mobile.png", full_page=True)

        browser.close()

if __name__ == "__main__":
    os.makedirs("/home/jules/verification", exist_ok=True)
    run_verification()
