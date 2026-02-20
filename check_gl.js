const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();

    // Check Dev Server
    const page = await browser.newPage();
    page.on('console', msg => console.log('DEV SERVER LOG:', msg.text()));
    page.on('pageerror', err => console.log('DEV SERVER ERROR:', err.toString()));
    await page.goto('http://localhost:5174');
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: '/Users/daniel/.gemini/antigravity/brain/e918c3b8-0c26-41e6-b35d-ab4d7f97b5b9/test_dev_fixed.png' });

    // Check Export HTML
    const page2 = await browser.newPage();
    page2.on('console', msg => console.log('EXPORT LOG:', msg.text()));
    page2.on('pageerror', err => console.log('EXPORT ERROR:', err.toString()));
    await page2.goto('file:///Users/daniel/Developer/hero-lines/hero-lines-2026-02-20-4.html');
    await new Promise(r => setTimeout(r, 2000));
    await page2.screenshot({ path: '/Users/daniel/.gemini/antigravity/brain/e918c3b8-0c26-41e6-b35d-ab4d7f97b5b9/test_export_fixed.png' });

    await browser.close();
})();
