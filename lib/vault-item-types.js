// The types of a login-kind item of the Vault: a login, an API token, any other secret, or a GitHub App. The type of
// the first three is a label, and the form the apps show for it: it forbids nothing, and each is typed in a browser
// and used in an API call alike. A GitHub App is used by its token alone, which botdot makes from its private key
// (lib/github-app.js, #155): its key is never typed nor handed to a call or a command. On its own, without the vault's key handling, because the bots' and the Chief's tool processes
// need the list too.
const ITEM_TYPES = ['login', 'api-token', 'other', 'github-app'];
const isItemType = (value) => ITEM_TYPES.includes(value);
// The type of a saved item or of a login request: a login where it has none, or one this server does not know.
const itemType = (value) => (isItemType(value) ? value : 'login');
// The type a save names: undefined when it names none (a new item is then a login, a changed one keeps its
// type), or one of the four. Anything else is refused, before anything is saved.
function givenType(value) {
  if (value === undefined || value === null) return undefined;
  if (!isItemType(value)) throw new Error('Type must be login, api-token, other or github-app');
  return value;
}
// What request_login's `type` says, to a bot and to the Chief alike.
const TYPE_PARAMETER = { type: 'string', enum: ITEM_TYPES, description: '"login" (the default): a username and password for signing in. "api-token": a token or key for an API. "other": any other secret, e.g. a private key. "github-app": a GitHub App (its App ID and private key), used through installation tokens botdot makes.' };

module.exports = { ITEM_TYPES, isItemType, itemType, givenType, TYPE_PARAMETER };
