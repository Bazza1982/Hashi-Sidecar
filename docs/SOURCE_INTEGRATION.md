# Source reuse and distribution boundaries

The standalone program reuses the earlier Sidecar Windows execution, maintenance
and GitHub compatibility implementations. Version 3.0 adds multi-account routing,
fresh explicit-identity installation, optional GitHub, native session admission
and separate temporary/cache environments.

The public source distribution contains programs, tests, examples and operating
documentation. It contains no application database, installed configuration,
account inventory, credentials, runtime journal, bundled third-party runtime or
machine-specific acceptance receipt. The installed runtime is supplied explicitly
during installation together with its license.

A source publication is independent of an installed adoption. Existing programs,
credentials, grants and results are not removed or changed by publishing this
repository. Installation and upgrade use owned roots and pinned payloads; old
requests are not migrated or replayed automatically.

Internal development reviews and private environment histories are not part of
the public source record. Public preparation uses a clean source baseline; any
needed private backup stays outside the publication repository. See
[publication checks](PUBLICATION.md) and [verification](VERIFICATION.md).
