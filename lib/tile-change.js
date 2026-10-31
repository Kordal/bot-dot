// The owner's ask to change one Board tile, as the message the Chief of Staff gets: a quoted line that names the tile
// (its title, id, heading and bot), so the Chief finds it for update_tile, then the owner's words as they wrote them.
function changeAsk(tile, text, botName = null) {
  const about = [`Board tile “${tile.title}”`, `id ${tile.id}`, tile.section ? `heading ${tile.section}` : '', botName ? `bot ${botName}` : '']
    .filter(Boolean).join(' · ');
  return `> ${about.replace(/\s+/g, ' ')}\n\n${String(text).trim()}`;
}

// The owner's ask to change one of a project's goals (#819), from its tile on the Projects screen: a quoted line that
// names the goal (its name, id, where it stands and its project's id), so the Chief finds it for set_company_objective
// or set_project_dates, then the owner's words.
function objectiveAsk(o, project, text) {
  const about = [`Project goal “${o.name}”`, `id ${o.id}`, o.target > 0 ? `${o.current} of ${o.target}` : o.done ? 'done' : '', `project ${project.id}`]
    .filter(Boolean).join(' · ');
  return `> ${about.replace(/\s+/g, ' ')}\n\n${String(text).trim()}`;
}

module.exports = { changeAsk, objectiveAsk };
