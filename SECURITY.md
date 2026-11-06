# Security

## Reporting a problem

Please do not open a public issue for a security problem. Use GitHub's private
report instead: the **Security** tab of this repository → **Report a
vulnerability**. Say what you ran, on what, and what happened.

This is a one-person project. Expect a first answer within a week.

## What counts

- The probe or `fix` writing, deleting or sending something it says it does
  not: the probe writes nothing to the repo, `fix` never overwrites a file,
  `--url` sends GET requests only unless `--csrf-post` is given.
- A generated file that weakens the project it lands in: a workflow that
  leaks a secret, a helper that lets a request through it claims to stop.
- Code execution from a repository's contents while it is being probed.

A gate that passes when it should fail is a bug, not a vulnerability. Open a
normal issue with the smallest input that reproduces it. Those reports are the
most useful ones this project gets.

## What the tools run

Zero dependencies. The probe reads files, runs `git ls-files` and `git log`,
and for gate 2 runs `npm audit` or `pip-audit` (`--no-audit` skips that).
`fix` writes files only with `--write`.

## Supported versions

Only the latest version on `main`.
