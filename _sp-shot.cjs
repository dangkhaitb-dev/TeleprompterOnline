const puppeteer = require('puppeteer');
const path = require('path');
const out = process.argv[2];
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const shots = [
    { file: 'about.html', name: 'about-connect', w: 1440, h: 900, sel: '.about-connect' },
    { file: 'about.html', name: 'footer-desktop', w: 1440, h: 900, sel: 'footer.footer' },
    { file: 'about.html', name: 'footer-mobile', w: 375, h: 800, sel: 'footer.footer' },
    { file: 'about.html', name: 'about-connect-mobile', w: 375, h: 800, sel: '.about-connect' },
    { file: 'blog.html', name: 'footer-compact', w: 1440, h: 900, sel: 'footer.footer' },
  ];
  for (const s of shots) {
    const page = await browser.newPage();
    await page.setViewport({ width: s.w, height: s.h });
    await page.goto('http://localhost:8899/' + s.file, { waitUntil: 'networkidle0' });
    const el = await page.$(s.sel);
    await el.screenshot({ path: `${out}/${s.name}.png` });
    await page.close();
  }
  await browser.close();
  console.log('done');
})();
