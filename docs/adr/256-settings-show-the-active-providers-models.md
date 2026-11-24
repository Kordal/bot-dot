# ADR-256: Settings show the active provider’s models and reasoning levels

- **Status:** Accepted (2026-11-17). Provider setup is updated by [ADR 257](257-provider-models-come-from-a-searchable-catalog.md). The lists show every connected provider's models, not the active one's, since [ADR 267](267-several-providers-at-once-and-the-model-decides-which-one-runs.md).
- **Owning task:** #1526
- **Updates:** [ADR 255](255-bots-can-run-on-another-model-provider-under-claude-code.md) for model selection and reasoning.

## Context

Setup names a main model for the account and a helper model for short calls. Settings used to list Claude models after the owner chose another provider, even though the server translated those choices when starting a run.

## Decision

Setup offers the preset's models and any saved models for that preset. The owner can enter another name for either role. Settings offers the active provider's models for the account, the Chief of Staff and each bot. The server supplies those choices. A saved Claude model still resolves to the helper model for Haiku and to the main model for other choices.

The server advertises the reasoning levels supported by the selected model through the provider's Anthropic-compatible endpoint. The run uses Claude Code's effort flag and declares the selected model's capabilities. [DeepSeek](https://api-docs.deepseek.com/guides/thinking_mode/) and [Z.ai](https://docs.z.ai/devpack/latest-model#switch-effort-thinking-intensity) expose Low, High and Max for their preset models. [MiniMax M3.1 Flash](https://platform.minimax.io/docs/api-reference/text-anthropic-api) also supports Medium and Extra high. [OpenRouter](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#discovering-per-model-reasoning-options) and [Ollama](https://docs.ollama.com/api/anthropic-compatibility) advertise levels per configured model. botdot reads them when saving the provider and can refresh them in Settings.

## Alternatives

A common list of reasoning levels for all endpoints would show options some endpoints ignore or refuse. The normal Settings read uses the configured model names and saved reasoning metadata so it needs no network request to a provider.

## Consequences

An endpoint without a preset catalog starts with model-name fields. Its configured names appear in Settings once saved. Models without a documented effort control keep their provider's reasoning behavior.
