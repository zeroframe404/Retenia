# Sound asset licenses

| File | Source | License |
|---|---|---|
| `correct.wav` | Self-authored placeholder (pure sine-wave synthesis, no third-party sample) | CC0-1.0 |
| `wrong.wav` | Self-authored placeholder (pure sine-wave synthesis, no third-party sample) | CC0-1.0 |
| `levelUp.wav` | Self-authored placeholder (pure sine-wave synthesis, no third-party sample) | CC0-1.0 |
| `streak.wav` | Self-authored placeholder (pure sine-wave synthesis, no third-party sample) | CC0-1.0 |
| `click.wav` | Self-authored placeholder (pure sine-wave synthesis, no third-party sample) | CC0-1.0 |

These are short, programmatically generated tones (sine waves with a simple attack/release
envelope) authored for this repository — they contain no third-party recordings or samples, so
there is nothing to attribute. To the extent copyright applies at all, they are dedicated to the
public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/); use, modify,
and redistribute them freely.

They exist to unblock `SoundKit` development and Storybook/tests with real, tiny audio files
that pass `pnpm licenses:check` without ambiguity. Swap them for a proper CC0 sound pack (e.g.
[Kenney's UI Audio](https://kenney.nl/assets/ui-audio) or
[Interface Sounds](https://kenney.nl/assets/interface-sounds), both CC0) before shipping a
polished build — keep the filenames (`correct`, `wrong`, `levelUp`, `streak`, `click`) and this
table in sync with whatever replaces them.
