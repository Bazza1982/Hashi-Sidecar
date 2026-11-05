# General administration Sidecar 2.1 — inherited operation reference

For the standalone 3.0 account suite and fresh installation, use
[current standalone operations](STANDALONE_OPERATIONS.md). The following retained
2.x guide describes the reused engine and historical compatibility installation;
its old seed requirement is not a requirement of the fresh 3.0 suite.

Version2.1 adds [local maintenance operations](MAINTENANCE_OPERATIONS.md), exact Limited-token checks, guarded process controls, ACL plans/rollback and long jobs. Full-code task grants continue to support arbitrary local operator programs/scripts.

The owner-approved operator program adds Windows system, normal-user and elevated-user execution, reusable grants, GitHub REST/GraphQL account operations and typed file/service/registry/task administration. It preserves the 19 GitHub 1.6 commands through a separately pinned compatibility worker containing the reviewed comment-error repair. This is operator tooling, outside Hub members/guests and HASHI Core.

The client and three demand-only Windows executors are permanent installed programs. They are not resident daemons and expose no network listener. Fixed tasks dispatch immutable encrypted requests and exit; a fourth limited-user task handles compatibility commands. Process/script requests can run for up to24hours within their active grant; executor tasks have a25-hour ceiling. A selected user must remain logged on for user/elevated-user/GitHub operations. An unavailable user context is an explicit failure, never a SYSTEM fallback.

The installation contains its own bundled Node runtime, pinned release, native executable, job-object helper, private configuration and maintenance snapshot. Run the absolute installed Windows executable through HASHI managed execution. Substitute the owner-selected install root:

```powershell
$sidecar = '<InstallRoot>\bin\hashi-admin.exe'
& $sidecar version
& $sidecar status
& $sidecar capabilities
& $sidecar --help
```

The system executor observes SYSTEM; the user executor observes the configured SID with Limited privileges; user-admin requires an elevated token for that same SID. The native helper creates a suspended child, assigns it to an owned Windows job object, then resumes it. Cancellation, timeout and grant expiry/revocation terminate the owned process tree. Already committed external effects cannot be rolled back by terminating a process.

Grants are issued by a configured, actually elevated Windows operator principal. Publishing privileged immutable intents also requires an approved elevated publisher SID. The selected normal user can execute an authorized user job but cannot write grants, immutable intents, installed code, system-lane responses or elevated-lane responses. DPAPI LocalMachine protects request payloads in addition to filesystem ACLs; it is not a replacement for those ACLs.

The implemented trust binding is the actual Windows publisher SID, installation and host. Agents sharing one service SID are the same OS principal. Agent/session/task labels are audit metadata, not independently attested Agent identities. Existing HASHI managed task/tool/Workzone authority still applies; the Sidecar does not claim to replace it. There is no new password/session-signing scheme and no credential export.

Create a UTF-8 scope JSON using OS-observed publisher SIDs and the authorized task, for example:

```json
{
  "task": "Describe the actual authorized administration task",
  "profiles": ["system", "user", "user-admin"],
  "capabilities": ["identity", "process", "script", "file", "github", "service", "registry", "task"],
  "callerSids": ["<verified publisher SID>"],
  "durationSeconds": 7200,
  "allowAnyCode": true
}
```

```powershell
& $sidecar grant-create --input-file '<AbsoluteScopeJson>'
& $sidecar grant-inspect --grant '<returned UUID>'
& $sidecar grant-revoke --grant '<returned UUID>'
```

One grant is reused for in-scope calls rather than asking again for every operation. Full administrator process/script execution requires allowAnyCode=true and is host-wide authority: cwd/argv checks do not sandbox arbitrary administrator code to selected directories. Typed operations are available when general code is unnecessary.

Requests use a protected grant reference, explicit execution profile and JSON input file. The input may contain account mutation data; durable payloads are encrypted and results redact recognised credential formats and sensitive fields. Redaction is best effort for arbitrary process/file output, not proof that every private datum has been removed. Do not request or print credentials.

```powershell
& $sidecar call --grant '<UUID>' --profile system --operation identity
& $sidecar call --grant '<UUID>' --profile user --operation process.run --input-file '<AbsoluteInputJson>' --request-id '<UUID>'
& $sidecar submit --grant '<UUID>' --profile user-admin --operation script.run --input-file '<AbsoluteInputJson>' --request-id '<UUID>'
& $sidecar result --request-id '<UUID>'
& $sidecar events --request-id '<UUID>'
& $sidecar cancel --request-id '<UUID>'
& $sidecar reconcile --request-id '<UUID>'
```

Process input has absolute executable/cwd, an argv array, optional stdin and timeoutMs (100–86400000). No shell interpolation occurs in the launcher or native executor. Script input has interpreter powershell/node, literal script, matching SHA-256, argv, cwd and optional timeout. Script bytes are snapshot-pinned before execution. The process result records actual identity, PID, exit code, duration, output coverage and owned-job status; a zero process exit alone does not certify an application's external postcondition.

Typed operations:
- file.read/list/write; file writes require expectedSha256 (null for create-only) and verify the resulting bytes. Existing-file writes use read/compare/rename/read, not an atomic filesystem compare-and-swap against other writers.
- service.query/control; control requires exact service name, expectedStatus and start/stop/restart.
- registry.read/write; explicit HKCU/HKLM, key/value name and supported value kind.
- task.query/control; exact task folder/name, expectedState and run/stop/enable/disable.
- github.request; method GET/POST/PUT/PATCH/DELETE, relative canonical GitHub API path, optional JSON body.
- github.graphql; query and optional variables under full authenticated account API authority.

GitHub operations execute through the selected user's existing GitHub CLI keyring, verify the expected GitHub login and keep the host fixed to github.com. The broad API grant deliberately permits the real authenticated account's API rights, including resources reached through GraphQL node IDs; it is not a repository-scoped GraphQL sandbox. Real token permissions, organization roles/SSO and API availability still govern effects. Sensitive APIs may require a renewed or differently scoped credential through the user's normal authentication flow. No such credential changes are made by installation.

REST example input: {"method":"GET","path":"/user/repos?per_page=30"}. Results include safe status/headers and a complete flag; a Link header marks incomplete list coverage. The first response is bounded; no automatic mutation pagination/retries occur. Read-only observations do not prove an attempted mutation succeeded. Definite 4xx rejections retain safe diagnostics; 408, 5xx, lost responses and unconfirmed effects remain uncertain.

Request UUID/input digest, immutable intent, execution claim and durable result prevent replay across caller restarts. A repeated identical UUID returns its prior result; changed input is rejected. An interrupted claim is not executed again. reconcile presents the retained result and directs inspection of the actual target using a separate read; it does not invent a successful reconciliation for arbitrary effects. Cancel/revoke stop future admission and owned active processes, not already committed remote writes.

All original GitHub operations retain their existing argument syntax at the new executable, including result lookup for compatibility requests. legacy-result explicitly selects the compatibility journal if needed. The original installed 1.6 executable/configuration/data stay untouched as a fallback. Its old receipts remain at that original installation and are not silently migrated or replayed.

Install/audit the reviewed program through the managed operator channel:
```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\install-admin-sidecar.ps1 -Mode Install -InstallRoot '<InstallRoot>' -SeedConfig '<VerifiedLegacyConfig>' -RuntimeRoot '<VerifiedPortableNode>'
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '<InstallRoot>\maintenance\install-admin-sidecar.ps1' -Mode Audit -InstallRoot '<InstallRoot>'
```

Installation stages a complete candidate, validates exact identities and files, registers only owned demand-only tasks and audits ACLs. It refuses unrelated directories/tasks and does not overwrite a different release. The installed maintenance snapshot supports Audit, matching-release task repair with Install, and Disable of idle owned tasks. Repair retains installed payload/configuration and durable request/result data. Disable preserves all data; use the original 1.6 program for fallback. Future changed releases require a reviewed staged replacement/migration; this first v2 installer does not pretend to provide a cross-version in-place migration.

The original2.0 qualification described below is historical;2.1 source checks and actual adoption are recorded separately in VERIFICATION.md.

Source, offline/native checks, disposable installed acceptance and actual adopted installation are separate evidence. Qualification passed actual three-token execution, protected-intent ACL denial, file conflict handling, pinned scripts, HKCU, an owned disposable service/task, temporary GitHub account CRUD, request replay protection and active grant revocation. The temporary GitHub resource, service and registry key were removed. Final source SHA, exact check results and adopted-installation identity/integrity receipts are recorded separately in ignored instance evidence and the shared whiteboard. A live GitHub check certifies only the API operations actually exercised; other account permissions remain subject to the authenticated credential.
