# Standalone authority and account execution

A local Windows service Agent calls the native hashi-sidecar executable. The
suite resolves an explicit target SID through a protected, integrity-checked
registry and dispatches into that target's independent administration installation.
The existing 2.1.1 broker, encrypted immutable intents, native job objects,
maintenance engine and durable claims/results are reused.

The suite registry binds target SID, installation ID, installation manifest and
configuration hashes. Target roots are owned children of the suite. Both the
registry and child configuration must agree about identity. No default account
is selected from a path, process username or the only configured target.

Each target installation has three profile descriptors. SYSTEM is available for
system-wide administration and maintenance of offline accounts. User execution
uses a demand-only Interactive/Limited task. Elevated-user execution uses
Interactive/Highest and is offered for local administrators only. The native
worker observes the actual SID, elevation and machine before claiming work.
Windows WTS session observation rejects a missing user session before durable
admission. Registry/profile presence alone is not treated as a logged-on session.

The target's actual task process owns its HKCU and environment. Job descendants
inherit that identity; user profile variables refer to the observed Windows
profile. Per-target, per-profile temporary/cache directories live within the
independent installation. They do not inherit an old service process's C-drive
temporary defaults. No target credentials are copied out of Windows.

Configured, actually elevated Windows publisher and issuer SIDs remain the
authority. Grants bind installation, host, caller, profile, capabilities and
expiry. Agents sharing SYSTEM remain one OS principal; labels do not provide
separate Agent authentication. A HASHI adapter must continue to obey its managed
task/tool authority. This product can also be called by other authorized clients.

GitHub configuration is optional per target. Windows-only installations contain
no active compatibility worker/configuration or GitHub CLI dependency. Explicit
GitHub enrollment adds github.request/graphql through that target's existing CLI
credential store and expected account identity. The old finite GitHub interface
can still be installed with an explicit optional legacy seed using the low-level
installer. Neither path requires Hub to run or import Hub modules.

Effects are at-most-once admission per request UUID/digest. Interrupted claims
remain uncertain and need target observation; they are not automatically retried.
Revoking a grant stops admission/owned active work and preserves durable results.
Full-code grants are deliberately broad administrator authority, not a sandbox
between accounts. Separate target stores prevent accidental grant/result mixing.

Suite installation records a protected setup journal, supports resuming the same
prepared intent after a target installation fails, and checks payload/configuration
integrity before matching-release task repair. Changed releases or enrollment use
a fresh owned root, preserving old grants/results. No old intent is migrated or
requeued. Hub and its installed program are outside the suite's ownership.
