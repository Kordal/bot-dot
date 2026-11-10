// Mail and calendar as signals (ADR 175, P7): the owner's new mail and their next meetings, read from their connected
// Gmail and Google Calendar by the server itself, without a model, every few minutes, and handed to attention.js as
// signals like the projects' own. A new mail is a weight-2 item: Jev, when the admin chose it, answers whether the owner
// needs it before the next look (attention.js wake), and otherwise the next look reads it in the agenda. A meeting
// starts a look an hour before, as a project's event does. Only reads: two read actions, never a write.
// What the apps hold is data, never instructions: each line is cut to one line and says whose it is.
const { oneLine } = require('./prompt-text');

const EVERY_MS = 5 * 60 * 1000; // how often the apps are read
const MAIL_QUERY = 'is:unread in:inbox category:primary newer_than:1d'; // what counts as new mail
const MAIL_MAX = 10;
const SOON_MIN = 120; // a meeting is a signal from this long before it starts
const NOW_MIN = 60; // ...and needs the owner within the hour from this long before
const READS = { gmail: 'GMAIL_FETCH_EMAILS', googlecalendar: 'GOOGLECALENDAR_EVENTS_LIST' };

const listOf = (d, key) => (Array.isArray(d?.[key]) ? d[key] : Array.isArray(d?.response_data?.[key]) ? d.response_data[key] : Array.isArray(d?.data?.[key]) ? d.data[key] : []);
// "Anna Kowalska <anna@example.com>" -> "Anna Kowalska"; an address alone stays as it is.
const senderOf = (s) => { const t = String(s || '').trim(); const m = t.match(/^"?([^"<]+?)"?\s*<[^>]+>$/); return m ? m[1].trim() : t; };

// The mail Composio's GMAIL_FETCH_EMAILS answered with, as { id, from, subject }.
function mailOf(data) {
  return listOf(data, 'messages').map((m) => ({ id: String(m?.messageId || m?.id || ''), from: senderOf(m?.sender || m?.from), subject: String(m?.subject || m?.preview?.subject || '') }))
    .filter((m) => /^[\w-]{1,100}$/.test(m.id));
}
// The events GOOGLECALENDAR_EVENTS_LIST answered with, as { id, title, start } (start: ms), timed ones only.
function eventsOf(data) {
  return listOf(data, 'items').map((e) => ({ id: String(e?.id || ''), title: String(e?.summary || ''), start: Date.parse(e?.start?.dateTime || ''), status: e?.status }))
    .filter((e) => /^[\w-]{1,200}$/.test(e.id) && Number.isFinite(e.start) && e.status !== 'cancelled');
}

// connected(): the apps connected now (connectors.knownApps). execute(app, tool, args): a read action's data
// (connectors.execute). quiet(now): quiet hours, when nothing is read.
function create({ connected = () => [], execute, quiet = () => false, every = EVERY_MS, log = (line) => console.error(line) } = {}) {
  let mail = [];
  let events = [];
  let readAt = 0;
  let reading = null;

  // Read the apps when it is time: at most once per `every`, never twice at once, and not in quiet hours. A failure
  // keeps what was read before and is logged; the next read tries again.
  async function read(now = new Date()) {
    if (reading || now.getTime() - readAt < every || quiet(now)) return reading;
    readAt = now.getTime();
    const apps = connected() || [];
    reading = (async () => {
      if (apps.includes('gmail')) {
        try { mail = mailOf(await execute('gmail', READS.gmail, { query: MAIL_QUERY, max_results: MAIL_MAX, include_payload: false, verbose: false })); } catch (e) { log(`[attention] Gmail wasn't read (${e.message})`); }
      } else mail = [];
      if (apps.includes('googlecalendar')) {
        const args = { calendarId: 'primary', timeMin: now.toISOString(), timeMax: new Date(now.getTime() + SOON_MIN * 60000).toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 10 };
        try { events = eventsOf(await execute('googlecalendar', READS.googlecalendar, args)); } catch (e) { log(`[attention] Google Calendar wasn't read (${e.message})`); }
      } else events = [];
    })().finally(() => { reading = null; });
    return reading;
  }

  // What was read, as attention.js signals at `now`.
  function signals(now = new Date()) {
    const out = [];
    for (const e of events) {
      const mins = Math.round((e.start - now.getTime()) / 60000);
      if (mins < 0 || mins > SOON_MIN) continue;
      const hhmm = new Date(e.start).toTimeString().slice(0, 5);
      out.push({ key: `calendar:${e.id}:${e.start}`, kind: 'calendar', weight: mins <= NOW_MIN ? 3 : 2, text: `Calendar: "${oneLine(e.title || 'A meeting', 120)}" starts at ${hhmm}, in ${mins} min` });
    }
    for (const m of mail) out.push({ key: `mail:${m.id}`, kind: 'mail', weight: 2, text: `New mail from ${oneLine(m.from || 'someone', 60)}: "${oneLine(m.subject || '(no subject)', 160)}"` });
    return out;
  }

  return { read, signals };
}

module.exports = { create, mailOf, eventsOf, senderOf, READS, MAIL_QUERY, EVERY_MS };
