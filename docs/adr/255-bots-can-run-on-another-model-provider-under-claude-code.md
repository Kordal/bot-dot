# ADR-255: Bots can run on another model provider under Claude Code

- **Status:** Accepted (2026-11-17). The model pickers and reasoning decision are superseded by ADR 256. "One account, one provider" is superseded by [ADR 267](267-several-providers-at-once-and-the-model-decides-which-one-runs.md): several providers at once, the model decides which one a run uses.
- **Owning task:** the owner's request in the project thread "Add other LLM providers under Claude Code" (option C of the estimate "Pi as the bots' backend")
- **Builds on:** the Anthropic API key of #35 (`lib/claude-key.js`), and `lib/identity.js` `runAs`, the one place where a run's or a Chief turn's Claude Code process gets its environment.

## Context

Every call to a model, bots, the Chief, and the short helper calls of the group router and the notes, is a Claude Code process, and its environment is built in one place. Claude Code speaks to whatever address `ANTHROPIC_BASE_URL` names, and DeepSeek, Z.ai GLM, MiniMax, OpenCode Go, OpenRouter and Ollama each answer Anthropic's Messages API at an address of their own. The owner wants to use more AI subscriptions and keys than Anthropic's, without botdot changing its engine: replacing Claude Code with another agent (Pi, OpenCode) was estimated at 35 to 45 days and would lose the Claude subscription. Anthropic's terms allow a Claude Pro or Max sign-in only in Claude Code itself.

## Decision

- **Claude Code stays the engine; only where it sends its requests changes.** The account picks one of three: the Claude subscription, an Anthropic API key, or **a provider** (`using: "provider"`). A provider is a preset's address or one the owner gives, a key (none for a keyless one such as Ollama on this machine or the owner's network), a model for the work and one for the short helper calls. It is kept in `claude-key.json` beside the Anthropic key, the key encrypted with the Vault's key and answered only as its last four, and it is checked with one short real request before it is kept.
- **A run on a provider gets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, an empty `ANTHROPIC_API_KEY`, the models (`ANTHROPIC_MODEL` and the three `ANTHROPIC_DEFAULT_*_MODEL`) and `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` (Anthropic-only beta features stay out), and no subscription token.** A subscription is never sent to another provider, and a provider's key never to Anthropic. A model a bot or the Chief asks for (`--model opus`, `claude-haiku-5-5`) is turned into the provider's in `settings.args`: its small model for Haiku, its big one for everything else; no reasoning level is passed, as the providers' models do not take Claude's.
- **One account, one provider.** Not per bot: the bots' model pickers, the router and the notes ask Claude's names and a mix would need a map per bot. A bot's own model setting still works, as the names it picks are turned into the provider's.
- **The apps hold no presets.** `GET /api/setup` hands out `providers`, and `features` has `llm-provider`; web and Android draw them, with nothing explained beside the form. The address is asked only for "Other" and Ollama; plain `http` is taken only for this machine or a private network, so a key never crosses the open internet.
- **Nothing about cost.** Claude Code prices a foreign model's tokens at Anthropic's rates, so its dollar figures are wrong there; botdot shows none in an account (AGENTS.md rule 5).

## Alternatives

- **Pi or OpenCode instead of Claude Code.** 35 to 45 days, a second event format, permission model and resume to carry, and no Claude subscription. Rejected for now; Pi next to Claude Code is only worth it for a ChatGPT subscription.
- **A translating proxy for ChatGPT or Gemini subscriptions.** 6 to 8 days and a terms question per provider (Google bans the Antigravity route); not part of this.
- **Per-bot providers.** More controls, and the helper calls have no bot to ask.
- **Refuse it on managed machines.** An account's server does not learn that its machine is managed (only the front door does), so it would need a new variable through `compose.yaml` and the installer. Left to the owner's decision on the hosting terms; today a managed machine's owner can save a provider of their own.

## Consequences

- Quality is the provider's: tool use, long contexts and images differ by model. DeepSeek ignores prompt caching and PDFs; MiniMax's thinking cannot be turned off. The check does not try a tool call.
- Data goes to a third party the owner chose; DeepSeek, Z.ai and MiniMax are in China. The Settings row says only the provider's name.
- OpenCode Go's terms say "own internal use": fine on a machine the owner runs, to be weighed before it is offered on Hosted.
- The effective credential changing (a provider saved, picked, removed or its key replaced) clears the usage-limit hold as an Anthropic key does. Since [ADR 271](271-a-usage-limit-holds-only-the-runs-on-the-connection-that-reached-it.md) each connection has its hold, cleared by its own credential changing.
- iOS (shared data layer) reads the new fields and ignores them until its Settings catch up (#1355).
