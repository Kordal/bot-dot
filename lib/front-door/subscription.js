// @ts-check
// Settings' "Subscription" row on a managed machine (ADR 154, ADR 234): the page where the owner manages what they pay
// for hosting. The fleet console gives its address to the installer (FRONT_DOOR_SUBSCRIPTION_URL), so it can be any
// billing provider's page (a Stripe customer portal, Paddle, the console's own); `{account}` in it is the session's
// account, URL-encoded, for an address of each account. Only an https address, only on a managed machine: elsewhere,
// and when it is unset or not https, the row isn't shown.

/**
 * The template in force, or null (and what is wrong, said once).
 * @param {Record<string, string | undefined>} env @param {boolean} managed @param {(line: string) => void} [warn]
 */
function fromEnv(env, managed, warn = () => {}) {
  const given = String(env.FRONT_DOOR_SUBSCRIPTION_URL || '').trim();
  if (!given) return null;
  if (!managed) {
    warn('[front door] FRONT_DOOR_SUBSCRIPTION_URL is for a managed machine (FRONT_DOOR_MANAGED=1): Settings shows no Subscription');
    return null;
  }
  if (!https(given.replace(/\{account\}/g, 'account'))) {
    warn('[front door] FRONT_DOOR_SUBSCRIPTION_URL is an https address: Settings shows no Subscription');
    return null;
  }
  return given;
}

/** @param {string} s */
function https(s) {
  try { const u = new URL(s); return u.protocol === 'https:' && !!u.hostname; } catch { return false; }
}

/**
 * The address for this account, or null.
 * @param {string | null} template @param {string | null | undefined} account
 */
function page(template, account) {
  if (!template || !account) return null;
  const href = template.replace(/\{account\}/g, encodeURIComponent(account));
  return https(href) ? new URL(href).href : null; // normalised: the apps compare a lowercase scheme
}

module.exports = { fromEnv, page };
