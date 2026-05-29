# Python Port Contracts

These fixtures pin the shared behavior expected from the TypeScript and Python
Agntz runtimes. The Python implementation consumes them directly in tests, and
the TypeScript implementation should be wired to the same fixtures as parity
coverage expands.

The contract goal comes from `planning/python-port-plan.html`: a YAML agent
definition should run identically in TypeScript and Python.

Fixture groups:

- `manifests/` contains representative YAML for each agent kind, including
  resource declarations.
- `expectations/` contains normalized fields, state snapshots, and stream/event
  shapes that both runtimes should preserve.
