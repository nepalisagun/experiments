// One-off for the Lovable vs Claude Code benchmark. Drives the logged-in debug Chrome (:9222).
// node Temp/scripts/lovable_run.mjs new <prompt-file>            -> creates a project from the dashboard composer (Build mode), prints its URL
// node Temp/scripts/lovable_run.mjs send <project-url> <prompt-file> -> sends a Build-mode message in that project
// node Temp/scripts/lovable_run.mjs wait <project-url> <out-json>   -> waits until idle, then saves time/credits header, timeline and reply
import puppeteer from 'puppeteer';
import fs from 'fs';
const [cmd, a1, a2] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
let page = (await browser.pages()).find(p => p.url().includes('lovable.dev'));
if (!page) { page = await browser.newPage(); }
await page.bringToFront();
const clickAt = async b => { if (b) await page.mouse.click(b.x, b.y); return b; };
const box = (fn, arg) => page.evaluate(fn, arg);

async function ensureBuildMode() {
  const cur = await page.evaluate(() => { const s = document.querySelector('[aria-label="Transcribe"]'); let f = s; for (let i = 0; i < 6 && f; i++) { f = f.parentElement; if (f && f.querySelector('[contenteditable=true]')) break; } return [...(f || document).querySelectorAll('button')].map(b => b.innerText.trim()).find(t => /^(Build|Chat|Plan)$/.test(t)); });
  if (cur === 'Build' || !cur) return cur;
  await clickAt(await box(() => { const s = document.querySelector('[aria-label="Transcribe"]'); let f = s; for (let i = 0; i < 6 && f; i++) { f = f.parentElement; if (f && f.querySelector('[contenteditable=true]')) break; } const b = [...f.querySelectorAll('button')].find(b => /^(Build|Chat|Plan)$/.test(b.innerText.trim())); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  await sleep(700);
  await clickAt(await box(() => { const o = [...document.querySelectorAll('[role=menuitem],[role=option],[role=menuitemradio]')].find(e => e.innerText.trim().startsWith('Build')); if (!o) return null; const r = o.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  await sleep(500);
  return 'Build(switched)';
}

async function typePrompt(text) {
  await page.evaluate(() => document.querySelector('[aria-label="Dismiss notice"]')?.click());
  await clickAt(await box(() => { const e = [...document.querySelectorAll('[contenteditable=true]')].pop(); const r = e.getBoundingClientRect(); return { x: r.x + 20, y: r.y + Math.min(r.height / 2, 20) }; }));
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.type(lines[i], { delay: 1 });
    if (i < lines.length - 1) { await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift'); }
  }
  await sleep(400);
  const typed = await page.evaluate(() => [...document.querySelectorAll('[contenteditable=true]')].pop().innerText);
  return typed;
}

if (cmd === 'new') {
  const text = fs.readFileSync(a1, 'utf8').trim();
  await page.goto('https://lovable.dev/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[contenteditable=true]', { timeout: 30000 });
  await sleep(2500);
  const mode = await ensureBuildMode();
  const typed = await typePrompt(text);
  if (typed.replace(/\s+/g, '').length < text.replace(/\s+/g, '').length * 0.95) { console.log('TYPE MISMATCH', typed.length, text.length); process.exit(2); }
  await page.keyboard.press('Enter');
  for (let i = 0; i < 60 && !page.url().includes('/projects/'); i++) await sleep(1000);
  console.log(JSON.stringify({ mode, url: page.url().split('?')[0], t: new Date().toISOString() }));
} else if (cmd === 'send') {
  const text = fs.readFileSync(a2, 'utf8').trim();
  if (!page.url().startsWith(a1)) { await page.goto(a1, { waitUntil: 'domcontentloaded' }); await sleep(6000); }
  const mode = await ensureBuildMode();
  const typed = await typePrompt(text);
  if (typed.replace(/\s+/g, '').length < text.replace(/\s+/g, '').length * 0.95) { console.log('TYPE MISMATCH', typed.length, text.length); process.exit(2); }
  await page.keyboard.press('Enter');
  await sleep(3000);
  console.log(JSON.stringify({ mode, sent: true, t: new Date().toISOString() }));
} else if (cmd === 'wait') {
  if (!page.url().startsWith(a1)) { await page.goto(a1, { waitUntil: 'domcontentloaded' }); await sleep(6000); }
  const t0 = Date.now(); let idle = 0;
  const busy = () => page.evaluate(() => { const t = document.body.innerText; return t.includes('Queue follow-up') || /\bThinking\b|Working\.\.\.|Stop generating/.test(t.slice(-4000)) || !![...document.querySelectorAll('button')].find(b => /^(Stop|Cancel)$/.test((b.getAttribute('aria-label') || b.innerText || '').trim())); });
  let saw = false;
  while (Date.now() - t0 < 45 * 60e3) { if (await busy()) { idle = 0; saw = true; } else if ((saw || Date.now() - t0 > 120e3) && ++idle >= 4) break; await sleep(5000); }
  await sleep(2000);
  // a question Lovable asks back shows as buttons/forms; capture tail regardless
  const tail = await page.evaluate(() => document.body.innerText.slice(-6000));
  const d = await box(() => { const d = [...document.querySelectorAll('button')].filter(b => /^(Details|Show details)$/.test(b.innerText.trim())).pop(); if (!d) return null; d.scrollIntoView({ block: 'center' }); const r = d.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  let hdr = '', steps = '';
  if (d) { await sleep(400); await clickAt(d); await sleep(2200);
    hdr = await page.evaluate(() => { const b = document.querySelector('[aria-label="Back to latest"]'); let p = b; for (let i = 0; i < 2 && p; i++) p = p.parentElement; return p ? p.innerText.replace(/\n+/g, ' | ') : ''; });
    steps = await page.evaluate(() => { const panes = [...document.querySelectorAll('div')].filter(d => d.getBoundingClientRect().x > window.innerWidth * 0.3 && d.getBoundingClientRect().width > window.innerWidth * 0.4 && d.innerText.length > 50); panes.sort((a, b) => a.innerText.length - b.innerText.length); return panes.length ? panes[panes.length - 1].innerText.slice(0, 12000) : ''; });
    await page.evaluate(() => document.querySelector('[aria-label="Back to latest"]')?.click());
  }
  if (!hdr) { // answer-only turns have no Details; the last message's "More options" menu shows time and credits
    const mo = await box(() => { const b = [...document.querySelectorAll('button[aria-label="More options"]')].pop(); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (mo) { await sleep(300); await clickAt(mo); await sleep(1200);
      const m = await page.evaluate(() => { const e = [...document.querySelectorAll('[role=menu]')].pop(); return e ? e.innerText : ''; });
      const w = m.match(/Worked for\s*\n?\s*([^\n]+)/), c = m.match(/Credits used\s*\n?\s*([\d.]+)/);
      if (c) hdr = `menu | ${w ? w[1].trim() : '?'} | ${c[1]} | Details`;
      await page.keyboard.press('Escape'); }
  }
  const reply = await page.evaluate(() => { const b = [...document.querySelectorAll('[aria-label="Copy message"]')].pop(); let p = b; for (let i = 0; i < 8 && p; i++) { p = p.parentElement; if (p && p.innerText.length > 80) break; } return p ? p.innerText : ''; });
  const res = { url: a1, waited_s: Math.round((Date.now() - t0) / 1000), hdr, steps, reply, tail };
  fs.writeFileSync(a2, JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ waited_s: res.waited_s, hdr }));
}
browser.disconnect();
