# Public-source publication checks

The publication unit is Git source and its selected reachable history. Runtime
installations, account inventories, credentials, request journals and machine
qualification receipts belong outside that unit.

## Repeatable checks

```powershell
npm.cmd run check
npm.cmd run check:public
gitleaks dir . --redact --no-banner
gitleaks git . --log-opts="--all --full-history" --redact --no-banner
```

Use a maintained official Gitleaks release and verify its archive against the
official checksum/digest before execution. Its reports can contain private
context even when redacted; write them outside the source repository.

check:public inspects tracked and unignored files, plus all reachable Git blobs,
for account-specific SIDs, machine profile/project paths, hostnames, private IP
addresses and credential/generated file paths. Only the documented synthetic SID
prefixes in test fixtures are excepted. Diagnostics report filenames/categories/
line numbers, never detected values. Gitleaks independently checks credential
signatures; the privacy checker is not a replacement for it.

Review commit authors/emails, messages, all branches/tags/stashes and remote
configuration as well as file content. Tests/examples must use synthetic
identities, placeholders and reserved example domains. Review documentation for
internal operational notes or private project references that a pattern scanner
cannot reliably classify.

Deleting a file in the latest commit leaves its older contents in Git history.
Before a first public publication, preserve any necessary private history outside
the publication repository, create clean public history, remove obsolete refs and
audit the resulting graph. Never rewrite or force-push shared history as an
automatic cleanup step. An existing public exposure needs its own investigation.

## Export

Create a source archive from the reviewed commit:

```powershell
git archive --format=zip --output '<PrivateOutputDirectory>\sidecar-source.zip' HEAD
```

Scan the extracted archive too. Do not zip a working directory containing ignored
configuration/state or a private backup. Commit only example configuration with
placeholders. Keep audit reports, backups, scanner binaries, node runtimes and
generated installers outside source.

The checked-in CI workflow repeats public-history/privacy and credential scans
with read-only repository permissions. Passing local checks does not claim that
a hosted run, destination visibility change or push has occurred. A public GitHub
repository does not itself add an open-source license; the current package
metadata remains UNLICENSED.
