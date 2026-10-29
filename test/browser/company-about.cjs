// Optional browser check of the Company's About step (#670): node test/browser/company-about.cjs [shots dir]
// A new idea: the Chief names it and drafts chips; five questions, one per screen (a chip, "Write your own", Skip),
// then "I want my <who> to…" stories in two groups, then the review with the SWOT, a goal and "never" picked, and a
// reload that goes on where it was. Then a site: the review with the Chief's cards and its open question. The
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
    await page.locator('[data-done]').click();
    await page.locator('.co-q h1', { hasText: 'What do they do today?' }).waitFor();
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
    await page.locator('.co-answered li', { hasText: 'Order pizza' }).waitFor();
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

    // The review.
    await page.locator('.co-swot-test', { hasText: 'Ask 10 parents to pre-order' }).waitFor({ timeout: 20000 });
    await page.locator('[data-chips="goal"] [data-chip="10 parents use it every week"]').click();
    await page.locator('[data-chips="never"] [data-chip="Spend money"]').click();
    await page.locator('[data-chips="never"] [data-chip="E-mail someone new"]').click();
    await page.locator('[data-chips="never"] [data-chip="E-mail someone new"].on').waitFor();
    await page.locator('.co-knows li', { hasText: 'Asks before' }).waitFor();
    await shot(page, 'wide-review');
    let c = (await srv.api('/company')).data.company;
    assert.equal(c.name, 'Mealwise');
    assert.deepEqual(c.about.map((a) => [a.key, a.answer]), [['who', 'Parents of kids under 10'], ['today', 'Order pizza'], ['why', ''], ['signal', '10 parents use it every week'], ['test', 'Talk to 5 parents']]);
    assert.deepEqual(c.stories.map((g) => [g.who, g.items.length]), [['users', 4], ['partners', 1]]);
    assert.equal(c.goal, '10 parents use it every week');
    assert.deepEqual(c.never, ['Spend money', 'E-mail someone new']);
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

    // A site: the Chief's cards, its open question highlighted until answered.
    await srv.api('/company', { method: 'DELETE' });
    fs.writeFileSync(path.join(srv.out, 'company.txt'), JSON.stringify(SITE));
    await srv.api('/company', { method: 'POST', body: { start: 'fernhill.invalid' } });
    await page.reload();
    await page.locator('.co-card.open', { hasText: 'Who answers billing questions?' }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-co-back]').count(), 0);
    await shot(page, 'wide-site');
    await page.locator('[data-chips="about:q1"] [data-chip="You"]').click();
    await page.locator('[data-edit="q1"]', { hasText: 'You' }).waitFor();
    c = (await srv.api('/company')).data.company;
    assert.deepEqual(c.about.find((a) => a.key === 'q1'), { key: 'q1', question: 'Who answers billing questions?', answer: 'You', chips: ['You', 'Someone else'] });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.co-knows').waitFor();
    await shot(page, 'phone-site');
    assert.deepEqual(errors, []);
    console.log('company-about: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
