# ADR 0010: Independent service-to-account administration

Status: implemented; installed qualification is separate evidence.

A service-based automation agent needs explicit execution in local administrator
and standard-user contexts. The Sidecar reuses its existing execution engine
behind one native CLI with independent per-target installations.

A protected registry binds explicit target SIDs, installation IDs and payload/
configuration pins. Per-target grants, requests and results remain separate;
the public client never selects an account from a directory name or implicit
default.

Retain SYSTEM, Limited-user and elevated-same-user execution. Standard users
cannot acquire a fictitious elevated-self token. Offline-account SYSTEM
maintenance remains available while missing user sessions fail explicitly.
Use Windows-native account/profile/group/session observations and actual worker
tokens. Domain/nested-group policy requires separate adapter qualification.

Fresh installation takes explicit identities and a portable runtime. A previous
Sidecar, application process or GitHub credential is not required. GitHub and the
finite compatibility interface are optional. Typed operations complement broad
process.run/script.run and reusable grants without new command allowlists or
per-operation approval prompts.

Develop and qualify in isolated nonproduction environments under the host's
policy. Publish source independently from installed adoption; preserve existing
programs and journals. No source extraction or publication implicitly authorizes
an unrelated application's modification, deployment or restart.
