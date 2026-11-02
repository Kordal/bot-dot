// A browser check going to a space (ADR 132): Home or a project's square in the rail of a wide window (#837), else
// the title's sheet below 1001 px (#839). `where`: 'home', 'project' for the first project, or 'new' for New project
// (with no project yet too, #853).
async function goSpace(page, where = 'project') {
  const rail = page.locator('#rail .rail-home:visible');
  const title = page.locator('.side-head .brand-chev:visible, [data-space-pick]:visible');
  await rail.or(title).first().waitFor({ timeout: 20000 });
  if (await rail.count()) {
    if (where !== 'new') return page.locator(where === 'home' ? '#rail .brand' : '#rail .rail-sq').first().click();
    await page.locator('#rail [data-rail-new]').click(); // "+": New bot or New project (#853)
    return page.locator('.ct-menu [data-new-project]').click();
  }
  await title.first().click();
  const sheet = page.locator('#spaces-sheet');
  await (where === 'home' ? sheet.locator('[data-space="home"]') : where === 'new' ? sheet.locator('[data-space=""]') : sheet.locator('.sp-row:not([data-space="home"]):not([data-space=""])').first()).click();
}

module.exports = { goSpace };
