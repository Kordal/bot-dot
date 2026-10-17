// Mentions on the botdot server: the rules in public/mentions.js (one file the server and the web page
// share), plus the note a run gets about the owner's "@" references, which only the server needs.
const rules = require('../public/mentions.js');
const { PLUGIN_NAME } = require('./skills'); // library skills load as "botdot:<name>"

// How the note describes the Chief, which has no description of its own.
const CHIEF_ABOUT = "the owner's Chief of Staff: it runs the team of bots and talks with the owner";

const clip = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const stop = (t) => (/[.!?…]$/.test(t) ? t : `${t}.`);
const firstLine = (t) => String(t || '').split('\n').map((l) => l.trim()).find(Boolean) || '';

// The note a run gets about the mentions in the owner's message: one line each, or '' when there are none.
// ctx as for the rules (public/mentions.js): { chat, bots (the Chief included), library }.
function mentionsNote(text, ctx) {
  const seen = new Set();
  const lines = [];
  for (const m of rules.findMentions(text, ctx)) {
    const key = `${m.kind}:${m.bot || ''}:${m.job || m.skill || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bot = ctx.bots.find((b) => b.id === m.bot);
    if (m.kind === 'bot') {
      const about = clip(bot.description || firstLine(bot.prompt), 200);
      lines.push(bot.id === ctx.chat ? `- ${m.text} is you.` : `- ${m.text} is the bot ${bot.name} (id ${bot.id})${about ? `: ${about}` : ''}`);
    } else if (m.kind === 'job') {
      const job = bot.jobs.find((j) => j.id === m.job);
      const when = job.at ? `once at ${job.at}` : job.cron ? `schedule ${job.cron}` : '';
      const task = clip(job.prompt, 300) || (job.kind === 'script' ? 'runs a script' : `${bot.name}'s main assignment`);
      lines.push(`- ${m.text} is ${bot.name}'s job "${job.name}" (id ${job.id}${when ? `, ${when}` : ''}): ${task}`);
    } else {
      const skill = ctx.library.find((k) => k.name === m.skill);
      const about = clip(skill.description, 300);
      lines.push(ctx.chat === rules.CHIEF
        ? `- ${m.text} is the skill ${skill.name} in the library${about ? `: ${about}` : ''}`
        : `- ${m.text} is your skill ${PLUGIN_NAME}:${skill.name}${about ? `: ${stop(about)}` : '.'} Load it with the Skill tool if it fits.`);
    }
  }
  if (!lines.length) return '';
  return `Mentioned in this message (the owner's "@" references, saying what the message is about; nothing was sent to them):\n${lines.join('\n')}`;
}

module.exports = { ...rules, mentionsNote, CHIEF_ABOUT };
