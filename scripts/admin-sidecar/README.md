# HASHI Sidecar 3.0 administration engine

This is the per-target execution engine used by the standalone multi-account
suite. The suite entry is bin\hashi-sidecar.exe --target-sid SID. This target's
bin\hashi-admin.exe retains the underlying task-grant/job/result interface.

The independent installation pins its runtime, native helpers, scripts and
protected configuration. SYSTEM, Limited user and elevated same-user jobs use
their real Windows tokens. Standard users have no elevated-user lane. A missing
user session/profile reports unavailable without changing execution identity.

Create one authorized task grant and reuse it for process.run/script.run and
typed file, ACL, service, registry, process and task operations. allowAnyCode=true
retains broad operator code execution; no new command allowlist is introduced.
Requests use stable UUIDs and pinned inputs. Durable results survive caller
restarts and revocation; uncertain effects require observation/reconciliation.

Fresh installation accepts an explicit TargetSid, publisher/issuer SIDs and
portable RuntimeRoot. It requires no Hub, GitHub CLI or legacy SeedConfig.
Optional GitHubLogin/GhPath configures account API operations through that user's
existing keyring. An explicit legacy SeedConfig enables the preserved finite
GitHub compatibility interface. It is never synthesized for Windows-only use.

Native execution owns its process descendants and records actual identity,
PID, exit status and bounded output. User jobs use the target profile/HKCU.
Per-profile temporary/cache directories remain within the target installation.
SYSTEM Session 0 is separate from the user's interactive desktop.

ACL maintenance retains the existing metadata-only plan/apply/conditional restore,
actual-token credential probe, stable file identity and stale-state checks.
Long-job events/result/cancel/reconcile remain available. Scheduler dispatch is
separate from application readiness; do not claim a repaired service from exit 0.

Audit and matching-release repair use the installed maintenance snapshot and
preserve grants, requests, claims and results. Different releases/enrollment use
fresh owned roots. Keep all prior installations/results and do not requeue their
old intents. Existing Hub packages and other services are outside this program's
ownership.

Grants authenticate actual elevated Windows principals, not Agent labels. Several
Agents sharing SYSTEM remain one principal and must retain their managed task/tool
authority. Arbitrary output redaction is best effort; never print credentials.
