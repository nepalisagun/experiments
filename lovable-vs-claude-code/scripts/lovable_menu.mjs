// One-off: print "Worked for / Credits used" from the last message's More options menu in each given project.
import puppeteer from 'puppeteer';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const page = (await browser.pages()).find(p => p.url().includes('lovable.dev'));
for (const url of process.argv.slice(2)) {
  await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('[contenteditable=true]', { timeout: 30000 }); await sleep(5000);
  const b = await page.evaluate(() => { const b = [...document.querySelectorAll('button[aria-label="More options"]')].pop(); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (!b) { console.log(url, 'NO MENU'); continue; }
  await sleep(400); await page.mouse.click(b.x, b.y); await sleep(1200);
  const m = await page.evaluate(() => { const e = [...document.querySelectorAll('[role=menu]')].pop(); return e ? e.innerText.replace(/\n+/g, ' | ') : ''; });
  console.log(url.split('/').pop(), m); await page.keyboard.press('Escape');
}
browser.disconnect();
