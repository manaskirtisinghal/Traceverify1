// End-to-end UI check against the running stack (backend :8000 + Vite dev server).
// Uses the system Microsoft Edge through playwright-core (no browser download).
//   node e2e/smoke.mjs [http://127.0.0.1:5173] [screenshot-dir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
const SHOTS = process.argv[3] ?? null;
const failures = [];
const check = (cond, msg) => {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
  if (!cond) failures.push(msg);
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const consoleErrors = [];
const newPage = async (width, height) => {
  const p = await browser.newPage({ viewport: { width, height } });
  p.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  p.on('pageerror', (e) => consoleErrors.push(String(e)));
  return p;
};
let page;
const shot = async (name, fullPage = false) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
};
const rows = (status) =>
  page.locator(`[data-testid="timeline-item"]${status ? `[data-status="${status}"]` : ''}`).count();
const tab = async (name) => page.locator(`[data-testid="tab-${name}"]`).click();
const waitForResults = async () => {
  await page.waitForURL(/#\/investigations\/\d+/);
  await page.waitForSelector('[data-testid="story-summary"]');
};
const technicalView = async () => {
  await page.locator('[data-testid="view-technical"]').click();
  await page.waitForSelector('[data-testid="graph-node"]');
};
const noOverflow = async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1);

try {
  // ================= setup page on a 1366×768 laptop =================
  page = await newPage(1366, 768);
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="seed-row"]');
  check(await page.getByRole('heading', { name: 'New investigation' }).isVisible(), 'setup heading');
  check(await page.getByText('Find and explain evidence related to a known security event.').isVisible(), 'purpose stated under heading');
  const guide = page.locator('[data-testid="how-it-works"]');
  check(await guide.isVisible(), '"How TRACEVERIFY works" guide shown on first visit');
  const guideText = await guide.innerText();
  check(['Select an event', 'Run analysis', 'Explore connections', 'Verify evidence'].every((t) => guideText.includes(t)),
    'guide lists the four workflow steps');
  const guideBox = await guide.boundingBox();
  check(guideBox.height <= 90, `guide is compact (${Math.round(guideBox.height)}px tall)`);
  check(!(await page.getByText('Starting from').count()), '"Starting from…" sentence removed');
  check(await page.getByRole('button', { name: 'Synthetic evidence data' }).isVisible(), 'synthetic-data disclosure present');

  const runBox = await page.locator('[data-testid="run-investigation"]').boundingBox();
  check(runBox.y + runBox.height <= 768, `Run button visible without scrolling at 1366×768 (bottom ${Math.round(runBox.y + runBox.height)}px)`);
  const pageScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  check(pageScroll <= 0, `setup page fits 1366×768 without page scrolling (extra ${pageScroll}px)`);
  check(await noOverflow(), 'no horizontal overflow at 1366px');
  const listScroll = await page.locator('.seed-list').evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  check(listScroll.sh > listScroll.ch, 'event list scrolls independently');
  const visibleRows = await page.locator('.seed-list').evaluate((el) => {
    const box = el.getBoundingClientRect();
    return [...el.querySelectorAll('.seed-item')].filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top >= box.top - 1 && b.bottom <= box.bottom + 1;
    }).length;
  });
  check(visibleRows >= 5 && visibleRows <= 7, `about 5–6 events visible at once (${visibleRows})`);

  await shot('01a-setup-guide-1366');
  await page.locator('[data-testid="hide-guide"]').click();
  check(!(await guide.count()), 'guide can be dismissed');
  await page.reload();
  await page.waitForSelector('[data-testid="seed-row"]');
  check(!(await page.locator('[data-testid="how-it-works"]').count()), 'dismissal remembered after reload');
  await page.locator('[data-testid="show-guide"]').click();
  check(await page.locator('[data-testid="how-it-works"]').isVisible(), 'guide can be shown again');

  // tooltip
  await page.locator('.seed-card .info-btn').hover();
  check(await page.locator('#seed-tip').isVisible(), 'starting-event info tooltip appears on hover');
  await page.mouse.move(5, 5);

  // search
  await page.locator('[data-testid="seed-search"]').fill('c1493');
  check((await page.locator('[data-testid="seed-row"]').count()) === 2, 'search by computer filters list (C1493 → 2)');
  await page.locator('[data-testid="seed-search"]').fill('U636');
  check((await page.locator('[data-testid="seed-row"]').count()) === 1, 'search by user filters list (U636 → 1)');
  await page.locator('[data-testid="seed-search"]').fill('zzz');
  check(await page.locator('[data-testid="no-match"]').isVisible(), 'empty search result message');
  await page.locator('[data-testid="seed-search"]').fill('');
  check((await page.locator('[data-testid="seed-row"]').count()) === 12, 'clearing search restores 12 events');

  // selection + expandable details
  await page.locator('[data-testid="seed-row"] .seed-main').nth(1).click();
  check((await page.locator('[data-testid="seed-row"]').nth(1).getAttribute('class')).includes('selected'), 'row selection state');
  await page.locator('[data-testid="seed-row"] .seed-expand').nth(1).click();
  check(await page.locator('.seed-more').getByText('151036 s').isVisible(), 'expanded row shows raw LANL time');
  await page.locator('[data-testid="seed-row"] .seed-expand').nth(1).click();
  await page.locator('[data-testid="seed-row"] .seed-main').nth(0).click();

  // advanced settings still work
  await page.locator('[data-testid="advanced"] summary').click();
  await page.locator('[data-testid="weight-entity"]').fill('0.8');
  check(await page.locator('[data-testid="run-investigation"]').isDisabled(), 'invalid weights disable Run');
  await page.getByRole('button', { name: 'Fix automatically' }).click();
  await page.locator('[data-testid="weight-entity"]').fill('0.4');
  await page.locator('[data-testid="weight-temporal"]').fill('0.3');
  await page.locator('[data-testid="weight-rule"]').fill('0.3');
  await page.locator('[data-testid="advanced"] summary').click();
  check((await page.locator('[data-testid="threshold"]').count()) === 0, 'no user-adjustable threshold slider');
  await shot('01-setup-1366');

  // ================= results page =================
  await page.locator('[data-testid="run-investigation"]').click();
  await waitForResults();
  check(await page.locator('a[data-testid="nav-results"]').count() === 1, 'Results nav is an active link once results exist');
  check(await page.getByRole('heading', { name: /Investigation #\d+/ }).isVisible(), 'results heading');

  // default: simple story view
  const storyTitle = await page.locator('#story-title').innerText();
  check(/Possible story/.test(storyTitle) && /not confirmed/.test(storyTitle), 'simple view opens with "Possible story — not confirmed"');
  const narrative = await page.locator('[data-testid="story-narrative"]').innerText();
  check(/User 1/.test(narrative) && /Computer 1/.test(narrative), 'story uses readable names (User 1, Computer 1)');
  check(!/U620|C17693|C1003|#\d/.test(narrative), 'story hides technical IDs');
  check(/does not prove/.test(await page.locator('[data-testid="story-caveat"]').innerText()), 'story states correlation does not prove cause');
  check((await page.locator('[data-testid="graph-node"]').count()) === 0, 'graph is kept in the technical view');
  check((await page.locator('[data-testid="story-step"]').count()) > 1, 'step-by-step list shown in simple view');
  await shot('02a-simple-story-1366', true);
  await technicalView();
  check(await page.locator('[data-testid="technical-view"]').isVisible(), 'technical view is clearly labelled');
  check(/0\.60/.test(await page.locator('[data-testid="fixed-threshold"]').innerText()), 'fixed threshold shown in technical details');
  check(/Starting event\s+U620@DOM1\s+C17693 → C1003/.test(await page.locator('[data-testid="start-line"]').innerText()),
    'starting event shown under the title');
  check(/Longest chain from start/.test(await page.locator('[data-testid="metrics"]').innerText()), 'clarified path metric');

  // default selection
  await page.waitForSelector('[data-testid="why-panel"]');
  check(/Process start/.test(await page.locator('[data-testid="details-title"]').innerText()), 'details panel pre-selects top evidence');
  const why = await page.locator('[data-testid="why-panel"]').innerText();
  check(/Included as evidence/.test(why) && /Related to/.test(why) && /What they have in common/.test(why) && /Attack pattern: /.test(why) && /Why it was included/.test(why),
    'details answer: related to, connected by (entities + rule), why included');
  check(/^0\.9\d\d$/.test(await page.locator('[data-testid="final-score"]').innerText()), 'final score shown');
  check(/started powershell\.exe on C1003/.test(await page.locator('[data-testid="what-happened"]').innerText()),
    'plain-English "what happened"');
  check(/well above the threshold/.test(await page.locator('[data-testid="strength"]').innerText()), 'strength relative to threshold');
  check(/It shares .*fits the attack pattern/.test(await page.locator('[data-testid="short-reason"]').innerText()), 'short explanation shown');
  check(!(await page.locator('[data-testid="score-breakdown"]').isVisible()), 'score breakdown collapsed by default');
  check((await page.locator('.g-node.selected').count()) === 1, 'default selection highlighted in graph');
  await shot('02-results-1366');

  // graph chronology: the logon 8 s before the start sits in the start column above the seed
  const preNode = page.locator('[data-testid="graph-node"]', { hasText: '8 s before start' });
  const seedNode = page.locator('[data-testid="graph-node"]', { hasText: 'Starting event' });
  check((await preNode.count()) === 1, 'pre-start event labelled "8 s before start"');
  const pb = await preNode.boundingBox();
  const sb = await seedNode.boundingBox();
  check(Math.abs(pb.x - sb.x) < 2 && pb.y < sb.y, 'pre-start event is in the start column, above the seed');
  check(await page.getByText('Link (earlier → later)').isVisible(), 'legend explains arrow direction');
  check(await page.getByText('A link means “probably related”, not “caused by”.').isVisible(), 'legend states correlation ≠ cause');
  check(/relationship strength.*not probabilities/.test(await page.locator('[data-testid="strength-legend"]').innerText()),
    'legend labels scores as relationship strength, not probabilities');

  // graph within container
  const wrap = await page.locator('.graph-wrap').boundingBox();
  const nodesInside = await page.locator('[data-testid="graph-node"]').evaluateAll((els, w) =>
    els.every((e) => { const b = e.getBoundingClientRect(); return b.left >= w.x - 1 && b.right <= w.x + w.width + 1; }), wrap);
  check(nodesInside, 'all graph nodes fit inside the graph panel');
  const summaries = await page.locator('.g-summary').allTextContents();
  check(summaries.every((t) => !t.includes('…')), 'graph node descriptions are not truncated');

  // tooltip
  await page.locator('[data-testid="graph-node"]').nth(3).hover();
  check(await page.locator('.graph-tooltip').isVisible(), 'hover tooltip shows full event info');
  await page.mouse.move(5, 5);

  // graph → timeline sync (via tab switch)
  await page.locator('[data-testid="graph-node"]', { hasText: 'DNS resolution' }).first().click();
  const dnsId = await page.locator('.g-node.selected').getAttribute('data-event-id');
  check(/Process → DNS lookup from same host/.test(await page.locator('[data-testid="why-panel"]').innerText()), 'DNS explained by R03');
  await page.mouse.move(5, 5); // hovering previews another path; check the selection's own path
  check((await page.locator('.g-node.on-path').count()) > 0 && (await page.locator('.g-node.faded').count()) > 0,
    'selecting an event highlights its connected path');
  await tab('timeline');
  check((await page.locator('[data-testid="timeline-item"][data-on-path="true"]').count()) > 0, 'connected path highlighted in timeline');
  const selRow = page.locator('[data-testid="timeline-item"].selected');
  check((await selRow.getAttribute('data-event-id')) === dnsId, 'graph selection carried to timeline');
  check((await page.locator('.scorebar .thr').count()) === 0, 'no unexplained threshold marker in score bars');
  const nodesCount = await page.locator('[data-testid="graph-node"]').count();
  check(nodesCount === 0 && (await rows()) === 9, 'timeline view lists the same 9 events');

  // timeline → graph sync
  await page.locator('[data-testid="timeline-item"]', { hasText: 'Network flow' }).first().click();
  const flowId = await page.locator('[data-testid="timeline-item"].selected').getAttribute('data-event-id');
  await tab('graph');
  check((await page.locator('.g-node.selected').getAttribute('data-event-id')) === flowId, 'timeline selection carried to graph');
  await tab('timeline');
  await page.locator('[data-testid="sort-score"]').click();
  const scores = await page.locator('[data-testid="timeline-item"][data-status="accepted"] .num').allInnerTexts();
  check(scores.length > 1 && scores.map(Number).every((v, i, a) => i === 0 || a[i - 1] >= v), 'sort by score');
  await page.locator('[data-testid="sort-time"]').click();
  await page.locator('[data-testid="show-rejected"]').check();
  check((await rows('rejected')) > 0, 'excluded events shown');
  await page.locator('[data-testid="timeline-item"][data-status="rejected"]').first().click();
  const exWhy = await page.locator('[data-testid="why-panel"]').innerText();
  check(/Left out/.test(exWhy) && /Why it was excluded/.test(exWhy) && /held down mainly by a low/.test(exWhy) && /not accepted/.test(exWhy), 'excluded event explains why (weakest component named)');
  await shot('03-timeline-1366');
  await page.locator('[data-testid="show-rejected"]').uncheck();

  // edge selection + expandable details
  await tab('graph');
  await page.locator('[data-testid="graph-edge"]').first().dispatchEvent('click');
  await page.waitForSelector('[data-testid="relationship-caption"]');
  check(await page.locator('[data-testid="score-breakdown"]').isVisible(), 'selecting a link opens how its strength was formed');
  check(await page.locator('[data-testid="edge-strength-label"]').isVisible(), 'selected link shows its relationship strength');
  check(/not a probability/.test(await page.locator('[data-testid="not-probability"]').innerText()), 'details say strength is not a probability');
  await page.waitForSelector('[data-testid="rule-condition"]');
  check(/condition:/.test(await page.locator('[data-testid="rule-condition"]').innerText()), 'rule condition from rules API');
  await page.locator('.disclosure summary', { hasText: 'Original log record' }).click();
  await page.waitForSelector('.raw');
  check(await page.locator('.raw').isVisible(), 'raw record expands');
  await page.locator('[data-testid="reset-view"]').click();

  // rerun
  await page.locator('[data-testid="open-rerun"]').click();
  check((await page.locator('[data-testid="rerun-drawer"] [data-testid="threshold"]').count()) === 0, 'no threshold slider in re-run drawer');
  await page.locator('[data-testid="rerun-drawer"] [data-testid="window-preset"]').selectOption('w3');
  await page.locator('[data-testid="rerun"]').click();
  await page.waitForSelector('[data-testid="change-note"]');
  check(/\d+ events? added, \d+ removed/.test(await page.locator('[data-testid="change-note"]').innerText()), 'wider-window re-run reports changes');
  check(/0\.60/.test(await page.locator('[data-testid="fixed-threshold"]').innerText()), 're-run keeps the fixed threshold');
  const wrap2 = await page.locator('.graph-wrap').boundingBox();
  const inside2 = await page.locator('[data-testid="graph-node"]').evaluateAll((els, w) =>
    els.every((e) => { const b = e.getBoundingClientRect(); return b.left >= w.x - 1 && b.right <= w.x + w.width + 1; }), wrap2);
  check(inside2, 'graph still fits inside the panel after re-run');
  check(await page.locator('[data-testid="why-panel"]').isVisible(), 'details still populated after rerun');
  await shot('04-rerun-wider');

  // simple ↔ technical keeps the investigation and the selection
  await page.locator('[data-testid="view-simple"]').click();
  await page.locator('[data-testid="story-step"]').nth(2).click();
  check(await page.locator('[data-testid="story-why"]').isVisible(), 'simple step explains its link in plain words');
  check(!/#\d|U620|C1003/.test(await page.locator('[data-testid="story-why"]').innerText()), 'plain link reason hides IDs');
  await page.locator('[data-testid="show-evidence"]').click();
  await page.waitForSelector('[data-testid="graph-node"]');
  check((await page.locator('.g-node.selected').count()) === 1, 'switching to the evidence keeps the selected step');
  await page.close();

  // ================= other seeds on a 1600×1000 screen =================
  page = await newPage(1600, 1000);
  for (const idx of [4, 10]) {
    await page.goto(BASE);
    await page.waitForSelector('[data-testid="seed-row"]');
    await page.locator('[data-testid="seed-row"] .seed-main').nth(idx).click();
    await page.locator('[data-testid="run-investigation"]').click();
    await waitForResults();
    await technicalView();
    await page.waitForSelector('[data-testid="why-panel"]');
    const w = await page.locator('.graph-wrap').boundingBox();
    const inside = await page.locator('[data-testid="graph-node"]').evaluateAll((els, b) =>
      els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= b.x - 1 && r.right <= b.x + b.width + 1; }), w);
    check(inside && (await page.locator('[data-testid="graph-node"]').count()) > 1, `seed #${idx + 1}: graph renders inside panel with default selection`);
    await shot(`05-seed-${idx + 1}`);
  }
  check(await noOverflow(), 'no horizontal overflow at 1600px');

  // narrow screen
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.waitForTimeout(250);
  check(await noOverflow(), 'no horizontal overflow at 820px (results)');
  await shot('06-narrow-results', true);
} catch (err) {
  failures.push(String(err));
  console.error(err);
  await shot('error');
} finally {
  check(consoleErrors.length === 0, `no browser console errors${consoleErrors.length ? `: ${consoleErrors.join(' | ')}` : ''}`);
  await browser.close();
}

console.log(failures.length ? `\nE2E: ${failures.length} FAILURE(S)` : '\nE2E: PASS');
process.exit(failures.length ? 1 : 0);
