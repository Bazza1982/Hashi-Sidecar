# GitHub user-context sidecar operations

The private operator sidecar lets managed service calls use the logged-on
Windows user's existing GitHub CLI authentication. It is independent of Hub
member accounts, model credentials and HASHI Core. See
[ADR 0008](decisions/0008-github-user-sidecar.md).

## Permanent entry point for other local Agents

The recommended common entry is the [permanent native program](GITHUB_SHARED_PROGRAM.md).
Its executable, bundled runtime and maintenance snapshot are installed outside
the tracked source. The commands below remain the legacy Hub-local tooling.

## Installation

Use the existing managed operator execution channel with sufficient rights to
register a demand-only task. Select the Windows account using OS observations.
Keep real account/repository names in ignored instance configuration.

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "& '.\scripts\install-github-user-sidecar.ps1' -Mode Install -Account '<verified Windows account>' -Repository @('<owner/repository>','<owner/dependency>') -ExpectedGitHubLogin '<expected login>'"
```

The process-local script policy matches the repository's existing Windows
operator tooling; it does not change the machine execution policy. Omitting
Account resolves the currently logged-on console account through Windows.
Installation requires its matching loaded user profile. The task name derives
from the Hub instance root and SID, and is retained in ignored configuration.

The installer creates protected instance state under
`state\github-user-sidecar`. Only that user's queue/results/source folders are
writable by its limited task. The action is a fixed Node executable/worker
with a pinned hash. No scheduled trigger is installed.

Audit the installed scope and ACLs with the same arguments and `-Mode Audit`.
Use `-Mode Install` again after a reviewed worker change; it replaces only a
matching owned task when that task is idle. An unrelated task or different
identity is rejected.

## Calls from managed execution

Run these commands through HASHI managed execution:

```powershell
node .\scripts\github-user-sidecar.mjs --operation account
node .\scripts\github-user-sidecar.mjs --operation main --repo '<owner/repository>'
node .\scripts\github-user-sidecar.mjs --operation checks --repo '<owner/repository>' --sha '<full commit SHA>'
node .\scripts\github-user-sidecar.mjs --operation source --repo '<owner/repository>' --sha '<full commit SHA>'
```

A caller may use `--config` for an explicit installed configuration.
The API operation set and repository allowlist remain fixed. Version 1.1 of the
[shared program](GITHUB_SHARED_PROGRAM.md) additionally supports explicitly
configured operator writes; legacy installations without writeRepositories
remain read-only. API requests
verify the expected authenticated login inside the user task. Exact-commit
CI reads project check runs, classic statuses and workflow runs; counts mark
partial coverage. Zero recorded checks does not mean CI passed.

Source intake uses the immutable pin, verifies its own Git root and clean
tracked files, and recursively checks dependency URLs/gitlinks. Archives and
builds remain separate preparation steps. No running supplier checkout is used
as the destination, and existing changes or incomplete destinations are not
overwritten.

## Receipts, concurrency and recovery

Requests and responses have separate files beneath the protected state root.
Each receipt includes installation/request identity, input digest, observed
Windows SID, timestamps and a scoped result or fixed failure code. Concurrent
callers share the demand-only task; claimed work is not re-executed by another
start. The worker finishes its bounded batch and exits.

`SIDECAR_USER_SESSION_UNAVAILABLE` means the task did not process the request;
inspect its last result and confirm that the configured user is logged on.
`SIDECAR_INTERRUPTED` and `SIDECAR_RESPONSE_TIMEOUT` retain request state for
inspection. Reconcile an incomplete source directory before requesting the same
pin again. Never reset it blindly. A credential failure returns the observed
HTTP status without persisting the provider's raw error.

The route needs the user's logged-on Windows session and working GitHub login.
Reboot/logoff does not turn the demand-only task into an unattended credential
store. Customer execution, public ingress, billing, supplier builds and live
guest acceptance remain independently qualified boundaries.

## Explicitly approved merges

The shared v1.2 pr-merge command accepts only repository, PR number, approved
full head SHA, expected base and optional request ID. It checks complete CI,
rechecks the PR and uses the SHA-pinned GitHub merge endpoint. Result inspection
is durable; a lost response is reconciled by reading the same pinned PR.
No arbitrary API method/URL, force, admin bypass or running checkout update is
exposed. See the [installed guide](../scripts/github-sidecar/README.md).
