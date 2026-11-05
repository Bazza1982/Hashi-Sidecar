# Release notes

Version 3.0 is a standalone service-to-account Windows administration program
with a multi-account CLI and fresh installation. GitHub is optional, and a
previous application/Sidecar installation is not required.

Full-code grants retain broad administrator/user program and script execution.
The selected Windows token determines actual account access. Missing sessions
and unavailable elevated profiles fail explicitly. Shared-SID agents are one
OS principal and must continue to follow their integrating platform's authority.

Each target keeps its own grants and durable results. Changed releases or
enrollment use a new owned root; old claims are retained and never automatically
replayed. Matching-release repair preserves installed payload/state.

Public preparation adds privacy checks for the working tree and reachable Git
history, a maintained credential scan in CI, and generic operating examples.
Configuration, private development history and machine acceptance receipts are
excluded from the public source distribution.

See [README](../README.md), [operations](STANDALONE_OPERATIONS.md),
[architecture](ARCHITECTURE.md), [verification](VERIFICATION.md) and
[public-source checks](PUBLICATION.md).
