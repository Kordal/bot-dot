// The types of a login-kind item of the Vault: a login, an API token or any other secret. The type is a label, and
// the form the apps show for it: it forbids nothing, and every type is typed in a browser and used in an API
// call alike. On its own, without the vault's key handling, because the bots' and the Chief's tool processes
// need the list too.
const ITEM_TYPES = ['login', 'api-token', 'other'];
const isItemType = (value) => ITEM_TYPES.includes(value);
// The type of a saved item or of a login request: a login where it has none, or one this server does not know.
const itemType = (value) => (isItemType(value) ? value : 'login');
// The type a save names: undefined when it names none (a new item is then a login, a changed one keeps its
// type), or one of the three. Anything else is refused, before anything is saved.
function givenType(value) {
  if (value === undefined || value === null) return undefined;
  if (!isItemType(value)) throw new Error('Type must be login, api-token or other');
  return value;
}
// What request_login's `type` says, to a bot and to the Chief alike.
const TYPE_PARAMETER = { type: 'string', enum: ITEM_TYPES, description: '"login" (the default): a username and password for signing in. "api-token": a token or key for an API. "other": any other secret.' };

module.exports = { ITEM_TYPES, isItemType, itemType, givenType, TYPE_PARAMETER };
