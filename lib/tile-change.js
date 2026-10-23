// The owner's ask to change one Board tile, as the message the Chief of Staff gets: a quoted line that names the tile
// (its title, id, heading and bot), so the Chief finds it for update_tile, then the owner's words as they wrote them.
function changeAsk(tile, text, botName = null) {
  const about = [`Board tile “${tile.title}”`, `id ${tile.id}`, tile.section ? `heading ${tile.section}` : '', botName ? `bot ${botName}` : '']
    .filter(Boolean).join(' · ');
  return `> ${about.replace(/\s+/g, ' ')}\n\n${String(text).trim()}`;
}

module.exports = { changeAsk };
