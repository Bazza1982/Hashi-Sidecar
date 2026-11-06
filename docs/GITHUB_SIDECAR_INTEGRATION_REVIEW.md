# GitHub compatibility failure semantics

The compatibility worker distinguishes a definite API rejection from an external
effect whose outcome is uncertain. These classifications preserve useful
operator diagnostics without permitting repeated writes.

## Comment creation

An observed integer 4xx rejection of the comment POST, excluding HTTP 408, retains
the safe HTTP/method/resource/reason fields. HTTP 408, 5xx, timeouts and connection
loss remain uncertain because the write may have occurred.

Validation/readback happens after the POST boundary. A later 403/404, malformed
response, changed target, or mismatched author/text remains uncertain even if the
later read failed definitively. It does not prove that the original POST failed.

The durable intent, claim and result are retained in either case. Repeating the
same request ID returns the stored result; changed input is rejected. No
classification automatically posts a replacement comment. Inspect the actual
GitHub target and reconcile the existing request.

Raw provider errors, stderr and response bodies are excluded from failure receipts.
Recognized secret forms are redacted from supported output; arbitrary application
output still needs care.

## Regression boundaries

Tests exercise the actual enqueue/execute/result path, persistent reopening,
duplicate delivery, conflicting input, definite 4xx rejections, uncertain
transport/server errors, and post-success validation/readback failures.
Portable/source checks do not prove a live GitHub mutation or account scope.
See [verification](VERIFICATION.md), [PR operations](GITHUB_PR_OPERATIONS.md) and
[the compatibility decision](decisions/0008-github-user-sidecar.md).
