# Architecture Decision Records

An Architecture Decision Record (ADR) is a short document capturing one significant architecture decision: its context, the decision itself, and its consequences. ADRs give future contributors — human and AI — the reasoning behind the architecture, not just its current shape.

Any architecture change requires an ADR. A smaller choice that is not architecture (a library within the agreed stack, a default, a workaround) is one dated line in [DECISIONS.md](../DECISIONS.md) instead.

## Naming

Number ADRs sequentially with a zero-padded three-digit prefix and a short kebab-case title:

```
001-title.md
002-title.md
```

Numbers are never reused. To change a decision, write a new ADR that supersedes the old one and mark the old one as superseded.

## Format

```markdown
# ADR-001: Title

- **Status:** Proposed
- **Owning task:** CAP-001

## Context

## Proposed decision

## Alternatives

## Consequences
```

An ADR starts as Proposed, with the choices still open. The ticket that owns it resolves them, records the alternatives and consequences, renames the section to "Decision" and sets the status to Accepted before implementing dependent behaviour.
