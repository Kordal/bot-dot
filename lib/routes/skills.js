// The skill library (lib/skills.js): import, write and give skills, to bots and to the Chief.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const chief = require('../chief');

function create(ctx) {
  const { chiefHas, attachSkill, setChiefSkills } = ctx;
  return async function routes(req, res, url, { parts, m, by }) {
    if (parts[0] === 'skills') {
      const S = B.skills;
      const usedBy = (name) => [...B.bots.list().filter((b) => b.skills.includes(name)).map((b) => b.id), ...(chiefHas(name) ? [chief.CHIEF.id] : [])];
      if (parts[1] === 'import' && m === 'POST') {
        const body = await readBody(req);
        // A link to several skills lists them all here (#30); what a bot or the Chief asks for stays one skill.
        if (parts[2] === 'preview') return send(res, 200, await S.previewImport(String(body.url || ''), { many: true }));
        if (parts[2] === 'confirm' && Array.isArray(body.skills)) {
          const done = await S.confirmImportMany(body.id, { folders: body.skills, overwrite: body.overwrite === true });
          if (Array.isArray(body.bots)) for (const name of done.imported) attachSkill(name, body.bots);
          return send(res, 201, done);
        }
        if (parts[2] === 'confirm') {
          const skill = S.confirmImport(body.id, { name: body.name });
          if (Array.isArray(body.bots)) attachSkill(skill.name, body.bots);
          return send(res, 201, skill);
        }
      }
      const name = parts[1] && decodeURIComponent(parts[1]);
      if (!name && m === 'GET') return send(res, 200, { library: S.list().map((k) => ({ ...k, usedBy: usedBy(k.name) })), machine: S.machineSkills(), builtin: S.builtinSkills() });
      if (!name && m === 'POST') {
        const body = await readBody(req);
        if (S.read(String(body.name || '').toLowerCase())) return send(res, 409, { error: `There's already a skill called "${body.name}"` });
        const skill = S.save(body, { createdBy: by });
        if (Array.isArray(body.bots)) attachSkill(skill.name, body.bots, false, by);
        return send(res, 201, skill);
      }
      const skill = name && S.read(name);
      if (!skill) return send(res, 404, { error: 'Skill not found' });
      if (m === 'GET') return send(res, 200, { ...skill, usedBy: usedBy(name) });
      if (m === 'PUT') {
        // A skill the Chief has is part of its instructions, which only the owner changes.
        if (by === 'chief' && chiefHas(name)) return send(res, 403, { error: `The user gave you "${name}" as one of your own skills, so only they change it. Nothing was changed.` });
        const body = await readBody(req);
        const next = S.rename(name, { ...skill, ...body });
        if (next.name !== name) {
          for (const b of B.bots.list()) if (b.skills.includes(name)) B.bots.update(b.id, { skills: b.skills.map((x) => (x === name ? next.name : x)) });
          if (chiefHas(name)) setChiefSkills(B.settings.get().chiefSkills.map((x) => (x === name ? next.name : x)));
        }
        if (Array.isArray(body.bots)) attachSkill(next.name, body.bots, true, by);
        return send(res, 200, next);
      }
      if (m === 'DELETE') {
        for (const b of B.bots.list()) if (b.skills.includes(name)) B.bots.update(b.id, { skills: b.skills.filter((x) => x !== name) });
        if (chiefHas(name)) setChiefSkills(B.settings.get().chiefSkills.filter((x) => x !== name));
        return send(res, 200, { ok: S.remove(name) });
      }
    }
    return NEXT;
  };
}

module.exports = { create };
