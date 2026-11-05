# HASHI GitHub Sidecar — agent quick start

Read a completed CI job's failed-step output with `check-log --repo OWNER/REPO --sha COMMIT --job JOB_ID`. It verifies job/repository/commit identity before and after retrieval, includes step outcomes, and returns at most the last 128 KiB with explicit truncation. The upstream process is bounded to 2 MiB and 40 seconds; larger output fails explicitly. Recognised GitHub tokens and authorization headers are masked; CI logs can still contain private repository data.

The permanent Windows program uses the configured logged-on Windows user's
GitHub CLI keyring. Invoke its absolute executable through HASHI managed
execution. The caller's own tool and Workzone authority still applies.

## Entry point

The installation root contains this guide and LOCATION.md. The executable is
bin\hashi-github.exe; it bundles a runtime and a digest-pinned immutable worker.
The caller needs no Node installation or global PATH change.

    & '<InstallRoot>\bin\hashi-github.exe' --help
    & '<InstallRoot>\bin\hashi-github.exe' version
    & '<InstallRoot>\bin\hashi-github.exe' status

For direct argv, pass the absolute executable as argv[0] and each option/value
as one item. Text is never evaluated by a command shell. Do not paste credentials.

## Operations

- account: authenticated account under the configured Windows user.
- main/checks/source: repository/main identity, exact-source CI and pinned source.
- branch/pr-list: exact branch and its PRs, including closed PRs.
- merge-info: read-only exact-head/base merge methods and protection diagnostics.
- push/write: pinned clean Git snapshot or expected-head repository file commit.
- pr-create: create a PR or return an existing matching one.
- pr-view: full PR title/body, current HEAD/base/state and metadata revision.
- pr-edit: change only supplied title/body, guarded by exact HEAD and revision.
- pr-files: bounded changed files and available diff patches.
- pr-comments: bounded PR discussion comments (not inline review threads).
- pr-comment: append one explicitly requested discussion comment.
- pr-update-base/pr-merge: existing separate exact-head/base operations.
- result: durable write receipt or explicit pending/uncertain state.

The installed status output lists the actual supported operations and effective
read/write repository scope. A configured account scope stays limited to that
authenticated owner; a list scope stays limited to its explicit repositories.
An upgrade does not authorize an Agent to post, merge or change a repository
outside its current user task.

## Edit an existing PR

First read the current metadata. Use its returned sha and revision, not a
remembered version. The body file must be an absolute local path and strict UTF-8.

    $sidecar = '<InstallRoot>\bin\hashi-github.exe'
    $view = & $sidecar pr-view --repo '<owner/repository>' --pr '4' | ConvertFrom-Json
    & $sidecar pr-edit --repo '<owner/repository>' --pr '4' --sha $view.data.sha --expected-revision $view.data.revision --body-file '<AbsolutePath>\description.md'

Optional --title-file changes the title; omitting a field preserves it.
An explicitly empty body file clears the body. Text includes literal newlines,
quotes and Markdown; it is sent as JSON, not command text. Body/comment input
is capped at 65,536 UTF-8 bytes; titles at 256 characters. Invalid UTF-8,
non-files, reparse paths, overlarge files and unknown options are rejected.

Metadata is compared again before PATCH and read back after it. Stale HEAD or
revision fails explicitly; an already matching result is a verified no-op.
This is read/compare/write/read, not an atomic server-side metadata CAS.
GitHub metadata PATCH does not provide that guarantee: coordinate human/Agent
editors for the narrow external race window. Unconfirmed results stay uncertain;
they must not be treated as an unapplied write.

## Review and comments

    & $sidecar pr-files --repo '<owner/repository>' --pr '4' --sha '<full SHA>' --limit '50'
    & $sidecar pr-comments --repo '<owner/repository>' --pr '4' --limit '50'
    & $sidecar pr-comment --repo '<owner/repository>' --pr '4' --sha '<full SHA>' --body-file '<AbsolutePath>\comment.md' --request-id '<UUID>'
    & $sidecar result --request-id '<UUID>'

Lists default to 50 entries, maximum 100, with a response byte cap. complete,
omitted, truncated and reason describe list coverage. Individual patches and
comment bodies expose truncation; missing/binary/provider-omitted patches are
not invented. pr-comments covers issue-style PR discussion, not inline reviews.
A changed PR during pagination is rejected instead of mixing snapshots.

Writes print a request UUID before task dispatch and retain intent/claim/result.
A completed identical request is reused; a conflicting ID is rejected.
An interrupted claimed comment never posts again automatically. A lost edit
response is successful only after exact-field readback; an ambiguous comment
POST remains uncertain. Inspect result and PR comments before considering a
new request. Do not blindly retry with a new UUID.

## Runtime and maintenance

The selected Windows user must remain logged on and have a valid GitHub login.
Credentials remain in the user's keyring. There is no network listener,
periodic job, arbitrary API URL or general shell endpoint.

Use the installed maintenance snapshot's Audit mode for read-only integrity,
ACL and owned-task checks. Install repairs a byte-identical idle package.
A newer reviewed package uses upgrade-shared-github-sidecar.ps1 with the exact
ExpectedReleaseId. Upgrade refuses a busy owned task/queue, preserves the
installation identity/data and retains its private rollback copy.
Do not restart HASHI, model backends or unrelated services for this tool upgrade.
