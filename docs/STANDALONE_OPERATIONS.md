# Standalone operator operations

Use a separately selected install root and explicit local account SIDs.
Discovery uses scripts/list-windows-accounts.ps1; profile paths are read from
Windows profile registration. Include every intended target in the initial
account configuration. A target without a Windows profile can be enrolled for
SYSTEM maintenance; enroll a fresh installation after its first login to add the
new user context. Targets and payloads are pinned for each installation.

The configuration accepts targets (each has sid and optional githubLogin/ghPath),
publisherSids and issuerSids. Unknown target fields and duplicate SIDs are rejected.
Configured service publishers must actually run as SYSTEM or an elevated
administrator. Default publishers/issuers contain SYSTEM only; add an explicitly
verified owner administrator/service SID if that principal also needs to publish.

Each invocation uses the independent native executable:
```powershell
$sidecar = '<InstallRoot>\bin\hashi-sidecar.exe'
& $sidecar targets
& $sidecar --target-sid '<Sid>' status
& $sidecar --target-sid '<Sid>' capabilities
```

For a full maintenance task, create one scope with the required available profiles,
identity/process/script/file/acl/service/registry/task capabilities, the actual
publisher SID and allowAnyCode=true. Reuse the grant for all authorized task steps.
GitHub is omitted unless configured and needed. Each request has a stable UUID;
use that same target SID and UUID to retrieve or reconcile its result.

Process input:
```json
{
  "executable": "<AbsoluteExecutable>",
  "args": ["literal argument"],
  "cwd": "<AbsoluteWorkingDirectory>",
  "timeoutMs": 60000
}
```

Script input additionally includes interpreter (powershell/node), script, its
lowercase SHA-256, literal args and cwd. process.run/script.run retain broad
execution and do not add a command allowlist. An explicit script can call native
Windows account, software, service and configuration tools. Use a target's user
profile for its HKCU, applications and existing account credentials; use SYSTEM
or a selected administrator for machine-wide administration.

A standard user cannot run as an elevated version of itself. A disconnected but
logged-on session may remain usable; a missing session returns
ADMIN_USER_SESSION_UNAVAILABLE before a new request is admitted. A missing profile
or unsupported elevated lane returns ADMIN_PROFILE_UNAVAILABLE. No fallback
silently changes user/profile. SYSTEM has Session 0 and does not stand in for an
interactive desktop. Specific application logins and third-party UI workflows
require their own real acceptance; this release does not claim every GUI is
automatable.

Use submit/events/result for long operations. Maximum requested runtime remains
24 hours within the grant deadline. The native helper owns descendant processes;
cancellation, revocation or timeout ends the owned job. To start persistent work,
use an authorized Windows service/scheduler/application mechanism. An uncertain
external outcome needs observation and reconciliation, not a new request UUID.

## Optional GitHub

Add githubLogin and an absolute ghPath to the target configuration before
installation. This selects the user's existing GitHub CLI keyring and verifies
the expected login on API use. No credential is exported or copied. A missing
adapter reports ADMIN_GITHUB_UNAVAILABLE; Windows installation works without gh,
git, an old Sidecar or Hub.

The old finite GitHub command interface is retained as an explicit compatibility
option through scripts/install-admin-sidecar.ps1 -SeedConfig with a reviewed
legacy configuration. The suite's fresh-account installer defaults to the
generic GitHub API adapter only. Compatibility is not enabled by a fake seed.

## Audit, repair and rollback

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '<InstallRoot>\maintenance\install-sidecar.ps1' -Mode Audit -InstallRoot '<InstallRoot>'
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '<InstallRoot>\maintenance\install-sidecar.ps1' -Mode Install -InstallRoot '<InstallRoot>'
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '<InstallRoot>\maintenance\install-sidecar.ps1' -Mode Disable -InstallRoot '<InstallRoot>'
```

Audit/repair validates the exact release and pinned target configuration. Matching
repair retains grants, requests, claims and results. Disabled idle owned tasks
and all results are retained. An explicitly supplied changed enrollment/runtime
is rejected, rather than silently ignored. Resuming a failed target installation
uses the protected original setup intent and the same reviewed source/runtime.
Changed release, enrollment or trust policy uses a new owned root. Keep the old
installation and journals; do not automatically migrate/requeue old requests.
None of these operations removes or adopts the existing Hub installation.

## Actual installed qualification

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\test\qualify-installed.ps1 -ProgramRoot '<OwnedDisposableInstallRoot>' -EvidenceRoot '<PrivateEvidenceRoot>'
```

The harness requires the actual SYSTEM/Session 0 service caller, an enrolled
logged-on administrator and an enrolled offline standard account. It runs real
three-token jobs, checks reusable grants and durable results, and tests explicit
offline/unavailable and cross-account boundaries. It revokes its own grants.
It does not change an existing user's account, reset passwords, activate a
GitHub login or restart Hub/HASHI/Workbench. Fixture task disable and any final
installation adoption are separate operations.
