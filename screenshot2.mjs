import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  
  // Check WorkforceTable
  const p = await context.newPage();
  const errors = [];
  p.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  p.on('pageerror', err => errors.push(err.message));
  
  await p.goto('http://localhost:5000/#/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);
  
  // Check what's on the page
  const content = await p.evaluate(() => document.body.innerHTML.substring(0, 2000));
  console.log('PAGE CONTENT:');
  console.log(content);
  console.log('\nERRORS:');
  console.log(errors.join('\n'));
  
  await p.screenshot({ path: '/tmp/WorkforceDebug.png', fullPage: true });
  
  // Also try PersonSchedule
  const p2 = await context.newPage();
  const errors2 = [];
  p2.on('console', msg => {
    if (msg.type() === 'error') errors2.push(msg.text());
  });
  p2.on('pageerror', err => errors2.push(err.message));
  
  await p2.goto('http://localhost:5000/#/schedule', { waitUntil: 'networkidle' });
  await p2.waitForTimeout(3000);
  
  console.log('\nSCHEDULE ERRORS:');
  console.log(errors2.join('\n'));
  
  await p2.screenshot({ path: '/tmp/ScheduleDebug.png', fullPage: true });
  
  await browser.close();
})();
