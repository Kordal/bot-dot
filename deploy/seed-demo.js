'use strict';
// Fictional review data, written through the account API. A rerun fills missing pieces and keeps reviewers' edits.
const http = require('node:http');
async function seed(request) {
  const name = 'Demo: community garden';
  let { projects = [] } = await request('GET', '/api/company/list');
  let project = projects.find((p) => p.name === name);
  if (!project) project = await request('POST', '/api/company', { empty: true, name });
  const q = `?project=${encodeURIComponent(project.id)}`;
  if (!project.goal) await request('PATCH', `/api/company${q}`, { goal: 'Plan a fictional community garden opening', board: ['goals', 'todo', 'calendar', 'files'] });
  const current = (await request('GET', `/api/company${q}`)).company;
  for (const text of ['Demo: choose plants for the entrance', 'Demo: draft a fictional opening invitation']) {
    if (!(current.todos || []).some((t) => t.text === text)) await request('POST', `/api/company/todos${q}`, { text });
  }
  await request('PUT', '/api/setup', { done: true });
}
function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ socketPath: '/socket/botdot.sock', path: url, method, headers: { 'X-Bot-Dot': '1', 'X-Botdot-Account': process.env.BOT_DOT_ACCOUNT, ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}) } }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 300) return reject(new Error(`Demo seed ${method} ${url}: ${res.statusCode}`));
        try { resolve(JSON.parse(text)); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(30_000, () => req.destroy(new Error('Demo seed request timed out')));
    req.on('error', reject);
    req.end(bytes);
  });
}
if (require.main === module) seed(request).catch((e) => { console.error(e.message); process.exitCode = 1; });
module.exports = { seed };
