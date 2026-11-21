# Verification

Source checks, native Windows checks, installed acceptance and hosted CI are
separate evidence. A passing source suite does not prove that another machine
has installed the program or qualified its account/session configuration.

## Automated checks

```powershell
npm.cmd run check
npm.cmd run check:public
```

The suite covers:
- Grant binding, capabilities, actual principals and disabled/unavailable profiles.
- Immutable requests, conflicting IDs, reopened results, duplicate delivery and revocation.
- Explicit target routing, configuration/installation substitution and cross-target grants.
- Optional GitHub, failure classification and guarded publication/metadata operations.
- Native Windows token/DPAPI, job ownership, cancellation, timeout and output bounds.
- Native ACL planning/conditional restore, file identity and stale-state rejection.
- OS session observation and separate target/profile environments.
- Publication checks, including private content removed from the current tree but retained in history.

Windows native tests execute only on Windows. The 8.3 alias case skips when the
test filesystem does not provide a short alias. Portable runs explicitly skip
Windows-only cases; skipped checks are not claimed as passes.

The local Windows publication-preparation run is recorded separately from hosted
CI. It uses Node 22 and 24 and includes the full source suite. Full machine/account
receipts and audit outputs are retained outside this public source repository.

## Installed acceptance

The separately invoked test/qualify-installed.ps1 checks fifteen boundaries from
an actual elevated SYSTEM/Session 0 service context. Its qualified configuration
uses a logged-on administrator target and an offline standard-user target.

It observes genuinely Limited and elevated tokens for the logged-on administrator
plus SYSTEM execution; exercises process/pinned-script work, durable result lookup,
duplicate/conflicting requests, optional GitHub failure, cross-target rejection
and revocation. The offline standard account retains explicit SYSTEM maintenance
and rejects user-session execution before admission.

This qualification does not claim an actual logged-on standard-user token,
domain/nested-group policy, a 24-hour endurance run or a particular third-party
GUI/application login workflow. Repeat the relevant real checks for a new host
or account configuration.

test/qualify-installer.ps1 exercises five installer boundaries: modified config
rejection, changed enrollment rejection, foreign-root preservation, retained partial
intent and same-intent resume without replacing the completed target installation.
The optional CLI dependency fixture is a file copy only; it makes no GitHub API call.

The installed audit/repair/audit drill checks that payload and durable-state bytes
remain identical. Qualification grants are revoked and superseded fixture tasks
are disabled. Existing applications, accounts and credentials are outside the
fixture's mutation scope.

## Public source

[Publication checks](PUBLICATION.md) cover the tree, reachable Git history and
a source-only export, using both privacy rules and a maintained credential scanner.
They report no detected sensitive matches for the reviewed publication snapshot.
Private backups and detailed redacted audit reports are kept outside source.

No hosted CI run, repository push/visibility change, existing installation update
or production service restart is implied by local public-source preparation.

## Scheduled worker stop regression

Native source tests force termination of the windowless launcher for all four
routes and verify that real Node children/grandchildren exit and effects stop.
They also check normal exit/status preservation and sanitized startup errors.
These routing tests use the caller's token; they do not claim four real account
contexts.

The separately invoked real-task harness installs a fresh, disposable low-level
administration installation, with optional compatibility enabled against a local
fake GitHub executable. It never reads credentials or calls the network:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\test\qualify-worker-stop.ps1 -SourceRoot '<SourceRoot>' -EvidenceRoot '<FreshPrivateEvidenceRoot>' -RuntimeRoot '<PortableNodeRoot>' -TargetSid '<LoggedOnAdministratorSid>'
```

Run it from the actual SYSTEM/Session 0 service context with a logged-on
administrator target. It observes SYSTEM, Limited user and elevated user tokens,
and Limited compatibility execution. After Stop-ScheduledTask reports the task
no longer Running, it checks for owned process survivors and ongoing disposable
file effects (including writes to an installer-protected lane for elevated
tokens, and denied writes from Limited tokens), then restarts the same task and verifies that the interrupted
request is not executed again. A separate real task with an invalid Node image
checks persisted startup diagnostics and LastTaskResult=2. Bounded observation
waits and repeating effect probes exist only in this opt-in test harness; no
polling or resident service is added to the runtime.

It revokes its own grant and stops/disables only its own fixture tasks, retaining
private receipts. Interrupted effects still require reconciliation: killing a
process cannot undo an operation already completed before stop. Passing the
bounded checks does not prove arbitrary detached services, remote effects,
third-party applications or all Windows versions.

## Inherited standard streams

inherited-pipes.test.mjs independently retains stdout and stderr in a detached
owned Node descendant while the direct Node child exits with status 37. It tests
all four worker routes and both CLI launchers, bounded launcher return, owned
process cleanup and stopped effects. Separate large-output cases compare every
byte on both CLI streams and preserve literal argv/UTF-8 stdin and exit status.
A normal non-detached child is insufficient to reproduce this issue: Node's
Windows child lifecycle can end it before the inherited-pipe problem appears.

The opt-in real Scheduled Task harness also clones the actual four task
principals into disposable launcher fixtures and independently exercises normal
exit with stdout/stderr inheritance. It checks LastTaskResult=37, zero survivors,
stopped ordinary/protected-lane writes, and the correct actual identities. These
eight cases supplement the four existing forced-stop/no-replay cases and the
startup-failure diagnostic case. All fixtures and observation timers are test
only; no installed request is migrated or automatically replayed.
