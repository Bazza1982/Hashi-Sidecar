# HASHI Sidecar

**Run authorized Windows administration tasks from a service account in the right
Windows user context.**

An AI agent running as SYSTEM or an administrator service account can manage the
computer, but it does not automatically have another user's desktop session,
HKCU registry, application settings or signed-in applications. HASHI Sidecar
provides explicit execution routes for those different contexts.

For example, a service agent can inspect a service as SYSTEM, repair a selected
user's application settings as that user, or run an installer as a selected
administrator. It can also use that user's existing GitHub CLI login when the
optional GitHub adapter is configured.

Sidecar is a standalone native CLI backed by on-demand Windows Task Scheduler
workers. It bundles the Node runtime supplied at installation, opens no network
listener, and does not require HASHI, Hub, an AI model, or a resident Sidecar daemon.
Other authorized automation clients can use the same CLI.

## What it can do

- Run programs with literal arguments and run SHA-256-pinned PowerShell or Node scripts.
- Inspect and maintain files, ACLs, processes, Windows services, registry values and tasks.
- Keep one reusable grant for an approved task, with revocation, timeout and cancellation.
- Save requests/results across caller restarts and reject conflicting request IDs.
- Route multiple local accounts by explicit Windows SID, with separate protected stores.
- Optionally call GitHub REST/GraphQL using a target user's existing CLI credential store.

| Profile | Runs as | Typical use | Requirements |
| --- | --- | --- | --- |
| system | SYSTEM in Session 0 | Machine settings, services, offline-account maintenance | Configured authorized publisher |
| user | Selected user with a Limited token | User files, HKCU, application settings | Existing profile and logged-on session |
| user-admin | Same selected user with an elevated token | Work requiring that administrator's identity | Local administrator and logged-on session |

A standard user has no elevated-self profile. Use an explicitly authorized SYSTEM
operation or a selected administrator for machine-wide work. Missing profiles or
sessions return unavailable; Sidecar does not silently substitute another identity.
SYSTEM Session 0 does not provide a user's interactive desktop, and existing
application authentication remains owned by the actual user.

## Authorization model

The calling person or agent platform obtains the owner's authorization. A
configured, actually elevated Windows principal issues a task grant that Sidecar
checks on later calls. Sidecar does not display a human approval dialog or infer
consent from an agent/task label.

Grants bind the machine, installation, Windows publisher, target profiles,
capabilities and expiry. Agents sharing SYSTEM are the same OS principal; this
release does not authenticate those agents independently.

A grant with allowAnyCode=true deliberately permits broad administrator/user
code execution. Typed operations are conveniences, not a sandbox around that
code. Use one grant for the authorized task and revoke it afterward. An uncertain
external result must be reconciled by inspection; submitting a new request ID
must not be used to repeat an effect blindly.

## Requirements

- 64-bit Windows with Windows PowerShell, ScheduledTasks and LocalAccounts modules.
- SYSTEM or an elevated administrator for installation.
- The .NET Framework C# compiler available to build the native helpers.
- A portable Node 22 or 24 directory containing node.exe and its LICENSE.
- Explicit local Windows user SIDs; a target must be logged on for user execution.

The source has no npm dependencies, so npm install is unnecessary. GitHub CLI is
needed only for the optional GitHub adapter. Domain/nested-group policy and
specific third-party GUI workflows require separate qualification.

## Quick start

Run setup through your elevated administrator or managed service execution
channel. The default permitted issuer/publisher is SYSTEM. To use a human
administrator terminal or another administrator service identity, explicitly add
that verified Windows SID to publisherSids and issuerSids.

1. Discover local account identities:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\list-windows-accounts.ps1
   ```

2. Copy [accounts.example.json](examples/accounts.example.json) to
   config/local.json, replace the target SID placeholder, and include every
   account you want to enroll. Keep the real configuration untracked.

3. Install into a dedicated directory:

   ```powershell
   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\install-sidecar.ps1 -Mode Install -InstallRoot '<AbsoluteInstallRoot>' -AccountsFile '.\config\local.json' -RuntimeRoot '<PortableNodeRoot>'
   $sidecar = '<AbsoluteInstallRoot>\bin\hashi-sidecar.exe'
   $targetSid = '<EnrolledTargetSid>'
   & $sidecar version
   & $sidecar targets
   & $sidecar --target-sid $targetSid capabilities
   ```

4. Copy [task.example.json](examples/task.example.json) to a private task scope
   file. Describe the actual approved task, select available profiles/capabilities,
   and use the actual permitted caller SID. From that configured caller:

   ```powershell
   $grant = & $sidecar --target-sid $targetSid grant-create --input-file '<AbsoluteScopeJson>' | ConvertFrom-Json
   $requestId = [guid]::NewGuid().ToString()
   & $sidecar --target-sid $targetSid call --grant $grant.grant.id --profile user --operation identity --request-id $requestId
   & $sidecar --target-sid $targetSid result --request-id $requestId
   & $sidecar --target-sid $targetSid grant-revoke --grant $grant.grant.id
   ```

The identity example makes no target configuration change. To run a program,
use process.run with an absolute executable, a literal args array, cwd and
optional stdin/timeout. For scripts, use script.run with interpreter, source,
its lowercase SHA-256, args and cwd. See
[operation details and examples](docs/STANDALONE_OPERATIONS.md).

Each account has its own grants, requests and results. Every account-specific
call requires --target-sid, including result lookup, even for a single account.

## Development and validation

```powershell
npm.cmd run check
npm.cmd run check:public
```

The first command checks syntax, documentation, publication boundaries and tests.
The second also checks every reachable Git-history blob for local identity,
network/path and generated-state leaks. A separate maintained Gitleaks scan covers
credential signatures in both the working tree and Git history; see
[public-source checks](docs/PUBLICATION.md).

Source tests run on Windows and Linux; Windows-only token, ACL, session and job
checks need Windows. Real installed acceptance uses explicitly selected disposable
roots and accounts and is separate from default CI. See
[verification and its limits](docs/VERIFICATION.md).

Further reading: [architecture](docs/ARCHITECTURE.md),
[installation/repair and operations](docs/STANDALONE_OPERATIONS.md),
[account-broker design](docs/decisions/0010-standalone-account-broker.md), and
[optional GitHub compatibility](docs/GITHUB_SIDECAR_OPERATIONS.md).

License metadata is UNLICENSED; no open-source license grant is included.
The npm private flag prevents accidental npm publication and does not determine
GitHub repository visibility.
