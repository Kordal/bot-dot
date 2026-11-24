// The slug a remote MCP server has where botdot treats it as an app (ADR 266): `mcp-` and eight hex digits, made when
// the owner adds it. No Composio app has one, so a server can never be, or shadow, a connected app in a card or a grant.
const CUSTOM_APP = /^mcp-[0-9a-f]{8}$/;
const isCustomApp = (slug) => CUSTOM_APP.test(String(slug ?? ''));
module.exports = { CUSTOM_APP, isCustomApp };
