const { holds } = require('./choices');
const { likeScheduled } = require('./reporting');

// A failed or stopped run, said the way a person would: what went wrong and what to do about it.
// The web page and the phone app both show this instead of the raw error (which stays in the run's details).

// A run that was ended says who ended it (`endedBy` on the run, ADR 012; docs/api.md "Who ended it"). The limit's
// sentence is a Chief reply's too.
const LIMIT = 'I stopped after 60 minutes: this took too long. Send it again, or break it into smaller pieces.';
const ENDED = {
  owner: 'You stopped this run before it finished.',
  chief: 'The Chief stopped this run before it finished.',
  signout: 'This run was stopped because Claude was signed out.',
  limit: LIMIT,
};
// A Chief reply that was ended: its `error`.
const REPLY_ENDED = {
  owner: 'You stopped this reply.',
  signout: 'This reply was stopped because Claude was signed out.',
  limit: LIMIT,
};

// A Claude Code that cannot take its appended prompt from a file (ADR 014): no run and no reply is started with
// it. One sentence, said at start, in Setup's checklist (lib/setup.js) and as the error of every run asked for.
// version: what `claude --version` said, or nothing.
function claudeTooOld(version) {
  const number = String(version || '').match(/\d+\.\d+\.\d+/)?.[0];
  return `Claude Code on this machine is too old for botdot${number ? ` (${number})` : ''}: it cannot read a bot's instructions from a private file, and botdot never puts them on the command line. Update Claude Code and restart botdot; until then no bot can run and the Chief cannot reply.`;
}
const TOO_OLD = /is too old for botdot/;
// The account's disk is full (its share of the machine, ADR 028): said as this, and nothing of a size or a limit.
const NO_SPACE = 'No space left on the server.';
const { NO_SPACE_ERROR } = require('./disk-space');

// details: whether there's a details view to point to (a bot's run has one, a Chief reply doesn't).
function friendlyProblem(meta, resultText = meta.result, { details = true } = {}) {
  const text = `${resultText || ''} ${meta.error || ''}`;
  if (Object.hasOwn(ENDED, meta.endedBy)) return ENDED[meta.endedBy];
  if (meta.status === 'stopped') return ENDED.owner; // a run from before botdot kept who
  if (meta.status === 'interrupted') return 'This run was cut off because botdot was restarted.';
  if (/without a reply botdot could read/.test(meta.error || '')) return meta.error; // bots.js unreadableReply: already plain
  if (TOO_OLD.test(meta.error || '')) return meta.error; // claudeTooOld: already plain
  if (meta.error === NO_SPACE || NO_SPACE_ERROR.test(meta.error || '')) return NO_SPACE;
  if (/not logged in|\/login/i.test(text)) return "I couldn't start because Claude isn't signed in yet. Open Settings → Setup and sign in to Claude, then try again.";
  // Claude's servers refused the sign-in (a revoked or expired token): Claude Code's "Failed to authenticate. API Error: 401".
  if (/Failed to authenticate|authentication_error|API Error: 401/i.test(text)) {
    return `Claude refused my sign-in, so I couldn't finish. ${meta.jobName ? 'I will try again at the next scheduled time' : 'Send it again'}; if this keeps happening, sign in to Claude again in Settings → Setup.`;
  }
  if (/max.?turns/i.test(text)) return 'The task took more steps than I was allowed. Try breaking it into smaller pieces.';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|reach the API server|network error|fetch failed/i.test(text)) {
    return `I couldn't reach Claude's servers, so I couldn't start. This computer had no internet connection, or couldn't look up the address (a DNS problem).${meta.jobName ? ' I will try again at the next scheduled time.' : ' Check the connection and send the message again.'}`;
  }
  if (/overloaded|529|rate.?limit|429|usage limit/i.test(text)) return "Claude's servers were busy or my usage limit was reached, so I stopped. Try again in a little while.";
  // Something else: say what it was, briefly.
  const why = String(meta.error || resultText || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return `Something went wrong and I couldn't finish.${why ? ` It said: “${why}”.` : ''}${details ? ' The details show everything that happened.' : ''}`;
}

// A scheduled AI run that ended well but said nothing (the bot found nothing to report). Like a script
// job with no output, it shows no chat bubble, notification or preview; it stays in the run history.
// So does a scheduled script that ended well and handed its output to the AI (`handedOver`, bots.js):
// the AI's report is what reaches the owner.
// And a scheduled job's failed run that is not told (reporting.js finishReport): a failure of its row after the
// first, the first while it is held for the morning, and a run that a sign-out of Claude ended.
// A reply that holds a question for the owner and was delivered as one (reporting.js finishReport never makes it
// private) is not "said nothing", though its text may be empty: it is quiet only while it is held for the morning.
// A run from before botdot delivered questions has no such mark and stays as it was.
// A turn in a group that ended as a pass is quiet too (`passed`, ADR 019): the member had nothing to say.
const quietRun = (meta) => !!meta.passed || likeScheduled(meta.trigger) && (meta.status === 'error' ? ['quiet', 'held'].includes(meta.reporting)
  : meta.status === 'success' && (meta.kind === 'script' ? !!meta.handedOver : ['quiet', 'suppressed', 'held'].includes(meta.reporting) || (!String(meta.result ?? '').trim() && !meta.files?.length && !(meta.reporting === 'delivered' && holds(meta)))));

// A failure that was held through quiet hours says how often its job failed since, when that is more than once
// (`row` on the run, bots.js): "Failed 3 times since 02:00. ", in the server's time zone, which is the owner's.
function failedSince(meta) {
  if (meta.reporting !== 'delivered' || !(meta.row?.failures > 1)) return '';
  const d = new Date(meta.row.since);
  return `Failed ${meta.row.failures} times since ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}. `;
}

// The run as the API sends it: with `problem` when it didn't finish well, `quiet` when it has nothing for the owner.
function withProblem(meta) {
  if (!meta) return meta;
  const failed = ['error', 'stopped', 'interrupted'].includes(meta.status);
  const quiet = quietRun(meta);
  return failed || quiet ? { ...meta, ...(failed ? { problem: failedSince(meta) + friendlyProblem(meta) } : {}), ...(quiet ? { quiet: true } : {}) } : meta;
}

module.exports = { friendlyProblem, withProblem, quietRun, claudeTooOld, ENDED, REPLY_ENDED, NO_SPACE };
