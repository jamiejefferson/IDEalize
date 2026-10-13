// Records the hero film: steps index.html through every frame and saves
// each as a PNG, then film-src/encode.sh turns them into the site's video.
//   PLAYWRIGHT=/path/to/playwright-core node record.mjs <url> <out-dir>
// Serve the website folder first, e.g. `python3 -m http.server 8765` in website/.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright-core');
const [url = 'http://127.0.0.1:8765/film-src/', outDir = 'frames'] = process.argv.slice(2);
const fs = require('fs'); fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(url, { waitUntil: 'load' });
await page.evaluate(() => window.ready);
const total = await page.evaluate(() => window.TOTAL);
for (let f = 0; f < total; f++) {
  await page.evaluate(f => seek(f), f);
  await page.evaluate(() => imagesSettled());
  await page.screenshot({ path: `${outDir}/${String(f).padStart(4, '0')}.png` });
  if (f % 100 === 0) console.log('frame', f);
}
await browser.close();
