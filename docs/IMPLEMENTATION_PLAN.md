# Implementation status

Version 3.0 implements:
- Native multi-account routing by explicit local Windows SID.
- Independent protected grant/request/result stores and pinned target identity.
- Fresh Windows installation without legacy configuration or mandatory GitHub.
- SYSTEM, Limited-user and elevated-user profiles with actual token checks.
- Native session admission and per-profile temporary/cache paths.
- Broad program/script execution and typed maintenance operations.
- Durable no-replay behavior, revocation and matching-release repair.
- Retained partial setup intent and same-intent installation resume.
- Public documentation, examples, source/privacy checks and credential-scan CI.

Verification scope and limits are recorded in [VERIFICATION.md](VERIFICATION.md).
Source readiness, hosted CI, installed acceptance and adoption on a particular
computer remain separate milestones. Publishing this source does not replace
existing installations or requeue their requests.
