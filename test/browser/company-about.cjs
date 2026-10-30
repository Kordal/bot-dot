// Optional browser check of the Company's About step (#670): node test/browser/company-about.cjs [shots dir]
// A new idea: the Chief names it and drafts chips; five questions, one per screen (a chip, "Write your own", Skip),
// each next one's chips asked again from the answers before it (#787),
// each under the answer before it (#801), then "I want my <who> to…" stories in two groups, the delivery date (a preset,
// Indefinite, a day on the calendar), then the review: the SWOT and one list of rows, a goal and "never" picked, a row
// changed in place, and a reload that goes on where it was. Then an ops ask (#805): the Chief's three questions, no
// stories and no SWOT. Then a site: the review with the Chief's cards and its open question. The
// stand-in Claude answers every call with one JSON (test/fixtures/fake-claude.js, $FAKE_OUT/company.txt).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('../helpers');

const IDEA = {
  name: 'Mealwise',
  chips: { who: ['Parents of kids under 10', 'Working parents'], today: ['Google recipes at 5 pm'], why: ['I am a parent of three'], signal: ['10 parents use it every week'], test: ['Talk to 5 parents'] },
  goal: ['10 parents use it every week', '50 sign-ups'], never: ['E-mail someone new', 'Spend money'], time: ['A few hours a week'],
  stories: ['Create a weekly meal plan', 'Print the shopping list'], group: 'partners',
  strengths: ['Plan and shopping list in one tap'], weaknesses: ['Nobody has paid for a meal planner like this yet'], opportunities: ['Parents ask for this every week'], threats: ['WeekBite plans meals, but has no shopping list'], firstTest: 'Ask 10 parents to pre-order at $4',
};
const SITE = { name: 'Fernhill', about: 'Project-management app for small agencies', serves: 'Small agencies, 5 to 20 people', today: 'Support and sales by Gmail, code on GitHub', questions: [{ question: 'Who answers billing questions?', chips: ['You', 'Someone else'] }], goal: ['50 paying teams on the new plan'], never: ['E-mail a customer', 'Merge to main'] };

(async () => {
  const shots = process.argv[2] || null;
  const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: false }); };
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    fs.writeFileSync(path.join(srv.out, 'company.txt'), JSON.stringify(IDEA));
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/`);
    await page.locator('#place-switch [data-place="company"]').click();
    await page.locator('#co-what').fill('A meal-planning app for busy parents');
    await page.locator('#co-ask .co-go').click();

    // The five questions.
    await page.locator('.co-q h1', { hasText: 'Who is it for?' }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-done]').isDisabled(), true);
    await page.locator('[data-chip="Parents of kids under 10"]').click();
    await shot(page, 'wide-question');
    // The next question's chips build on the answer (#787); a failed ask leaves the drafted ones.
    fs.writeFileSync(path.join(srv.out, 'company.txt'), JSON.stringify({ chips: ['Cook from a paper list'] }));
    await page.locator('[data-done]').click();
    await page.locator('.co-q h1', { hasText: 'What do they do today?' }).waitFor();
    await page.locator('[data-chip="Cook from a paper list"]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-chip="Google recipes at 5 pm"]').count(), 0, 'the drafted chips are replaced');
    const asked = fs.readdirSync(srv.out).filter((f) => /^company-\d.*\.txt$/.test(f)).sort().map((f) => fs.readFileSync(path.join(srv.out, f), 'utf8'));
    assert.match(asked.at(-1), /Who is it for\? Parents of kids under 10/);
    fs.writeFileSync(path.join(srv.out, 'company.txt'), JSON.stringify(IDEA));
    await page.locator('[data-write="today"]').click();
    await page.locator('[data-own="today"] input').fill('Order pizza');
    await page.locator('[data-own="today"] input').press('Enter');
    await page.locator('[data-chip="Order pizza"].on').waitFor();
    await shot(page, 'wide-write-your-own');
    await page.locator('[data-done]').click();
    await page.locator('.co-q h1', { hasText: 'Why you?' }).waitFor();
    await page.locator('[data-skip]').click();
    await page.locator('.co-q h1', { hasText: 'What would show it works in 90 days?' }).waitFor();
    await page.locator('[data-co-back]').click();
    await page.locator('.co-q h1', { hasText: 'Why you?' }).waitFor();
    await page.locator('[data-skip]').click();
    await page.locator('[data-chip="10 parents use it every week"]').click();
    await page.locator('[data-done]').click();
    await page.locator('[data-chip="Talk to 5 parents"]').click();
    await page.locator('.co-prev', { hasText: '10 parents use it every week' }).waitFor();
    assert.equal(await page.locator('.co-steps li.on .co-ticks i').count(), 8);
    assert.equal(await page.locator('.co-steps li.on .co-ticks i.on').count(), 1);
    await shot(page, 'wide-last-question');
    await page.locator('[data-done]').click();

    // The stories.
    await page.locator('.co-q h1', { hasText: 'I want my' }).waitFor();
    await page.locator('[data-idea="Create a weekly meal plan"]').click();
    await page.locator('.co-group li', { hasText: 'Create a weekly meal plan' }).waitFor();
    for (const t of ['Adjust portion sizes', 'Print the plan', 'Share the plan with a partner']) {
      await page.locator('#co-story input').fill(t);
      await page.locator('#co-story input').press('Enter');
      await page.locator('.co-group li', { hasText: t }).waitFor();
    }
    assert.deepEqual(await page.locator('.co-group li .co-pill').allInnerTexts(), ['Start', 'Start', 'Start', 'Later'], 'the first three Start');
    await page.locator('[data-more]').click();
    await page.locator('[data-chips="who"] [data-chip="partners"]').click();
    await page.locator('.co-who', { hasText: 'partners' }).waitFor();
    await page.locator('#co-story input').fill('Get orders from shared shopping lists');
    await page.locator('#co-story input').press('Enter');
    await page.locator('.co-group header', { hasText: 'partners' }).waitFor();
    await shot(page, 'wide-stories');
    await page.locator('[data-next]').click();

    // The delivery date (#792, #801): a preset, Indefinite, then a day on the calendar.
    await page.locator('.co-q h1', { hasText: 'When should it be delivered?' }).waitFor();
    assert.equal(await page.locator('[data-done]').isDisabled(), true);
    await page.locator('[data-preset="eoy"]').click();
    await page.locator('[data-preset="eoy"].on').waitFor();
    await page.locator('[data-delivery-none]').click();
    await page.locator('[data-delivery-none].on').waitFor();
    assert.equal((await srv.api('/company')).data.company.deliverBy, 'none');
    await page.locator('[data-pick-day]').click();
    await page.locator('.co-cal [data-cal-move="1"]').click();
    const day = await page.locator('.co-cal [data-cal-day$="-15"]').getAttribute('data-cal-day');
    await page.locator('.co-cal [data-cal-day$="-15"]').click();
    await page.locator('.co-cal [data-cal-day$="-15"].on').waitFor();
    await shot(page, 'wide-delivery');
    await page.locator('[data-done]').click();

    // The review.
    await page.locator('.co-li', { hasText: 'Ask 10 parents to pre-order' }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.co-knows').count(), 0, 'no summary beside it');
    await page.locator('[data-chips="goal"] [data-chip="10 parents use it every week"]').click();
    await page.locator('[data-chips="never"] [data-chip="Spend money"]').click();
    await page.locator('[data-chips="never"] [data-chip="E-mail someone new"]').click();
    await page.locator('[data-chips="never"] [data-chip="E-mail someone new"].on').waitFor();
    await shot(page, 'wide-review');
    let c = (await srv.api('/company')).data.company;
    assert.equal(c.name, 'Mealwise');
    assert.deepEqual(c.about.map((a) => [a.key, a.answer]), [['who', 'Parents of kids under 10'], ['today', 'Order pizza'], ['why', ''], ['signal', '10 parents use it every week'], ['test', 'Talk to 5 parents']]);
    assert.deepEqual(c.stories.map((g) => [g.who, g.items.length]), [['users', 4], ['partners', 1]]);
    assert.equal(c.goal, '10 parents use it every week');
    assert.deepEqual(c.never, ['Spend money', 'E-mail someone new']);
    assert.equal(c.deliverBy, day);
    // An answer is changed in place.
    await page.locator('[data-edit="who"]').click();
    await page.locator('#co-edit input').fill('Parents of kids under 12');
    await page.locator('#co-edit input').press('Enter');
    await page.locator('[data-edit="who"]', { hasText: 'Parents of kids under 12' }).waitFor();
    // A reload goes on where it was.
    await page.reload();
    await page.locator('.co-swot').waitFor({ timeout: 20000 });
    await page.locator('[data-build]').click();
    await page.locator('.co-steps li.on', { hasText: 'Team' }).waitFor();

    // An ops ask (#805): the questions the Chief picked, no stories, the delivery date, a review without the SWOT.
    await srv.api('/company', { method: 'DELETE' });
    fs.writeFileSync(path.join(srv.out, 'company.txt'), JSON.stringify({ name: 'Homelab', shape: 'ops', questions: ['runs', 'care', 'first'], stories: false, swot: false, chips: { runs: ['Proxmox with 6 VMs'], care: ['Disk full on the NAS'], first: ['Check the backups'] }, goal: ['No surprise outages'], never: ['Reboot a host'] }));
    await srv.api('/company', { method: 'POST', body: { start: 'Manage my homelab' } });
    await page.reload();
    await page.locator('.co-q h1', { hasText: 'What do you run?' }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.co-ticks i').count(), 5, 'three questions, the delivery date and the review');
    await page.locator('[data-chip="Proxmox with 6 VMs"]').click();
    await page.locator('[data-done]').click();
    await page.locator('.co-q h1', { hasText: 'What breaks or needs care?' }).waitFor();
    await page.locator('.co-chip.co-prev', { hasText: 'Proxmox with 6 VMs' }).waitFor();
    await page.locator('[data-skip]').click();
    await page.locator('.co-q h1', { hasText: 'What first?' }).waitFor();
    await page.locator('[data-chip="Check the backups"]').click();
    await page.locator('[data-done]').click();
    await page.locator('.co-q h1', { hasText: 'When should it be delivered?' }).waitFor();
    await page.locator('[data-delivery-none]').click();
    await page.locator('[data-done]').click();
    await page.locator('.co-review').waitFor();
    assert.equal(await page.locator('.co-swot').count(), 0, 'no SWOT for an ops ask');
    await page.locator('[data-edit="runs"]', { hasText: 'Proxmox with 6 VMs' }).waitFor();
    assert.deepEqual(await page.locator('.co-li .co-li-k').allInnerTexts().then((l) => l.slice(0, 3)), ['Runs', 'Needs care', 'First step']);
    await shot(page, 'wide-ops-review');
    await page.locator('[data-co-back]').click();
    await page.locator('.co-q h1', { hasText: 'When should it be delivered?' }).waitFor();
    await page.locator('[data-co-back]').click();
    await page.locator('.co-q h1', { hasText: 'What first?' }).waitFor();
    await page.reload();
    await page.locator('.co-review').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.co-swot').count(), 0);

    // A site: the Chief's cards, its open question highlighted until answered.
    await srv.api('/company', { method: 'DELETE' });
    fs.writeFileSync(path.join(srv.out, 'company.txt'), JSON.stringify(SITE));
    await srv.api('/company', { method: 'POST', body: { start: 'fernhill.invalid' } });
    await page.reload();
    await page.locator('.co-li.open', { hasText: 'Who answers billing questions?' }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-co-back]').count(), 0);
    await shot(page, 'wide-site');
    await page.locator('[data-chips="about:q1"] [data-chip="You"]').click();
    await page.locator('[data-edit="q1"]', { hasText: 'You' }).waitFor();
    c = (await srv.api('/company')).data.company;
    assert.deepEqual(c.about.find((a) => a.key === 'q1'), { key: 'q1', question: 'Who answers billing questions?', answer: 'You', chips: ['You', 'Someone else'] });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.co-list').waitFor();
    await shot(page, 'phone-site');
    assert.deepEqual(errors, []);
    console.log('company-about: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
