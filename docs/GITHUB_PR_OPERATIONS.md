# PR metadata and discussion operations

CI failure diagnosis also supports `check-log` for an exact SHA and completed job ID. It returns job/step identity and a UTF-8-safe 128 KiB log tail, marks omitted output and masks recognised credential formats. A foreign, changed or still-running job is rejected. It uses fixed GitHub job routes and the GitHub CLI failed-step reader; it accepts no URL or arbitrary command.

Windows path identity uses canonical existing paths after reparse checks. Long names and 8.3 aliases can identify the same owned checkout/runtime; branch, HEAD, cleanliness and bundle byte verification still apply. Linux paths retain case-sensitive comparison.

Version 1.6 adds PR view/edit, changed-file patches and discussion comments to
the existing scoped operator Sidecar. It preserves source/CI reads, pinned
publication, PR creation, retargeting and separately authorized merging.

Use the installed agent guide and status for command syntax and actual scope.
The executable stays at the existing shared installation; no caller environment,
credential store, HASHI Core, member application or model backend changes.

## Request and outcome contract

pr-view returns the real PR title/body and sha, head, base, state, merged,
draft, updatedAt, changedFiles, comments, URL and a revision digest.
The digest covers the current metadata snapshot, including body and HEAD.

pr-edit requires repository, PR number, exact sha and the freshly observed
revision. Only supplied title/body fields enter PATCH; omitted fields stay
unchanged. It cannot merge, close/reopen, change base or alter access settings.
Stale metadata is rejected before mutation. Matching requested fields return
verified=true, reused=true and updated=false. Otherwise the operation rechecks
before PATCH and verifies requested fields, HEAD/base/state afterward.
A missing or mismatched readback is explicit uncertainty.

GitHub metadata PATCH has no atomic compare-and-swap in this contract.
The local revision and repeated reads catch observed conflicts, but cannot
exclude an external editor racing between the last read and PATCH. Serialize
collaborating editors when that distinction matters. The receipt states
read-compare-write-read rather than claiming an upstream atomic CAS.

pr-comment is a separate append operation with a required current HEAD.
It verifies returned comment identity, repository/PR URL, author and exact text
through a second read. It retains the existing durable write intent and claim.
An ambiguous POST is not retried and is not attributed from a different
matching comment. Use result and discussion reads to reconcile manually.

A definite 4xx rejection of the POST, excluding HTTP 408, retains
SIDECAR_UPSTREAM_FAILED with its allowlisted HTTP status, API method/resource,
fixed upstream reason and exit code. Raw provider text is never retained.
HTTP 408, 5xx, transport failure or a lost response remain
SIDECAR_WRITE_OUTCOME_UNCERTAIN. After a successful POST, even a 403/404 during
comment/PR readback remains uncertain; it does not prove that the append failed.
Both definite failure and uncertainty retain the durable claim and saved result.
Repeating the same request ID returns that result without another POST;
a new request ID must not be used as an automatic retry.

The public client accepts absolute UTF-8 text files, never caller shell/API
commands. Bounded file reads reject oversized input before enqueue; malformed
UTF-8 and non-files fail explicitly. No token, original provider error or local
path is intentionally included in failure projection. API method/resource,
HTTP status and fixed diagnostic reason remain available.

## Bounded review reads

pr-files and pr-comments accept optional sha and limit (1–100; default 50).
The latter reads PR discussion, not inline code-review threads.
The worker reads bounded pages and caps the returned record bytes.
complete/omitted/truncated/reason distinguish full results, item/byte limits
and upstream gaps. Diff patch and comment-body truncation are explicit.
Missing/binary patches remain missing. Repeated file/comment identities or a
changed PR metadata snapshot cannot silently form a complete report.

These are bounded retained request receipts, not a replacement for GitHub
history, code review or an independently approved merge/deployment decision.

## Source and adoption

The local historical checkout was version 1.0, while the installed verified
worker was 1.5. Remote source intake pinned the 1.2 write/merge baseline; the
digest-verified installed maintenance snapshot preserved the subsequent 1.5
account scope, retargeting and diagnostics implementation. No credentials or
instance data enter Git. The installation bytes/provenance, offline checks,
package upgrade, real GitHub reads and actual PR-body update are recorded
as separate outcomes in the current ignored delivery receipt.
