// Settings (/api/settings): the defaults and the Chief's skills, quiet hours, writing first, the checkup, the Chief's
// name and the list of models.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const chief = require('../chief');
const feed = require('../events');

function create(ctx) {
  const { nameChief } = ctx;
  // The library skills of a list, in its order (what the owner may give the Chief).
  const librarySkills = (names) => (Array.isArray(names) ? names.map((n) => String(n).trim().toLowerCase()).filter((n) => B.skills.NAME_RE.test(n) && B.skills.read(n)) : names);
  return async function routes(req, res, url, { parts, m, by, standing }) {
    if (parts[0] === 'settings') {
      if (parts[1] === 'refresh-models' && m === 'POST') { await B.settings.refreshCatalog(); return send(res, 200, { settings: B.settings.get(), ...B.settings.choices() }); }
      // When scheduled AI reports wait till morning: the Chief may read and change just this.
      if (parts[1] === 'quiet-hours') {
        if (m === 'PUT') B.settings.update({ quietHours: { ...B.settings.get().quietHours, ...(await readBody(req)) } });
        return send(res, 200, { quietHours: B.settings.get().quietHours });
      }
      // How often the Chief may write first (its unasked messages): the Chief may read and change just this too.
      if (parts[1] === 'writing-first') {
        if (m === 'PUT') B.settings.update({ unaskedPerDay: (await readBody(req)).perDay ?? null });
        return send(res, 200, { writingFirst: chief.looks.status() });
      }
      // The Chief's name (#41). The owner names it in setup; later they ask the Chief, whose set_your_name tool changes
      // it here, only in a turn the owner started: a bot's reply or a page must not rename it.
      if (parts[1] === 'chief-name') {
        if (m === 'PUT') {
          if (by === 'chief' && standing()?.startedBy !== 'owner') return send(res, 403, { error: 'Not done: you change your name only in a turn the user started by writing to you. Nothing was changed.' });
          try { nameChief((await readBody(req)).name); } catch (e) { return send(res, 400, { error: e.message }); }
        }
        return send(res, 200, { name: B.settings.chiefName() });
      }
      // The checkup (ADR 023): whether it runs, on which days and at what time, and whether it may search the web.
      // The owner's switches and the Chief's checkup_settings tool both change it here; a change is announced.
      if (parts[1] === 'checkup') {
        if (m === 'PUT') {
          const b = await readBody(req);
          // The Chief changes it only in a turn the owner started by writing to it, and switches web search on only
          // before that turn read anything that is not the owner's: a bot's reply or a page must not be what opens
          // the web to a session that holds every chat (ADR 023).
          const turn = by === 'chief' ? standing() : null;
          if (by === 'chief' && turn?.startedBy !== 'owner') return send(res, 403, { error: 'Not done: you change the checkup only in a turn the user started by writing to you. Nothing was changed. Say what you would have changed; the user can tell you to.' });
          if (by === 'chief' && b.webSearch === true && turn.read.length) return send(res, 403, { error: "Not done: after reading a bot's text or outside content in this turn you can't switch a checkup's web search on. Nothing was changed. Tell the user they can switch it on in your settings, or ask you again in a new message." });
          try { B.settings.update({ checkup: Object.fromEntries(['on', 'days', 'time', 'webSearch'].filter((k) => b[k] !== undefined).map((k) => [k, b[k]])) }); } catch (e) { return send(res, 400, { error: e.message }); }
          feed.emit('checkup', chief.checkups.status());
        }
        return send(res, 200, { checkup: chief.checkups.status() });
      }
      if (m === 'GET') return send(res, 200, { settings: B.settings.get(), ...B.settings.choices() });
      if (m === 'PUT') { // the checkup has its own route, which announces a change
        const { checkup: _ownRoute, ...body } = await readBody(req);
        if (body.chiefSkills !== undefined) body.chiefSkills = librarySkills(body.chiefSkills); // only skills of the library
        const { chiefName, ...rest } = body;
        try { if (chiefName !== undefined) nameChief(chiefName); } catch (e) { return send(res, 400, { error: e.message }); }
        return send(res, 200, { settings: B.settings.update(rest), ...B.settings.choices() });
      }
    }
    return NEXT;
  };
}

module.exports = { create };
