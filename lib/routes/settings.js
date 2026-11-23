// Settings (/api/settings): the defaults and the Chief's skills, quiet hours, writing first, the checkup, the Chief's
// name, the size of the account's boat.dev machines and the list of models.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const chief = require('../chief');
const feed = require('../events');
const { tr } = require('../i18n');

function create(ctx) {
  const { nameChief, fromFrontDoor } = ctx;
  // Who may choose where the account's computer is and how big its External Virtual PC is (ADR 146, ADR 163, ADR 263): the
  // admin, on the admin page, while the machine's boat.dev key pays; the owner, in Settings, while the account's own
  // key does (the front door sets x-botdot-room on its own requests and strips it from everyone's). Never the Chief or a bot.
  const adminAsks = (req) => fromFrontDoor(req) && req.headers['x-botdot-room'] === '1';
  const mayChoose = (req, by) => (B.boatOwnKey() ? by === 'you' && req.headers['x-botdot-room'] !== '1' : by !== 'chief' && by !== 'bot' && adminAsks(req));
  const NOT_YOURS = (what) => (B.boatOwnKey()
    ? `Not done: the account pays for its External Virtual PC with its own boat.dev key, so its owner chooses ${what}, in Settings → Computer. Nothing was changed.`
    : `Not done: the admin chooses ${what}, on the admin page. Nothing was changed.`);
  // The library skills of a list, in its order (what the owner may give the Chief).
  const librarySkills = (names) => (Array.isArray(names) ? names.map((n) => String(n).trim().toLowerCase()).filter((n) => B.skills.NAME_RE.test(n) && B.skills.read(n)) : names);
  return async function routes(req, res, url, { parts, m, by, standing }) {
    if (parts[0] === 'settings') {
      if (parts[1] === 'refresh-models' && m === 'POST') {
        if (url.searchParams.has('catalog')) await B.settings.refreshModelCatalog();
        else if (!(await B.settings.refreshChoices())) return send(res, 502, { error: tr(req.lang, "Couldn't refresh the provider's reasoning levels.") });
        return send(res, 200, { settings: B.settings.get(), ...B.settings.choices(req.lang) });
      }
      // When scheduled AI reports wait till morning: the Chief may read and change just this.
      if (parts[1] === 'quiet-hours') {
        if (m === 'PUT') B.settings.update({ quietHours: { ...B.settings.get().quietHours, ...(await readBody(req)) } });
        return send(res, 200, { quietHours: B.settings.get().quietHours });
      }
      // How often and when the Chief may write first (its unasked messages, #416): the Chief may read and change just
      // this too, and whether it worries about the owner (ADR 212). Only what is passed changes; a body with none is
      // refused, as a wrong value is.
      if (parts[1] === 'writing-first') {
        if (m === 'PUT') {
          const b = await readBody(req);
          const any = ['perDay', 'times', 'care', 'careQuiet'].some((k) => k in b);
          B.settings.update({ ...('perDay' in b || !any ? { unaskedPerDay: b.perDay ?? null } : {}), ...('times' in b ? { lookTimes: b.times } : {}), ...('care' in b ? { care: b.care } : {}), ...('careQuiet' in b ? { careQuiet: b.careQuiet } : {}) });
        }
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
          feed.emit('checkup', chief.checkups.status(B.settings.get().language));
        }
        return send(res, 200, { checkup: chief.checkups.status(req.lang) });
      }
      // The size of the account's boat.dev machines (#539): the choice and the sizes, each with whether boat.dev makes
      // it now. Only while boat.dev is set up here. Only the admin chooses it, on the admin page (ADR 163), as where the
      // computer is (ADR 146): the front door itself asks, with the header it alone sets. The owner and the Chief read it.
      // The account's own boat.dev key (#1617, ADR 263) wins over the machine's, and then the owner chooses both.
      if (parts[1] === 'boat-size') {
        if (!B.boatReady()) return send(res, 404, { error: 'boat.dev is not set up on this machine.' });
        if (m === 'PUT') {
          if (!mayChoose(req, by)) return send(res, 403, { error: NOT_YOURS("the size of the account's External Virtual PC") });
          try { B.settings.update({ boatSize: (await readBody(req)).size }); } catch (e) { return send(res, 400, { error: e.message }); }
        }
        return send(res, 200, { size: B.settings.get().boatSize, sizes: await B.boatSizes(), ownKey: B.boatOwnKey() });
      }
      // The account's own boat.dev key (#1617, ADR 263): checked with boat.dev, kept encrypted with the account's Vault key
      // and never answered: the apps see that one is set, what boat.dev said of it and how many machines it made. The
      // owner's alone to set, replace or remove (the Chief and a bot get 403): it makes the account's boat.dev cost the
      // owner. Removing it needs ?machines=delete or ?machines=keep when it made machines (409 says how many).
      if (parts[1] === 'boat-key' && !parts[2]) {
        if (m === 'GET') return send(res, 200, await B.boatKeyStatus({ fresh: url.searchParams.get('fresh') === '1' }));
        if (m !== 'PUT' && m !== 'DELETE') return send(res, 405, { error: 'GET, PUT or DELETE' });
        if (by !== 'you' || req.headers['x-botdot-room'] === '1') return send(res, 403, { error: 'Not done: the owner adds, replaces or removes their own boat.dev key, in Settings → Computer. Nothing was changed.' });
        try {
          if (m === 'PUT') return send(res, 200, await B.setBoatKey((await readBody(req, 4e3))?.key));
          const answer = url.searchParams.get('machines');
          const gone = await B.removeBoatKey({ deleteMachines: answer === 'delete' ? true : answer === 'keep' ? false : undefined });
          feed.emit('bots', {});
          return send(res, 200, gone);
        } catch (e) { return send(res, e.status || 400, { error: e.message, ...(e.check ? { check: e.check } : {}), ...(e.machines !== undefined ? { machines: e.machines } : {}) }); }
      }
      // Where the account's computer is (#579, ADR 098): this machine ('linux') or its External Virtual PC on boat.dev
      // ('boat'), for every bot with a computer. A switch moves them all there, their files copied with moveFiles.
      // Only the admin switches it, on the admin page (ADR 146): the front door itself asks, with the header it alone
      // sets and strips from every request a person sends. The owner and the Chief only read it.
      if (parts[1] === 'computer' && !parts[2]) {
        if (m === 'PUT') {
          if (!mayChoose(req, by)) return send(res, 403, { error: NOT_YOURS("where the account's computer is") });
          const body = (await readBody(req)) || {};
          try { B.setComputerPlace(body.place, { moveFiles: body.moveFiles === true }); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
          feed.emit('bots', {});
        } else if (m !== 'GET') return send(res, 405, { error: 'GET or PUT' });
        return send(res, 200, { place: B.computerPlace(), boat: B.boatReady(), ownKey: B.boatOwnKey() });
      }
      if (m === 'GET') return send(res, 200, { settings: B.settings.get(), ...B.settings.choices(req.lang) });
      if (m === 'PUT') { // the checkup, the boat.dev size, the computer's place and the proxy have their own routes
        const { checkup: _ownRoute, boatSize: _sizeRoute, computerPlace: _placeRoute, proxy: _proxyRoute, ...body } = await readBody(req);
        if (body.chiefSkills !== undefined) body.chiefSkills = librarySkills(body.chiefSkills); // only skills of the library
        const { chiefName, ...rest } = body;
        try { if (chiefName !== undefined) nameChief(chiefName); } catch (e) { return send(res, 400, { error: e.message }); }
        const before = B.settings.get().language;
        let settings;
        try { settings = B.settings.update(rest); } catch (e) { return send(res, 400, { error: e.message }); }
        if (settings.language !== before) feed.emit('language', { language: settings.language }); // the other app follows
        return send(res, 200, { settings, ...B.settings.choices(req.lang) });
      }
    }
    return NEXT;
  };
}

module.exports = { create };
