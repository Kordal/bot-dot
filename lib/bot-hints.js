// The hints create_bot and update_bot answer with (#1543, docs/decisions/2026-11-19-bot-hints-are-cheap-patterns-in-the-mcp-layer.md):
// short plain sentences for the Chief about a bot it just saved, from a few patterns and no AI. They advise: the bot
// is saved as sent, and the Chief acts on a hint in the same turn or tells the owner why not.

// "Never", "does not", "don't", "won't", and the Polish "nigdy" and "nie": any of them is a line about what the bot never does.
const NEVER = /\b(?:never|not|nigdy|nie)\b|n['’]t\b/i;
// A time the bot wakes at, in words: "every morning", "every 15 minutes", "daily", "at 8:00", "codziennie".
const SCHEDULE = /\bevery\s+(?:\d+\s+)?(?:minutes?|hours?|days?|weeks?|months?|mornings?|evenings?|nights?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)\b|\b(?:daily|hourly|weekly|monthly|nightly|on a schedule|codziennie|co rano|co tydzie|co godzin|co \d+ (?:minut|godzin)\w*)\b|\bat \d{1,2}[:.]\d{2}\b/i;
// The part of the task about when it wakes: its "Wake:" line when it has one, else all of it.
const wakePart = (prompt) => (/^[^\S\n]*(?:wake|wakes)\b[^\n]*/im.exec(prompt)?.[0] ?? /\bwake:[^\n]*/i.exec(prompt)?.[0] ?? prompt);

// prompt: the task as the Chief sent it. verbatim: the owner dictated it word for word, so what it lacks is not
// a miss. jobs: the bot's jobs as saved. bot and others: the bot and every bot (its icon and hat are compared
// with theirs); outfitAsked: the outfit the call passed, so only a piece it set is compared.
function hintsFor({ prompt, verbatim = false, jobs = [], bot, others = [], outfitAsked }) {
  const hints = [];
  if (typeof prompt === 'string') {
    if (!verbatim && !NEVER.test(prompt)) hints.push('The task has no line on what the bot never does: add one (or, if the owner dictated the task word for word, leave it as it is).');
    if (!jobs.length && SCHEDULE.test(wakePart(prompt))) hints.push('The task says when the bot wakes on a schedule, but it has no job yet; add it with add_job.');
  }
  if (bot && outfitAsked) {
    for (const piece of ['icon', 'hat']) {
      const mine = bot.outfit?.[piece];
      if (outfitAsked[piece] === undefined || typeof mine !== 'string' || !mine) continue;
      const taken = others.find((o) => o.id !== bot.id && o.outfit?.[piece] === mine);
      if (taken) hints.push(`The ${piece} "${mine}" is ${taken.name}'s too: pick another, so the owner can tell the bots apart.`);
    }
  }
  return hints;
}

module.exports = { hintsFor };
