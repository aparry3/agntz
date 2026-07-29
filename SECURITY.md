# Security Policy

## Supported versions

agntz is in public beta. Security fixes are released for the latest published
minor version of each package and for the `main` branch. Older experimental
versions are not supported.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Submit a
[private security advisory](https://github.com/aparry3/agntz/security/advisories/new)
with:

- the affected package, version, and configuration;
- reproduction steps or a minimal proof of concept;
- the expected impact; and
- any known workaround.

The maintainers will acknowledge a report within three business days, keep the
reporter informed while the issue is investigated, and coordinate disclosure
after a fix is available. Please allow a reasonable remediation window before
publishing details.

## Scope

Reports about authentication, tenant isolation, secret handling, outbound URL
controls, tool execution, package integrity, and hosted API authorization are in
scope. General support requests and feature proposals belong in GitHub Issues.
