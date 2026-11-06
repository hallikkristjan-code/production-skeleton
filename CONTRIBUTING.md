# Contributing

The most useful thing you can send is a wrong result: a gate that passed and
should not have, or failed and should not have.

## Reporting a wrong result

Open an issue with:

1. the gate number and the status you got;
2. the smallest set of files that reproduces it (two or three short files is
   normal);
3. what you expected, in one sentence.

## Sending a fix

```bash
npm test
```

Node 20 or newer, no dependencies to install.

- Write the failing test first. Most tests are a few inline files and one
  assertion; see `tests/regressions.test.mjs`.
- A fix for a false PASS comes with a positive case too, so the gate does not
  turn everything into FAIL.
- Keep it narrow. The probe is a set of heuristics that point at a file and
  line. It is not a parser, and it should not claim to be one.
- If the change alters what a gate means, update the gate table in
  `README.md` and the Statuses section of `skills/production-skeleton/SKILL.md`
  in the same pull request.

## What will not be merged

- New gates. Thirteen is the point.
- Performance, SEO, accessibility, code-quality or deep OWASP checks. Other
  tools do those.
- A paid service or an LLM call inside the probe.

New stack adapters are welcome once you have run one on a real project: say
which project shape you built and tested it on.
