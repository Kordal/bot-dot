// A GitHub App's installation token, made by botdot from the app's private key (#155, ADR 037). The owner saves the
// app in the Vault as a login of type "github-app": its App ID as the username (with "/installation ID" after it
// when the app is installed on several accounts), its private key (.pem) as the secret. A bot never gets the key:
// wherever a login's secret goes (api_request, a Board tile, run_with_login), a GitHub App gives a token that
// expires within the hour instead, with "x-access-token" as its username, as git over HTTPS takes it.
const crypto = require('node:crypto');

const TYPE = 'github-app';
const RENEW_BEFORE = 5 * 60_000; // a token is made again this long before GitHub's expiry
const API_VERSION = '2022-11-28';

// "5237335" or "5237335/12345678": the App ID and, when given, which installation.
function appIds(username) {
  const m = /^\s*(\d{1,12})\s*(?:\/\s*(\d{1,15})\s*)?$/.exec(String(username || ''));
  return m ? { appId: m[1], installationId: m[2] || '' } : null;
}

// What a save of a GitHub App is refused for, before anything is saved. password: the private key it will have,
// the one it keeps when the save changes none.
function check({ username, password }) {
  if (!appIds(username)) throw new Error('Write the GitHub App\'s App ID (a number, e.g. 5237335), and "/installation ID" after it if the app is installed on several accounts.');
  if (!password) throw new Error("Paste the GitHub App's private key (the .pem file GitHub gave), or pick the file.");
  let key;
  try { key = crypto.createPrivateKey(String(password)); } catch { throw new Error("That isn't a private key GitHub gave this app. Paste the whole .pem file, with its BEGIN and END lines, or pick the file."); }
  if (key.asymmetricKeyType !== 'rsa') throw new Error('A GitHub App\'s private key is an RSA key (".pem" from the app\'s settings on GitHub).');
}

// The API of the app's GitHub: api.github.com, or GitHub Enterprise Server's /api/v3 on the login's address.
const apiBase = (site) => (/^(api\.)?github\.com$/i.test(String(site)) ? 'https://api.github.com' : `https://${site}/api/v3`);

// Which of a bot's logins (as list_logins shows them: { name, type, site }) git signs in with to `host` over HTTPS
// (ADR 090): the first GitHub App, by name, of that GitHub (github.com, saved as github.com or api.github.com, or a
// GitHub Enterprise Server by its address). null when none is. Any other login is never handed to git.
function forGitHost(logins, host) {
  const h = String(host || '').trim().toLowerCase().replace(/:443$/, '');
  if (!h) return null;
  const apps = (logins || []).filter((l) => l?.type === TYPE && [h, `api.${h}`].includes(String(l.site || '').toLowerCase()));
  return apps.map((l) => l.name).sort((a, b) => a.localeCompare(b))[0] || null;
}

const b64url = (data) => Buffer.from(data).toString('base64url');
// The app's own token: a JWT signed with its key, for ten minutes less a minute of clock skew (GitHub's maximum).
function appJwt(appId, privateKey, now) {
  const iat = Math.floor(now / 1000) - 60;
  const head = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iat, exp: iat + 600, iss: appId }))}`;
  let signature;
  try { signature = crypto.sign('sha256', Buffer.from(head), String(privateKey)); } catch { throw new Error("This GitHub App login's secret is not a private key botdot can sign with. Ask the owner to paste the app's .pem file into it in the Vault."); }
  return `${head}.${signature.toString('base64url')}`;
}

// fetch: for the tests. now: the clock, in ms.
function create({ fetch = (...args) => globalThis.fetch(...args), now = Date.now } = {}) {
  const tokens = new Map(); // `${base}|${appId}|${installationId}|${key's hash}` -> { token, until }
  const installations = new Map(); // `${base}|${appId}|${key's hash}` -> the installation, when it has one only

  async function call(base, path, jwt, method = 'GET') {
    let res;
    try {
      res = await fetch(`${base}${path}`, { method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${jwt}`, 'X-GitHub-Api-Version': API_VERSION, 'User-Agent': 'botdot' }, signal: AbortSignal.timeout(20_000) });
    } catch (e) { throw new Error(`Couldn't reach GitHub for the app's token: ${e.cause?.code || e.message}`); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('GitHub refused the app\'s key (HTTP 401). Check the App ID and the private key of this login in the Vault.');
    if (!res.ok) throw new Error(`GitHub said ${res.status} when botdot asked for the app's token${data.message ? `: ${String(data.message).slice(0, 200)}` : ''}`);
    return data;
  }

  // The installation the token is for: the one written after the App ID, else the app's only one.
  async function installationOf(base, appId, keyHash, jwt) {
    const at = `${base}|${appId}|${keyHash}`;
    if (installations.has(at)) return installations.get(at);
    const list = await call(base, '/app/installations?per_page=100', jwt);
    if (!Array.isArray(list) || !list.length) throw new Error('This GitHub App is not installed anywhere yet. Install it on the account or the repositories it should reach, on GitHub.');
    if (list.length > 1) throw new Error(`This GitHub App is installed on several accounts (${list.map((i) => `${i.account?.login || '?'}: ${i.id}`).join(', ')}). Ask the owner to write the installation ID after the App ID in the Vault, e.g. ${appId}/${list[0].id}.`);
    installations.set(at, String(list[0].id));
    return String(list[0].id);
  }

  // A token for this app's installation, made again a few minutes before it expires.
  async function token({ site, username, password }) {
    const ids = appIds(username);
    if (!ids) throw new Error('This GitHub App login has no App ID. Ask the owner to write it in the Vault.');
    if (!password) throw new Error('This GitHub App login has no private key. Ask the owner to add it in the Vault.');
    const base = apiBase(site);
    const keyHash = crypto.createHash('sha256').update(String(password)).digest('hex');
    const known = ids.installationId && tokens.get(`${base}|${ids.appId}|${ids.installationId}|${keyHash}`);
    if (known && known.until > now()) return known.token;
    const jwt = appJwt(ids.appId, password, now());
    const installationId = ids.installationId || await installationOf(base, ids.appId, keyHash, jwt);
    const at = `${base}|${ids.appId}|${installationId}|${keyHash}`;
    const kept = tokens.get(at);
    if (kept && kept.until > now()) return kept.token;
    let made;
    try { made = await call(base, `/app/installations/${installationId}/access_tokens`, jwt, 'POST'); } catch (e) {
      installations.delete(`${base}|${ids.appId}|${keyHash}`); // found, not written: found again next time (reinstalled)
      throw e;
    }
    if (!made.token) throw new Error('GitHub gave no token for the app');
    const expires = Date.parse(made.expires_at) || now() + 60 * 60_000;
    tokens.set(at, { token: made.token, until: expires - RENEW_BEFORE });
    return made.token;
  }

  // The login a GitHub App is used as: its token in place of its key. Any other login as it is.
  async function asLogin(creds) {
    if (creds.type !== TYPE) return creds;
    const { password, ...rest } = creds;
    return { ...rest, username: 'x-access-token', password: await token(creds) };
  }

  return { token, asLogin };
}

module.exports = { TYPE, appIds, check, apiBase, forGitHost, appJwt, create, ...create() };
