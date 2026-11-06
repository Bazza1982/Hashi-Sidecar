# ADR 0009: General operator administration Sidecar

Date: 5 November 2026. Status: owner-approved implementation; installed acceptance is separate evidence.

The owner requested a useful administration program with task-level reuse of both Windows system and user administration identities and broader account management. The existing 1.6 adapter has nineteen finite GitHub operations; account-scoped repository reads/writes already exist. Raising its task run level cannot implement the missing operations or authorization contract.

The new independent 2.0 program uses three fixed demand-only executors: SYSTEM, the verified interactive user at Limited level, and that same user at Highest level with observed elevation required. A fourth Limited task preserves the complete GitHub command interface using the reviewed source including the PR comment-error repair. Demand-only tasks reuse the established host integration and avoid a new privileged network listener or resident daemon. The native helper starts children suspended and attaches them to a kill-on-close job object before resuming them.

A protected local grant store is the authority for this release. Actual elevated Windows issuer/publisher SIDs, installation, host, profile, capability and expiration are checked. Immutable encrypted intents are writable only by elevated publishers; user workers cannot mint them. Queue references are not authoritative payloads. DPAPI LocalMachine and audited ACLs protect payloads. Effects have durable claims/results, without automatic retry after uncertain outcomes.

This release authenticates Windows operator principals. Multiple Agents sharing one service SID remain the same OS principal; Agent/session/task labels do not acquire cryptographic authority by appearing in JSON. Existing managed HASHI task/tool/Workzone authority remains applicable, with no protected-Core change. Integrating independently attested per-Agent grants requires an appropriate trusted adapter and is not claimed here.

The finite operation registry adds identity, general process/script, file, service, registry and task administration plus GitHub REST/GraphQL transport. Full-code and GitHub account administration grants are deliberately broad operator authority, not a path sandbox or a repository-scoped GraphQL filter. Real Windows tokens and GitHub roles/credential scopes remain authoritative. Known credential forms/fields are redacted; arbitrary output cannot be certified secret-free.

The existing 1.6 installation/configuration/data stay untouched. A staged 2.0 installation carries its own runtime, compatibility queue, immutable source pins and maintenance copy. Installation rejects foreign roots/tasks and changed release identities. This first installer supports matching-release repair/audit and idle disable; it does not claim an unimplemented in-place cross-version migration. Canonical publication carries only Sidecar source/tests/documentation, never unrelated Hub ancestry.

Source, portable protocol tests, Windows native tests, disposable installed acceptance and actual installed adoption are distinct. See [operations](../ADMIN_SIDECAR_OPERATIONS.md) for invocation, authority limits and rollback.

## Owner-approved maintenance extension 2.1

Retain full administrator/user process and pinned-script execution for general local tasks; typed operations do not exhaust the owner's administration capabilities. Add ACL inspection/planning/apply/conditional restore, credential read probes, creation-time/executable guarded process controls and explicit scheduler restart receipts. Optional pathRoots narrow only typed file/ACL operations, not arbitrary full-code execution. Exact Limited-token enforcement prevents a successful elevated probe from masquerading as runtime-user access. All managed caller authority remains applicable; this program does not edit or disable HASHI protection.

Native ACL updates use stable local handles, preserve owner/group/auditing and data, reject reparse/unexpected hard-link substitution, bind file identity and expected descriptor, and retain protected plans for reconciliation/conditional rollback. General process/script requests are bounded by their grant and a maximum of 24 hours; submit/events/result support long jobs. Per-profile execution remains serialized; queued admission lasts only until the task grant expires. Scheduler dispatch and application readiness are separate receipt fields. New releases are qualified and adopted beside the retained older installation rather than overwriting an incompatible release.
