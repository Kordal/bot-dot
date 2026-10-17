// Quiet runs: a scheduled AI run that ended well with an empty reply, or a scheduled script whose output
// went to the AI (the API marks them `quiet`).
// Like a script job with no output, such a run gets no chat bubble and doesn't change the bot's preview in the
// list; it stays in the run history. Loaded after app.js: while the bot list and the bot chat are
// drawn, they see the runs without the quiet ones.

(() => {
  const withoutQuiet = (draw) => function (...args) {
    const all = state.runs;
    state.runs = all.filter((r) => !r.quiet);
    try { return draw.apply(this, args); } finally { state.runs = all; }
  };
  renderContacts = withoutQuiet(renderContacts);
  renderBotChat = withoutQuiet(renderBotChat);
})();
