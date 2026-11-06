# Local administration and maintenance 2.1

An approved operator task can use the actual SYSTEM, selected Limited user or elevated selected-user profile to run any supported local program or pinned PowerShell/Node script. This is the general escape from a finite operation catalogue: new repairs do not require a new executable for each possible application. Real Windows/account permissions and the caller's managed task/tool authority remain applicable. Installation does not disable protections or create access to an unavailable login/session.

Use the absolute installed `bin\hashi-admin.exe` through managed execution. The installed root has its own versioned guide and integrity-pinned dependencies. Confirm `version`, `status` and `capabilities` first. A normal user profile is required to be genuinely Limited; the elevated user profile is required to be genuinely elevated. User profiles require that selected user to be logged on.

## Reusable task approval

Create a scope JSON with task, profiles, capabilities, callerSids, durationSeconds (60–86400), and allowAnyCode. Use OS-observed publisher SIDs. Full operator work uses capabilities identity/process/script/file/github/service/registry/task/acl and allowAnyCode=true. One protected grant is reusable for that task. Revoke it at completion; a new task uses a new grant rather than interpreting a label as approval.

For a typed credential repair, omit general code permission, include acl/file and the required profiles, and optionally add pathRoots with the authorized local file/directory roots. pathRoots restricts typed file/ACL operations only. It does not sandbox arbitrary administrator scripts, processes, registry, services or tasks.

The native client exposes:
- grant-create --input-file ABSOLUTE_JSON
- grant-inspect / grant-revoke --grant UUID
- call / submit --grant UUID --profile system|user|user-admin --operation OP --input-file ABSOLUTE_JSON --request-id UUID
- result / events / reconcile / cancel --request-id UUID

Grants and immutable intents remain protected Windows-principal state. Several Agents sharing SYSTEM remain the same OS principal. No extra per-Agent identity infrastructure is required to perform an owner's already-authorized maintenance task.

## ACL maintenance without credential export

Operations:
- acl.inspect: path. Returns file identity, owner and security descriptor metadata; reads no content.
- acl.plan: path and changes. Each change has action grant/remove, exact sid, rights Read/ReadAndExecute/Modify/FullControl and optional access Allow/Deny. Changes affect only that file/directory, without recursive inheritance grants.
- acl.apply: path and planId. Applies that protected plan only under the same grant/profile/installation, within ten minutes and the grant deadline.
- acl.restore: path and planId. Restores the saved DACL only if file identity and expected post-state still match.
- file.probe: path and optional maxBytes up to16MiB. Run under the actual intended runtime user. Returns readable/bytesRead/complete and no file contents.

Plan/apply/restore execute in system or user-admin; ordinary users can inspect/probe. ACL plans retain metadata, not credential values. The plan ID is the original plan request UUID. Save it, then apply with a distinct request UUID. A duplicate immutable request returns its prior result. The native update reads/writes descriptors using a stable local handle, preserves owner/group/SACL and contents, and rejects file replacement, reparse paths, unexpected hard links and stale descriptors. Root/path and plan comparisons do not provide an atomic compare-and-swap against arbitrary external administrators; coordinate credential writers and reconcile concurrent changes.

The add-read operation does not erase Deny rules. Inspect real access, calculate the owner-authorized specific correction and validate again. A successful ACL write alone is not a readable-credential claim. File creation/migration/publication must also preserve the registered runtime SID's required access.

## Processes and tasks

process.inspect takes pid and returns creationTicks as a STRING, executable, session and observable owner SID. process.stop requires pid, expectedCreationTicks, expectedExecutable and optional timeoutMs up to60000. It holds the exact process handle, rejects a changed identity and waits for termination. The target's final status is targetExitCode, distinct from the stop command's success. Inspect all relevant descendants and stop verified children before parents; never substitute an unguarded wildcard kill.

task.restart takes exact folder/name, expectedState Ready/Running, and optional processGuards. Each guard names pid/expectedCreationTicks/expectedExecutable. A grant with guards also requires process capability. It stops the original task if running, terminates the explicitly guarded leftovers, and starts the original definition. The result deliberately says schedulerDispatched=true and applicationReady=false. Application health/authentication acceptance must be performed separately.

For Remote maintenance: resolve the registered task's actual SID and credential resource, preflight file.probe under its original Limited identity, perform only the needed ACL plan/apply, validate again, then restart the original task with verified process guards. Confirm credential-valid state, intended authenticated instance and actual Workbench inventory. Preserve unrelated Core/Functions/Workers/model services. An old ready response or another instance's Agent list does not certify restoration.

## General programs, long jobs and diagnostics

process.run accepts absolute executable/cwd, a literal argv array, optional stdin and timeoutMs. script.run accepts interpreter powershell/node, script text with its matching sha256, literal argv and cwd. Optional window=normal permits visible application windows in user/user-admin; SYSTEM session0 cannot substitute for the interactive desktop. UI automation can run in a pinned user script within the active job. No specific third-party application UI workflow is certified merely by admission. These run the requested task with the selected real Windows identity; use them for installers, application repairs, account maintenance and tasks not covered by typed operations.

The maximum requested runtime is24hours and the active grant deadline also stops the owned job. Per-profile execution is serialized; queued requests expire with the grant. Use submit for long work, then events/result. events exposes actual child PID/creation time and running/finished state where available. Timeout/revocation/cancellation retains bounded sanitized diagnostics in an uncertain-outcome receipt. General output redaction is best effort; never print credentials.

The native helper owns a kill-on-close job object. Process/script descendants are stopped when the owned job ends. To install a persistent application/service or start an existing persistent task, use the supported installer/service/scheduler mechanism within the authorized task. Do not expect a background child of process.run to remain alive after its job closes.

Request IDs, execution claims and results prevent automatic replay. An uncertain mutation requires inspection of the actual target and retained stage receipt. A wrapper exit0 does not prove application readiness.

## Installation, adoption and rollback

Install the reviewed version into a fresh parallel owned root with the existing installer, a verified legacy SeedConfig and a portable RuntimeRoot. Audit it, qualify actual identities and disposable effects, then update the shared entry documentation to that new executable. The installer registers only owned demand-only tasks, pins both native helpers and the maintenance module, and protects control state and ACL plans.

Do not overwrite a different release or silently migrate/requeue its old intents. Preserve the old v1.6/v2.0 package/configuration/journals as fallback. Revoke grants after qualification and disable only idle owned disposable candidates. Reversion consists of selecting the retained prior executable and its own original journal; it does not undo already committed task effects.

Source tests, Windows native tests, candidate acceptance, final adopted installation and exact-SHA hosted CI are different evidence. See [verification](VERIFICATION.md).
