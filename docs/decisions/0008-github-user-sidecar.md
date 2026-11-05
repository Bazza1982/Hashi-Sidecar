# ADR 0008: GitHub operations under the selected Windows user

Status: retained compatibility design.

A Windows service cannot use another user's GitHub keyring merely by reading
that user's configuration directory. The compatibility adapter runs a fixed
demand-only Task Scheduler worker using that user's Interactive/Limited token.

Protected configuration binds the expected Windows SID/profile, GitHub login,
worker digest and repository read/write scope. Windows resolves the account;
its identity is not inferred from a folder name. Credentials stay in the user's
existing GitHub CLI keyring and travel only through the supported CLI/helper
boundary. The adapter exposes no network listener.

Finite operations cover account/repository/CI reads, exact source intake,
pinned publication, guarded file commits and PR metadata/discussion operations.
A write scope is explicit. Protected branches are not publication targets.
Separately authorized PR merging pins the full head SHA and expected base,
requires complete passing CI and verifies the result. Source publication does
not restart or deploy an application.

Each request has durable identity, digest, intent, claim and result. Duplicate
requests return their saved result; conflicting IDs fail. Unknown write outcomes
need reconciliation, without blind replay or force-push.

PR metadata changes require expected HEAD/revision and independent readback.
GitHub's API does not supply a general atomic metadata compare-and-swap;
concurrent editors must coordinate. Comment POST and later validation failures
have distinct outcome semantics. See the
[failure contract](../GITHUB_SIDECAR_INTEGRATION_REVIEW.md).

The permanent compatibility package carries its own runtime, immutable worker,
native launcher and maintenance snapshot. Matching-release repair preserves
journals; changed releases use owned staged replacements. It requires the selected
user to remain logged on. Logout, credential expiry, changed scope/identity or
modified payloads fail explicitly.

The standalone administration suite can instead use its optional general GitHub
REST/GraphQL adapter. The finite compatibility interface remains an explicit
installation choice. See [shared compatibility operations](../GITHUB_SHARED_PROGRAM.md),
[operation reference](../GITHUB_SIDECAR_OPERATIONS.md) and
[verification](../VERIFICATION.md).
