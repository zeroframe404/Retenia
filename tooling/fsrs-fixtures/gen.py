#!/usr/bin/env python3
"""Generate the py-fsrs regression fixtures for `@retenia/core`'s FSRS-6 scheduler.

    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
    .venv/bin/python gen.py            # writes packages/core/test/fixtures/fsrs/py-fsrs.json

The output is deterministic for a given `--seed` and py-fsrs version; regenerate only when
the pinned py-fsrs changes, and commit the JSON with it.

Why py-fsrs 6.x. The `fsrs` package on PyPI implements FSRS-5 (19 parameters, a fixed decay
of 0.5) in its 5.x line and FSRS-6 (21 parameters, `w20` = decay) from 6.0 on. Retenia is
FSRS-6 (`docs/spec/02-memory-system.md` §3), and ts-fsrs 5.4.2's default parameters are
py-fsrs 6's `DEFAULT_PARAMETERS`, so 6.x is the line that can serve as the reference.

What a sequence is. Every sequence starts from a card never reviewed and applies 3–12
reviews. Each step records the card *before* (py-fsrs's state), the review instant, the
rating, and the card *after*, so `regression.test.ts` can check every transition on its
own (feeding py-fsrs's state in and comparing what comes out) as well as replay whole
sequences. Fuzz is off on both sides.

Elapsed days are counted differently by the two libraries: ts-fsrs (and Retenia's study
days) count date changes, py-fsrs floors the elapsed duration to whole 24-hour periods —
a review 23 hours after the previous one is "same day" for py-fsrs and "next day" for
ts-fsrs. The generator keeps both views equal by construction: a next-day review happens
at the same wall-clock time as the previous one or later, and same-day reviews only ever
move that time forward, by at most six hours over a whole sequence, so nothing crosses
midnight UTC or Retenia's 04:00 rollover.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fsrs import Card, Rating, Scheduler, State
from fsrs.scheduler import DEFAULT_PARAMETERS

# 08:00 UTC, drifting at most six hours later over a sequence: never past midnight UTC,
# never back across Retenia's default 04:00 rollover.
BASE = datetime(2026, 1, 5, 8, 0, tzinfo=timezone.utc)
SAME_DAY_BUDGET_MINUTES = 6 * 60

DEFAULT_W = list(DEFAULT_PARAMETERS)

# A hand-picked vector inside every clamp range of §3.3, far enough from the defaults that
# a formula reading the wrong index would show.
CUSTOM_W = [
    0.4, 1.0, 3.0, 10.0, 6.0, 0.9, 2.5, 0.01, 1.5, 0.2, 1.0, 1.2, 0.08, 0.3, 1.5, 0.5, 2.2,
    0.6, 0.15, 0.1, 0.2,
]

# w0 and w1 below 0.1: ts-fsrs floors the initial stability at 0.1, py-fsrs at 0.001 — the
# first known discrepancy (§5). Everything else is the default.
S0_CLAMP_W = [0.05, 0.08] + DEFAULT_W[2:]


def steps(*minutes: int) -> list[timedelta]:
    return [timedelta(minutes=m) for m in minutes]


def step_unit(delta: timedelta) -> str:
    minutes = int(delta.total_seconds() // 60)
    if minutes % 1440 == 0:
        return f"{minutes // 1440}d"
    if minutes % 60 == 0:
        return f"{minutes // 60}h"
    return f"{minutes}m"


CONFIGS: dict[str, dict] = {
    "default": dict(parameters=DEFAULT_W, desired_retention=0.90, maximum_interval=36500,
                    learning_steps=steps(1, 10), relearning_steps=steps(10)),
    "urgent": dict(parameters=DEFAULT_W, desired_retention=0.95, maximum_interval=180,
                   learning_steps=steps(1, 10), relearning_steps=steps(10)),
    "high": dict(parameters=DEFAULT_W, desired_retention=0.92, maximum_interval=365,
                 learning_steps=steps(1, 10), relearning_steps=steps(10)),
    "maintenance": dict(parameters=DEFAULT_W, desired_retention=0.85, maximum_interval=3650,
                        learning_steps=steps(1, 10), relearning_steps=steps(10)),
    "no-steps": dict(parameters=DEFAULT_W, desired_retention=0.90, maximum_interval=36500,
                     learning_steps=[], relearning_steps=[]),
    "single-step": dict(parameters=DEFAULT_W, desired_retention=0.90, maximum_interval=36500,
                        learning_steps=steps(5), relearning_steps=steps(10)),
    "three-steps": dict(parameters=DEFAULT_W, desired_retention=0.90, maximum_interval=36500,
                        learning_steps=steps(1, 10, 60), relearning_steps=steps(10, 60)),
    "custom-w": dict(parameters=CUSTOM_W, desired_retention=0.88, maximum_interval=1000,
                     learning_steps=steps(1, 10), relearning_steps=steps(10)),
    "s0-clamp": dict(parameters=S0_CLAMP_W, desired_retention=0.90, maximum_interval=36500,
                     learning_steps=steps(1, 10), relearning_steps=steps(10)),
}

RATING_WEIGHTS = {Rating.Again: 15, Rating.Hard: 15, Rating.Good: 55, Rating.Easy: 15}


def iso(dt: datetime | None) -> str | None:
    return None if dt is None else dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def snapshot(card: Card) -> dict:
    """The card as our `Card` sees it: a py-fsrs Learning card with no stability is New."""
    new = card.stability is None
    return {
        "state": 0 if new else int(card.state),
        "step": 0 if card.step is None else card.step,
        "stability": card.stability,
        "difficulty": card.difficulty,
        "due": iso(card.due),
        "lastReview": iso(card.last_review),
    }


def next_delta(rng: random.Random, card: Card, minutes_used: int) -> tuple[int, int]:
    """(days, minutes) to the next review: same day for learning steps most of the time,
    around the due date for Review cards, with early and late reviews mixed in."""
    can_stay = minutes_used + 120 <= SAME_DAY_BUDGET_MINUTES
    roll = rng.random()
    if card.state in (State.Learning, State.Relearning):
        if roll < 0.55 and can_stay:
            return 0, rng.choice([1, 5, 10, 11, 15, 30, 60])
        if roll < 0.85:
            return 1, 0
        return rng.randint(2, 5), 0
    interval = max(1, (card.due - card.last_review).days)
    if roll < 0.15 and can_stay:
        return 0, rng.choice([5, 30, 120])
    if roll < 0.45:
        return interval, 0
    if roll < 0.65:
        return max(1, interval - rng.randint(1, max(1, interval // 3))), 0
    if roll < 0.90:
        return interval + rng.randint(1, max(1, interval)), 0
    return rng.randint(1, 3), 0


def generate(sequences: int, seed: int) -> dict:
    rng = random.Random(seed)
    names = list(CONFIGS)
    out = []
    for index in range(sequences):
        name = names[index % len(names)]
        cfg = CONFIGS[name]
        scheduler = Scheduler(**cfg, enable_fuzzing=False)
        card = Card(card_id=index + 1, due=BASE)
        t = BASE
        minutes_used = 0
        length = rng.randint(3, 12)
        steps_out = []
        for k in range(length):
            if k > 0:
                days, minutes = next_delta(rng, card, minutes_used)
                # A day step keeps the wall-clock time, so both libraries count it alike.
                t = t + timedelta(days=days, minutes=minutes)
                minutes_used += minutes
            rating = rng.choices(list(RATING_WEIGHTS), weights=list(RATING_WEIGHTS.values()))[0]
            before = snapshot(card)
            retrievability = scheduler.get_card_retrievability(card, t)
            elapsed = (t - card.last_review).days if card.last_review else 0
            card, _log = scheduler.review_card(card, rating, review_datetime=t)
            due_offset = card.due - t
            steps_out.append({
                "review": iso(t),
                "rating": int(rating),
                "elapsedDays": elapsed,
                "retrievabilityBefore": retrievability,
                "before": before,
                "after": {
                    **snapshot(card),
                    "dueOffsetMs": int(due_offset.total_seconds() * 1000),
                    "intervalDays": due_offset.days if card.state == State.Review else None,
                },
            })
            # ts-fsrs clamps stability at 36,500 days and py-fsrs does not: stop before
            # the two could part ways (needs ~8 consecutive Easy reviews).
            if card.stability is not None and card.stability > 30000:
                break
        out.append({"id": f"{name}-{index + 1:03d}", "config": name, "steps": steps_out})

    configs = {
        name: {
            "w": cfg["parameters"],
            "desiredRetention": cfg["desired_retention"],
            "maxIntervalDays": cfg["maximum_interval"],
            "learningSteps": [step_unit(s) for s in cfg["learning_steps"]],
            "relearningSteps": [step_unit(s) for s in cfg["relearning_steps"]],
        }
        for name, cfg in CONFIGS.items()
    }
    return {
        "generator": {
            "script": "tooling/fsrs-fixtures/gen.py",
            "pyFsrs": importlib.metadata.version("fsrs"),
            "python": sys.version.split()[0],
            "seed": seed,
            "sequences": sequences,
            "fuzz": False,
        },
        "configs": configs,
        "sequences": out,
    }


def render(fixture: dict) -> str:
    """Pretty at the top, one line per step: readable diffs without a 40,000-line file."""
    indent = lambda text, n: text.replace("\n", "\n" + " " * n)  # noqa: E731
    lines = ["{"]
    lines.append('  "generator": ' + indent(json.dumps(fixture["generator"], indent=2), 2) + ",")
    lines.append('  "configs": ' + indent(json.dumps(fixture["configs"], indent=2), 2) + ",")
    lines.append('  "sequences": [')
    sequences = fixture["sequences"]
    for i, seq in enumerate(sequences):
        lines.append("    {")
        lines.append(f'      "id": {json.dumps(seq["id"])},')
        lines.append(f'      "config": {json.dumps(seq["config"])},')
        lines.append('      "steps": [')
        for j, step in enumerate(seq["steps"]):
            comma = "," if j < len(seq["steps"]) - 1 else ""
            lines.append("        " + json.dumps(step, separators=(",", ":")) + comma)
        lines.append("      ]")
        lines.append("    }" + ("," if i < len(sequences) - 1 else ""))
    lines.append("  ]")
    lines.append("}")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--sequences", type=int, default=200)
    parser.add_argument("--seed", type=int, default=20260903)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[2]
        / "packages/core/test/fixtures/fsrs/py-fsrs.json",
    )
    args = parser.parse_args()
    fixture = generate(args.sequences, args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render(fixture), encoding="utf-8")
    steps = sum(len(seq["steps"]) for seq in fixture["sequences"])
    print(f"wrote {args.out} ({len(fixture['sequences'])} sequences, {steps} reviews, py-fsrs {fixture['generator']['pyFsrs']})")


if __name__ == "__main__":
    main()
