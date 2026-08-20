# ADR-0001 — LeadMoor is standalone from MOOR

**Status:** Accepted
**Date:** 2026-08-20

## Context

LeadMoor is an AI lead-generation product. A hard requirement is that it must be separate
from MOOR: it must not modify MOOR, and it must not depend on MOOR.

At the time of this decision the constraint is free to satisfy. `spartanapparelbiz-ui/leadmoor`
is an empty repository with zero commits, and no MOOR source is present in the development
environment. There is nothing to disentangle — only something to prevent from forming.

Shared code between two products is easy to introduce accidentally (a "just this one
utility" import, a shared auth client, a shared database for convenience) and expensive to
remove once either product has shipped.

## Decision

LeadMoor shares no code, no database, no runtime, and no credentials with MOOR.

Specifically:

1. **Separate repository.** LeadMoor lives in its own repository and is never vendored into
   or out of a MOOR repository.
2. **Separate data.** Its own PostgreSQL instance and its own object storage bucket. No
   shared schema, no cross-database queries, no shared read replica.
3. **Separate runtime.** Its own deployment, its own workers, its own secrets and
   environment configuration.
4. **Separate identity.** Its own authentication. No shared identity provider, no shared
   session or token format.
5. **No shared libraries.** Not now, not later. If a utility is needed in both products, it
   is duplicated. Duplication is cheaper than coupling here.
6. **Integration, if ever, is public.** Any future interoperability with MOOR goes over
   LeadMoor's public HTTP API and webhooks — the identical contract offered to any third
   party. No privileged internal channel.

## Enforcement

This is checked, not trusted:

- A CI step fails the build on any import that resolves to a MOOR package or path.
- New runtime dependencies are reviewed against an allowlist.
- No MOOR credential is provisioned into a LeadMoor environment, so a coupling would fail
  at runtime even if it passed review.

## Consequences

**Accepted costs.** Some logic will be written twice. Cross-product features are not
possible without building a public API surface first. Two deployments to operate instead of
one.

**Gained.** LeadMoor can be sold, priced, deployed, audited, open-sourced, or divested
without touching MOOR. A MOOR outage cannot take down LeadMoor. Compliance scope for
LeadMoor's personal-data handling stays bounded to one system, which matters considerably
given the GDPR surface described in the architecture proposal.

## Related concern (not part of this decision)

The name "LeadMoor" implies a MOOR relationship that this ADR explicitly severs at the
technical level. If independent brand positioning is intended, the name should be revisited
while a rename is still free — before a domain, a customer, or a contract depends on it.
