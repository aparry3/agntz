# Agntz Python

Python SDK and client implementation for Agntz.

This package follows the migration plan in `../planning/python-port-plan.html`:

- hosted client parity with `@agntz/client`
- manifest contract parity with `@agntz/manifest`
- embedded local SDK parity with `@agntz/sdk`

The compatibility rule is that an agent definition YAML file should have the
same observable behavior in the TypeScript and Python runtimes.
