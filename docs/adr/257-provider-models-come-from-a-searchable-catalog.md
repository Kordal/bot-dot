# ADR-257: Provider models come from a searchable catalog

- **Status:** Accepted (2026-11-18). Saving a provider no longer switches to it, and several can be saved, since [ADR 267](267-several-providers-at-once-and-the-model-decides-which-one-runs.md).
- **Owning task:** #1539
- **Updates:** ADR 256 for provider setup.

## Context

Setup offered preset models and accepted typed IDs. Several presets supplied no choices, so the owner had to look up an ID before connecting. Claude Code still sends its calls through the selected provider's Anthropic Messages API.

## Decision

The botdot server returns model IDs and display names. It reads DeepSeek, OpenCode Go and OpenRouter's model catalogs, Ollama's installed models, or the custom gateway's model list where available. OpenRouter's catalog uses the account's provider preferences and guardrails. [Z.ai](https://docs.z.ai/devpack/faq#glm-coding-plan-details) and [MiniMax](https://platform.minimax.io/docs/api-reference/text-anthropic-api#supported-models) use their documented choices. A saved model stays available at its saved address if discovery fails or the model leaves the catalog. Discovery sends credentials only to that provider and does not activate it.

The apps search the list and pass the chosen IDs. A preset or saved helper is suggested when available. The owner can use the same model for both roles. Saving checks each distinct choice before switching the provider.

Settings puts the provider and its default model in the same Model row. Opening that row discovers the active provider's models with its saved connection. The server keeps the last catalog for that provider so the existing Settings read stays local and bots can run on selected catalog models. Opening the row can work from the cached list during an outage. An Anthropic API key lists the models available to that key. The Claude subscription uses Claude's published model list.

## Consequences

An address with neither a catalog nor saved choices shows an empty list. The apps can use existing presets on older servers. Older apps can continue to save exactly as before.
