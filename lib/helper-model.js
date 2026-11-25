// The model of botdot's short background calls (the group router, the follow-up and wake-gate decisions, the group
// notes, the shadow check, an error explained, the sign-in check). One name, so a new Haiku is changed in one place.
// How a call's model is finally chosen (the account default's provider, the admin's Decision model, the per-module
// BOT_DOT_*_MODEL overrides): docs/decisions/2026-11-25-a-background-calls-model-has-three-routes-and-one-name.md.
const HELPER_MODEL = 'claude-haiku-5-5';

module.exports = { HELPER_MODEL };
