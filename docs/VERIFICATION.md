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
