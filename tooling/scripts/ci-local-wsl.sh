#!/usr/bin/env bash
# The `ubuntu-latest` leg of .github/workflows/ci.yml, run inside WSL.
#
# Started by `pnpm ci:local --wsl` (tooling/scripts/ci-local.mjs), which first snapshots the Windows
# working tree — tracked and untracked files alike, ignored ones excluded — into the ref
# `refs/ci-local/snapshot` and then runs this script through `wsl.exe` with
#   $1     the Windows checkout as a WSL path (/mnt/c/…)
#   $2…    options forwarded to ci-local.mjs (e.g. --only lint)
#
# Everything lives under ~/.cache and needs no sudo:
#   ~/.cache/retenia-ci-local-tools/node   Node (the major from .nvmrc, latest patch, from nodejs.org,
#                                          SHA-256 verified) plus pnpm at the `packageManager` version
#   ~/.cache/retenia-ci-local              a mirror clone of the repo in the WSL filesystem
# A separate clone, not /mnt/c: node_modules holds per-OS native binaries (the Windows tree already
# has win32 ones), and DrvFs is far too slow for pnpm and vitest. On Linux ci-local.mjs skips the
# windows-latest-only jobs (e2e, build-desktop) by itself, so what runs here is exactly the
# ubuntu-latest matrix leg: install → licenses → i18n → contrast → lint → typecheck → schema → test →
# coverage.
set -euo pipefail

source_repo="${1:?usage: ci-local-wsl.sh <repo as /mnt/… path> [ci-local options]}"
shift
mirror="${CI_LOCAL_WSL_DIR:-$HOME/.cache/retenia-ci-local}"
tools="${CI_LOCAL_WSL_TOOLS:-$HOME/.cache/retenia-ci-local-tools}"
snapshot_ref="refs/ci-local/snapshot"

say() { echo "ci-local/wsl: $*" >&2; }
die() { say "$*"; exit 1; }

[ -f "$source_repo/.nvmrc" ] || die "$source_repo does not look like the Retenia checkout (.nvmrc missing)"
for tool in curl tar sha256sum git; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is missing in this WSL distro (apt install $tool)"
done

# ── 1. Node: the major from .nvmrc, latest patch — what actions/setup-node resolves "24" to. ────────
want_major="$(tr -d 'v[:space:]' < "$source_repo/.nvmrc" | cut -d. -f1)"
case "$(uname -m)" in
  x86_64) node_arch=x64 ;;
  aarch64) node_arch=arm64 ;;
  *) die "unsupported architecture $(uname -m)" ;;
esac
have_node="$("$tools/node/bin/node" -v 2>/dev/null || true)"
if [ "${have_node#v}" = "$have_node" ] || [ "$(printf '%s' "${have_node#v}" | cut -d. -f1)" != "$want_major" ]; then
  say "installing Node $want_major (latest patch) under $tools/node"
  dist="https://nodejs.org/dist/latest-v${want_major}.x"
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  curl -fsSL "$dist/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
  tarball="$(grep -o "node-v[0-9.]*-linux-${node_arch}\.tar\.gz" "$work/SHASUMS256.txt" | head -1)"
  [ -n "$tarball" ] || die "no linux-$node_arch build listed at $dist"
  curl -fsSL "$dist/$tarball" -o "$work/$tarball"
  (cd "$work" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c --quiet -) || die "SHA-256 mismatch for $tarball"
  mkdir -p "$tools/node.new"
  tar -xzf "$work/$tarball" -C "$tools/node.new" --strip-components=1
  rm -rf "$tools/node"
  mv "$tools/node.new" "$tools/node"
fi
export PATH="$tools/node/bin:$PATH"
say "node $(node -v)"

# ── 2. pnpm at the version package.json pins (what corepack gives CI). ─────────────────────────────
want_pnpm="$(grep -o '"packageManager": *"pnpm@[^"]*"' "$source_repo/package.json" | sed 's/.*pnpm@//; s/"//')"
[ -n "$want_pnpm" ] || die "package.json has no packageManager pnpm@… pin"
if [ "$(pnpm -v 2>/dev/null || true)" != "$want_pnpm" ]; then
  say "installing pnpm $want_pnpm"
  npm install -g --silent "pnpm@$want_pnpm"
fi
say "pnpm $(pnpm -v)"

# ── 3. Mirror clone in the WSL filesystem, checked out at the snapshot of the Windows tree. ────────
# The Windows checkout on DrvFs is owned by another uid from WSL's point of view; git would refuse it
# as "dubious ownership" without safe.directory.
git_src() { git -c "safe.directory=$source_repo" "$@"; }
if [ ! -d "$mirror/.git" ]; then
  say "cloning into $mirror (once)"
  mkdir -p "$(dirname "$mirror")"
  git_src clone --quiet --no-checkout "$source_repo" "$mirror"
fi
cd "$mirror"
git_src fetch --quiet --no-tags "$source_repo" "$snapshot_ref" \
  || die "could not fetch $snapshot_ref from $source_repo — run this through 'pnpm ci:local --wsl', which creates it"
git checkout --quiet --force --detach FETCH_HEAD
# Untracked leftovers from an earlier snapshot go; ignored files (node_modules, .turbo, coverage) stay.
git clean --quiet -fd
say "mirror at $(git rev-parse --short HEAD) ($(git log -1 --format=%s))"

# ── 4. The ubuntu-latest leg. ──────────────────────────────────────────────────────────────────────
exec node tooling/scripts/ci-local.mjs "$@"
