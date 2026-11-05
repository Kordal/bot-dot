// @ts-check
// The terms of service and the privacy policy an owner agrees to (#987): set by the installer for a machine sold as
// hosting (FRONT_DOOR_TERMS_URL, FRONT_DOOR_PRIVACY_URL, FRONT_DOOR_TERMS_VERSION), never on a machine of one's own.
// With both addresses set, a sign-up makes no passkey until its owner ticks "I agree", and a sign-in after the version
// changed asks once more; the front door keeps the version and the time in the account's record and the audit log.
const VERSION = /^[A-Za-z0-9._-]{1,40}$/;

const address = (s) => {
  try { const u = new URL(String(s || '')); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; }
};

/**
 * The terms in force: { terms, privacy, version }, or null when they aren't both set (and what is wrong, said once).
 * @param {Record<string, string | undefined>} env @param {(line: string) => void} [warn]
 */
function fromEnv(env, warn = () => {}) {
  const given = [env.FRONT_DOOR_TERMS_URL, env.FRONT_DOOR_PRIVACY_URL].filter(Boolean).length;
  if (!given) return null;
  const terms = address(env.FRONT_DOOR_TERMS_URL);
  const privacy = address(env.FRONT_DOOR_PRIVACY_URL);
  if (!terms || !privacy) {
    warn('[front door] FRONT_DOOR_TERMS_URL and FRONT_DOOR_PRIVACY_URL are both needed, each an http(s) address: sign-up asks for no agreement');
    return null;
  }
  const version = env.FRONT_DOOR_TERMS_VERSION || '1';
  if (!VERSION.test(version)) {
    warn('[front door] FRONT_DOOR_TERMS_VERSION is 1 to 40 letters, digits, dots, dashes and underscores: sign-up asks for no agreement');
    return null;
  }
  return { terms, privacy, version };
}

module.exports = { fromEnv, VERSION };
