const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    const filePath = `file://${path.resolve('/Users/daniel/Developer/hero-lines/hero-lines-2026-02-20-2.html')}`;

    await page.goto(filePath);
    await page.waitForTimeout(1000);

    async function evaluateBounds() {
        return await page.evaluate(() => {
            const canvas = document.querySelector('c');
            return {
                w: window.innerWidth,
                h: window.innerHeight,
                cw: document.getElementById('c').width,
                ch: document.getElementById('c').height
            };
        });
    }

    // Default
    await page.setViewport({ width: 1000, height: 1000 });
    await page.waitForTimeout(500);
    console.log("1000x1000:", await evaluateBounds());
    await page.screenshot({ path: '/Users/daniel/.gemini/antigravity/brain/e918c3b8-0c26-41e6-b35d-ab4d7f97b5b9/test_1.png' });

    // Wide
    await page.setViewport({ width: 2000, height: 1000 });
    await page.waitForTimeout(500);
    console.log("2000x1000:", await evaluateBounds());
    await page.screenshot({ path: '/Users/daniel/.gemini/antigravity/brain/e918c3b8-0c26-41e6-b35d-ab4d7f97b5b9/test_2.png' });

    // Narrow
    await page.setViewport({ width: 500, height: 1000 });
    await page.waitForTimeout(500);
    console.log("500x1000:", await evaluateBounds());
    await page.screenshot({ path: '/Users/daniel/.gemini/antigravity/brain/e918c3b8-0c26-41e6-b35d-ab4d7f97b5b9/test_3.png' });

    // Very Small
    await page.setViewport({ width: 500, height: 500 });
    await page.waitForTimeout(500);
    console.log("500x500:", await evaluateBounds());
    await page.screenshot({ path: '/Users/daniel/.gemini/antigravity/brain/e918c3b8-0c26-41e6-b35d-ab4d7f97b5b9/test_4.png' });

    await browser.close();
})();
