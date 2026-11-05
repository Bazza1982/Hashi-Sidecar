# Working on HASHI Sidecar

Read README.md, docs/ARCHITECTURE.md, docs/STANDALONE_OPERATIONS.md,
docs/VERIFICATION.md and the account-broker ADR before editing.

- Keep the source independent of application state and other project checkouts.
  Preserve installed programs, credentials and durable results during source work.
- Use explicit Windows SIDs, OS profile/group/session observations and actual
  worker tokens. Never derive an account from a folder name.
- Retain broad process/script execution and reusable grants. Report unavailable
  identities honestly; never silently substitute SYSTEM for a requested user.
- Protect per-target grants/intents and routing pins. Uncertain effects require
  reconciliation, never automatic replay with a fresh request ID.
- Windows and application credential stores own authentication. Do not implement
  replacement password/recovery crypto or export credentials.
- A task grant does not override the caller's managed authority. Agents sharing
  one OS SID remain one principal.
- Follow the host's development/storage policy and use isolated owned fixtures.
  Source work does not authorize deployment or unrelated service restarts.
- Run npm run check for behavioral changes. Keep source tests, native checks,
  real installed acceptance and hosted CI evidence distinct.
- Before publication, run the checks in docs/PUBLICATION.md on the tree, every
  Git ref/history and source export. Keep real identities, machine paths,
  credentials, state, reports and private history backups outside published Git.
- Use reviewable commits. Do not infer a remote, change visibility, force-push,
  merge or deploy without the applicable task authorization.
