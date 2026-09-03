# fsrs-fixtures

Generates `packages/core/test/fixtures/fsrs/py-fsrs.json`, the py-fsrs reference the FSRS-6
scheduler in `@retenia/core` is regression-tested against (sub-phase 4.1).

```sh
cd tooling/fsrs-fixtures
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python gen.py              # deterministic: same seed, same py-fsrs, same JSON
pnpm --filter @retenia/core test     # regression.test.ts replays it
```

`gen.py --help` lists `--sequences`, `--seed` and `--out`. The generator needs only the
`fsrs` package (no torch: the optimizer module is never imported).

What the fixture contains, why py-fsrs 6.x rather than 5.x, and the list of known
discrepancies between ts-fsrs and py-fsrs are documented next to the JSON, in
`packages/core/test/fixtures/fsrs/README.md`.
