import { chromium } from 'playwright';

const pages = [
  { name: 'WorkforceTable', hash: '#/' },
  { name: 'ProjectAllocation', hash: '#/projects' },
  { name: 'GanttChart', hash: '#/gantt' },
  { name: 'PersonSchedule', hash: '#/schedule' },
];

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });

  for (const page of pages) {
    const p = await context.newPage();
    await p.goto(`http://localhost:5000/${page.hash}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    await p.screenshot({ path: `/tmp/${page.name}.png`, fullPage: true });
    console.log(`Screenshot saved: /tmp/${page.name}.png`);
    await p.close();
  }

  await browser.close();
})();
