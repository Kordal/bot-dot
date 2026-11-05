// @ts-check
// The machine's off-site backup set up from the admin page (#1016, ADR 161): with an API token of the Hetzner Console
// project that holds a Storage Box, the front door makes a sub-account of the box for this machine, named after the
// machine, with a new random password and SSH on. Root's step (OFFSITE-SET, install.sh) then puts this
// machine's SSH key on it with that password once and opens the repository there. Neither the token nor the
// sub-account's password is kept: both live only in this request and in the request file root's step removes as it
// reads it.
const crypto = require('node:crypto');

const API = () => (process.env.FRONT_DOOR_HETZNER_API || 'https://api.hetzner.com/v1').replace(/\/+$/, '');
const ACTION_WAIT_MS = () => Number(process.env.FRONT_DOOR_HETZNER_WAIT_MS) || 60_000;

class HetznerError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) { super(message); this.status = status; }
}

/** @param {string} token @param {string} method @param {string} path @param {object} [body] */
async function call(token, method, path, body, { fetch = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetch(`${API()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new HetznerError("Hetzner can't be reached. Try again.", 502);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new HetznerError('Hetzner refused this token.', 400);
  if (res.status === 403) throw new HetznerError('This token can only read. Make one that can read and write.', 400);
  if (!res.ok) {
    const said = typeof data?.error?.message === 'string' ? data.error.message.replace(/[^\x20-\x7e]/g, ' ').slice(0, 200) : `HTTP ${res.status}`;
    throw new HetznerError(`Hetzner said: ${said}`, 502);
  }
  return data;
}

/** The project's Storage Boxes: [{ id, name, server }]. */
async function boxes(token, opts) {
  const data = await call(token, 'GET', '/storage_boxes?per_page=50', undefined, opts);
  return (Array.isArray(data.storage_boxes) ? data.storage_boxes : [])
    .filter((b) => Number.isInteger(b?.id))
    .map((b) => ({ id: b.id, name: typeof b.name === 'string' ? b.name.slice(0, 100) : String(b.id), server: typeof b.server === 'string' ? b.server : null }));
}

// A password Hetzner's policy takes: upper and lower case letters, digits and a special character.
const password = () => `Bd7-${crypto.randomBytes(20).toString('hex')}`;

// The sub-account's name and folder: the machine's host name (its first label), as botdot-hq. It holds every account
// of the machine, each tagged account=<name> in the repository (ADR 157), so it is named after the machine alone.
/** @param {string} hostname */
function subaccountName(hostname) {
  const host = /^[0-9.]+$|^\[|^localhost$/.test(hostname) ? '' : hostname.split('.')[0];
  const name = `botdot-${host}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return name.slice(0, 40);
}

/** @param {string} token @param {any} action */
async function waitFor(token, action, opts) {
  if (!action || !Number.isInteger(action.id)) return;
  const until = Date.now() + ACTION_WAIT_MS();
  let a = action;
  while (a.status === 'running') {
    if (Date.now() > until) throw new HetznerError("Hetzner hasn't finished making the sub-account. Try again in a minute.", 504);
    await new Promise((r) => setTimeout(r, 1000));
    a = (await call(token, 'GET', `/storage_boxes/actions/${action.id}`, undefined, opts)).action || { status: 'error' };
  }
  if (a.status === 'error') throw new HetznerError(`Hetzner couldn't make the sub-account${a.error?.message ? `: ${String(a.error.message).slice(0, 200)}` : '.'}`, 502);
}

// The sub-account named so on the box, made now, or given a new password when it is there already (a setup tried
// again): { username, server, password, home }.
/** @param {string} token @param {number} box @param {string} name @param {string} instance */
async function subaccount(token, box, name, instance, opts) {
  const pass = password();
  const listed = await call(token, 'GET', `/storage_boxes/${box}/subaccounts`, undefined, opts);
  let sub = (Array.isArray(listed.subaccounts) ? listed.subaccounts : []).find((s) => s?.name === name);
  if (sub) {
    const made = await call(token, 'POST', `/storage_boxes/${box}/subaccounts/${sub.id}/actions/reset_subaccount_password`, { password: pass }, opts);
    await waitFor(token, made.action, opts);
    if (!sub.access_settings?.ssh_enabled || !sub.access_settings?.reachable_externally) {
      const on = await call(token, 'POST', `/storage_boxes/${box}/subaccounts/${sub.id}/actions/update_access_settings`, { ssh_enabled: true, reachable_externally: true }, opts);
      await waitFor(token, on.action, opts);
    }
  } else {
    const made = await call(token, 'POST', `/storage_boxes/${box}/subaccounts`, {
      name, home_directory: name, password: pass, description: `botdot ${instance}`.trim(),
      access_settings: { ssh_enabled: true, reachable_externally: true, readonly: false, samba_enabled: false, webdav_enabled: false },
      labels: { botdot: instance || 'machine' },
    }, opts);
    await waitFor(token, made.action, opts);
    const id = made.subaccount?.id;
    if (!Number.isInteger(id)) throw new HetznerError("Hetzner didn't say which sub-account it made.", 502);
    sub = (await call(token, 'GET', `/storage_boxes/${box}/subaccounts/${id}`, undefined, opts)).subaccount;
  }
  const username = typeof sub?.username === 'string' && /^[a-z0-9-]{1,40}$/.test(sub.username) ? sub.username : null;
  const server = typeof sub?.server === 'string' && /^[a-z0-9.-]{1,200}\.your-storagebox\.de$/.test(sub.server) ? sub.server : null;
  if (!username || !server) throw new HetznerError("Hetzner didn't say the sub-account's name or server.", 502);
  return { username, server, password: pass };
}

module.exports = { boxes, subaccount, subaccountName, HetznerError };
