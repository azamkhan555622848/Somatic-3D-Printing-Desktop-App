# Releasing Somatic

Four installers, two machines' worth of toolchain, one gotcha each. Artifacts
land in `opencode-dev/packages/desktop/dist/` and are ignored by git — attach
them to a GitHub release rather than committing them.

| Artifact | Platform |
|---|---|
| `somatic-win-x64.exe` | Windows, NSIS installer |
| `somatic-linux-x86_64.AppImage` | Linux, portable |
| `somatic-linux-amd64.deb` | Debian and Ubuntu |
| `somatic-linux-x86_64.rpm` | Fedora and RHEL |

## Windows

Build from the repository as-is:

```powershell
cd opencode-dev\packages\desktop
bun run build
bun run package:win
```

## Linux

Linux native modules (`node-pty`, `@parcel/watcher`) and the `opencode-cli`
sidecar are per-platform, and none of them install on Windows. So a Linux build
has to run on Linux; WSL is enough.

```bash
wsl -d Ubuntu
apt-get update && apt-get install -y curl unzip git fakeroot dpkg rpm
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
```

Copy the source into the WSL filesystem rather than building over `/mnt/c`,
which is slow and mixes Windows-built `node_modules` into a Linux build:

```bash
mkdir -p ~/build && cd /mnt/c/Users/<you>/Documents/3D-Coder
tar cf - --exclude=node_modules --exclude=dist --exclude=out --exclude=.git \
         --exclude=opencode-cli.exe opencode-dev | (cd ~/build && tar xf -)
cd ~/build/opencode-dev && bun install
```

Then build. **`OPENCODE_CHANNEL` must be set**: a build script reads the
channel from the current git branch, and the copy above has no `.git`.

```bash
export OPENCODE_CHANNEL=dev
cd packages/desktop
bun run build
bun run package:linux
```

Confirm the Linux sidecar shipped, not the Windows one:

```bash
ls -l dist/linux-unpacked/resources/opencode-cli   # ELF, ~225 MB, no .exe
```

## macOS

Not built. It needs a Mac: `bun run package:mac` produces the dmg and zip, and
the config already carries the entitlements and a `codesign` step.

## Which channel to ship

**Only the `dev` channel produces a package that runs.** `prebuild.ts`
downloads the `opencode-cli` sidecar for `dev` alone, and `electron-builder`
bundles it into `extraResources` for `dev` alone, while `startBackgroundCli`
always looks for it under `process.resourcesPath` with no fallback. A `beta` or
`prod` build therefore starts, fails to find the sidecar, and dies.

The cost is cosmetic: the dev channel is named "Somatic Dev" and installs under
the app id `ai.opencode.desktop.dev`. Shipping `prod` instead would mean
bundling the sidecar for every channel, and would move the app id — which is
what keys `userData`, so existing sessions and settings would be orphaned.

## The easy way: GitHub Actions

`.github/workflows/release.yml` builds all four installers on GitHub's own
runners — Windows, Linux, and macOS for both Apple Silicon and Intel — and
attaches them to a pre-release. The repository is public, so the macOS runners
cost nothing.

```bash
git tag v0.1.0-alpha
git push origin v0.1.0-alpha
```

Run the workflow by hand (Actions → Release → Run workflow) to build without
publishing; the artifacts appear on the run page.

The macOS builds are unsigned unless `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`
and `APPLE_TEAM_ID` are set as repository secrets, which needs an Apple
Developer account. Unsigned, a tester opens the app the first time with
right-click → Open, or `xattr -dr com.apple.quarantine Somatic\ Dev.app`.
