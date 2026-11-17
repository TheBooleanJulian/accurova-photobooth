"""End-to-end test of the visitor flow in a real browser.

SIMULATED: Chrome's fake camera and the API's mock segmenter. It proves the
screens, session store, pipeline, compositing and delivery work together; it
says nothing about a real camera or a real segmentation model.

Needs a running kiosk (KIOSK_URL) built against a running API with
PHOTOBOOTH_SEGMENTATION_PROVIDER=mock. CHROME_PATH selects the browser binary;
without it Playwright uses the installed Google Chrome channel.

    python tests/e2e/kiosk_flow.py
"""

import os
import sys
import time

from playwright.sync_api import expect, sync_playwright

KIOSK_URL = os.environ.get("KIOSK_URL", "http://localhost:5173")
TEMPLATE = os.environ.get("TEMPLATE_ID", "little-red-dot-tours")
SHOTS = os.environ.get("SCREENSHOT_DIR")


def main() -> int:
    with sync_playwright() as p:
        launch = {
            "args": ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--no-sandbox"],
        }
        if os.environ.get("CHROME_PATH"):
            launch["executable_path"] = os.environ["CHROME_PATH"]
        else:
            launch["channel"] = "chrome"
        browser = p.chromium.launch(**launch)
        context = browser.new_context(viewport={"width": 834, "height": 1112}, permissions=["camera"], has_touch=True)
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        shot = lambda name: SHOTS and page.screenshot(path=os.path.join(SHOTS, f"{name}.png"))  # noqa: E731

        page.goto(f"{KIOSK_URL}/kiosk/{TEMPLATE}")
        start = page.get_by_role("button", name="Start")
        expect(start).to_be_visible(timeout=20_000)
        shot("1-welcome")

        # Language switch changes the visitor copy.
        page.get_by_role("button", name="中文").click()
        expect(page.get_by_role("button", name="开始")).to_be_visible()
        page.get_by_role("button", name="English").click()

        start.click()
        page.get_by_role("button", name="I'm ready").click()
        take = page.get_by_role("button", name="Take photo")
        expect(take).to_be_enabled(timeout=15_000)
        shot("2-camera")

        # Capture, retake, capture again.
        take.click()
        expect(page.get_by_text("Happy with this photo?")).to_be_visible(timeout=15_000)
        page.get_by_role("button", name="Retake").click()
        expect(take).to_be_enabled(timeout=15_000)
        take.click()
        expect(page.get_by_text("Happy with this photo?")).to_be_visible(timeout=15_000)
        shot("3-review")
        page.get_by_role("button", name="Use this photo").click()

        # Choose a backdrop, then survive a Safari-style reload.
        choice = page.get_by_role("button", name="Peranakan shophouse street")
        choice.click()
        page.reload()
        expect(choice).to_have_attribute("aria-pressed", "true", timeout=15_000)
        shot("4-background")

        page.get_by_role("button", name="Continue").click()
        started = time.time()
        expect(page.get_by_text("Scan to download")).to_be_visible(timeout=60_000)
        print(f"processing took {time.time() - started:.1f}s")
        expect(page.locator("main svg path").first).to_be_attached()  # the QR code
        shot("5-result")

        page.get_by_role("button", name="Done").click()
        expect(page.get_by_text("Thank you!")).to_be_visible()
        expect(start).to_be_visible(timeout=15_000)  # automatic reset

        browser.close()
        if errors:
            print("Browser errors:", *errors, sep="\n  ")
            return 1
        print("Visitor flow passed")
        return 0


if __name__ == "__main__":
    sys.exit(main())
