# Permanent GitHub sidecar program

Version 1.6 adds full PR metadata reads, guarded title/body editing, bounded
changed-file patches and discussion comments. Existing account-scoped or
repository-list authority, publication, CI/source reads, retargeting and
separately authorized merging remain. See [PR operations](GITHUB_PR_OPERATIONS.md)
and the installed agent guide for current command details and concurrency limits.

The compatibility package provides a permanent entry point for authorized local
automation clients. It is a Windows console application with a bundled Node LTS
runtime, an immutable worker release,
protected data/configuration and its own installed maintenance snapshot.
[ADR 0008](decisions/0008-github-user-sidecar.md) still owns the user-context
authentication boundary.

## Location and calls

Instance paths remain in ignored state. The selected local installation is
under the authorized shared-tools directory. Its root has `LOCATION.md` and
`README.md`; its native entry point is `bin\hashi-github.exe`.

From PowerShell through HASHI managed execution, substitute the installed
absolute Windows path:

    & '<InstallRoot>\bin\hashi-github.exe' --help
    & '<InstallRoot>\bin\hashi-github.exe' status
    & '<InstallRoot>\bin\hashi-github.exe' account
    & '<InstallRoot>\bin\hashi-github.exe' main --repo '<owner/repository>'
    & '<InstallRoot>\bin\hashi-github.exe' checks --repo '<owner/repository>' --sha '<full SHA>'
    & '<InstallRoot>\bin\hashi-github.exe' source --repo '<owner/repository>' --sha '<full SHA>'

A direct-argv managed tool may invoke that executable without PowerShell.
The native launcher quotes Windows argv and starts the bundled runtime with
UseShellExecute=false. It never forwards arguments to a command shell.
The public client rejects worker/config/URL/command/output-path overrides.

Calls work from an arbitrary current directory and do not need a caller Node
installation or PATH update. Runtime, worker and maintenance imports remain
inside the installed program. Existing Hub source and its legacy sidecar are
preserved; the new absolute executable is the shared entry point.

## Installation and repair

Run the installer through the managed operator channel. Select an authorized
install root, a private scope seed and an explicit portable Node directory
containing `node.exe` and its `LICENSE`.

    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\install-shared-github-sidecar.ps1 -Mode Install -InstallRoot '<InstallRoot>' -SeedConfig '<private seed JSON>' -RuntimeRoot '<verified portable Node directory>'

The installer stages and verifies the program before moving it into place.
An existing unrecognized directory or foreign task is rejected. Installed
program files are read-only for ordinary callers. Configuration/request data
are restricted to SYSTEM, Administrators and the selected desktop user;
that user can modify only the queue/results/source working directories.

The persistent demand-only task uses Interactive logon, Limited run level,
zero automatic triggers and an eight-minute ceiling. Concurrent callers use
unique durable requests and the shared task. Other local Agents on the same
authorized service OS identity may call the program while retaining their own
HASHI tool/Workzone permissions. No other Agent's workspace, permission policy
or raw memory is changed by installation.

Installed maintenance is independent of this source checkout:

    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '<InstallRoot>\maintenance\install-shared-github-sidecar.ps1' -Mode Audit -InstallRoot '<InstallRoot>'

Use Mode Install with that same installed snapshot to repair a matching idle
task. Byte-identical repair preserves all configuration, requests, results and
source. A changed package requires a reviewed deployment and is not silently
written over an existing installation.

## Scope and practical limits

Supported operations include account/main/checks/source, branch/PR inspection,
guarded PR metadata edits, bounded patches/discussion, pinned bundle push,
expected-head file commits, exact-head PR creation, retargeting and separately
authorized PR merges pinned to the approved head/base. Read/write scope can be
the configured owner's account or explicit repository lists; status reports
the actual scope. An upgrade must preserve it. See the
[installed program guide](../scripts/github-sidecar/README.md) for commands,
request recovery and the reviewed Upgrade workflow.

Read operations retain the configured account/list boundary. GitHub CLI and Git remain normal installed
Windows dependencies. Credentials remain in the user's Windows keyring.
The selected user must remain logged on; credential expiry/logoff is an
explicit unavailable state. This package does not introduce a network listener,
a periodic job, customer access or a general command-execution endpoint.

The program persists across source branch changes. Registration is stored by
Windows, but this task does not claim a live machine reboot/logoff drill.
Successful GitHub reads are separate from supplier build/guest acceptance.

Source trees are created by the desktop user. A service-context Git client
may require per-command safe.directory entries for the exact verified returned
source root (and its recorded gitlinks). Avoid a global wildcard exception;
the source receipt is the provenance to check before such a scoped read.
