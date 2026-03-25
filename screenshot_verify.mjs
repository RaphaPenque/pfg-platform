import { chromium } from 'playwright';

const pages = [
  { name: 'GanttChart', hash: '#/gantt' },
  { name: 'ProjectAllocation', hash: '#/projects' },
  { name: 'CustomerPortal', hash: '#/portal/TRNS' },
];

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });

  for (const page of pages) {
    const p = await context.newPage();
    const errors = [];
    p.on('pageerror', err => errors.push(err.message));
    await p.goto(`http://localhost:5000/${page.hash}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    await p.screenshot({ path: `/tmp/${page.name}_v2.png`, fullPage: true });
    if (errors.length > 0) {
      console.log(`ERRORS on ${page.name}:`, errors.join('; '));
    } else {
      console.log(`OK: /tmp/${page.name}_v2.png`);
    }
    await p.close();
  }

  await browser.close();
})();
