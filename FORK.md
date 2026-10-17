# t2

This fork builds T3 Code as **t2**: its own app name, bundle id (`com.timkrase.t2`), `t2://`
scheme, and state in `~/.t2`, so it runs beside the official T3 Code apps without sharing their
state.

## What t2 adds

Changes that live only in this fork. `git log --no-merges main ^upstream/main` shows the full
history.

- **Environment launchers** for remote dev on on-demand machines, such as boat.dev sandboxes. A
  launcher command creates the machine and prints its SSH host and checkout. The machine starts
  when you send, stops once its threads settle, and wakes on the next message or from the offline
  banner of its thread. User guide:
  `docs/user/remote-access.md`. Code: `apps/desktop/src/ssh/environmentLauncher.ts`,
  `apps/web/src/state/launchedEnvironments.ts`, `apps/web/src/hooks/useEnvironmentLauncher.ts`,
  `apps/web/src/components/settings/EnvironmentLaunchersSettings.tsx`.
- **Machine-aware workspace picking.** Picking a machine under Run on also picks the workspace that
  fits it. New threads started from a launched machine open on this computer.
- **Project pages** in the thread details panel list the pages a checkout serves
  (`packages/contracts/src/projectPages.ts`).
- **t2 branding and release.** Its own app identity (below), `scripts/t2-update.sh`, and its own
  server release for SSH environments.
- **Fixes that are not upstream yet:** Claude picks up a renewed token from the login shell,
  projects in partial clones keep their repository, and a timed-out session refresh keeps the last
  grant.

Fork code inside upstream components must keep them compilable by React Compiler: upstream's
`ChatView` relies on it to settle its render, and the compiler skips a component containing
`try`/`finally`. Use promise handlers there instead.

## Update

`scripts/t2-update.sh` merges the newest upstream nightly tag into `main`, typechecks, builds t2,
pushes `main`, publishes the server for SSH environments (below), and installs t2 to
`/Applications`. It works in its own worktree (`../t3code-t2-update`), so a running dev app is left
alone. On a merge conflict it stops; resolve and commit in that worktree, then run it again. Run it
after merging fork changes too: a new commit gets a new build even on the same nightly.

## Server for SSH environments

SSH environments install the server release whose version equals the app's. t2 is versioned
`<upstream nightly>.t2-<commit>`, and pushing the tag `v<version>` runs
`.github/workflows/t2-server.yml`, which builds the Linux server archives and publishes them as that
tag's release here. t2 downloads versions containing `.t2-` from this repository's releases
(`apps/desktop/src/main.ts`) and any other version from upstream. The commit in the version keeps
each build in its own runtime directory on the host, so a host that already has upstream's server
for the same nightly still installs t2's.

## Branches

- `main` is upstream T3 Code plus this fork's changes. Work on short branches off `main` and
  merge them back.
- `upstream` is `pingdotgg/t3code`. Pull it in with a merge, not a rebase, since `main` is
  published:

  ```sh
  git fetch upstream && git merge upstream/main
  ```

- To propose a fix upstream, branch from `upstream/main` and cherry-pick it, so the t2 rename
  stays out of the PR.

## Develop

`vp run dev:desktop` runs **t2 (Dev)** with state in `~/.t2/dev`.

## Build and install

Build with a t2 version whose server is published (see above). Without Rust, reuse the resource
monitor from an installed official app.

```sh
mkdir -p native/resource-monitor/target/aarch64-apple-darwin/release
cp "/Applications/T3 Code (Nightly).app/Contents/Resources/resource-monitor/t3-resource-monitor" \
  native/resource-monitor/target/aarch64-apple-darwin/release/
PATH="$PWD/node_modules/.bin:$PATH" T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=true \
  node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 \
  --build-version "$(git describe --tags --abbrev=0 --match 'v*.t2-*' | sed 's/^v//')"
```

Build from a separate worktree: switching branches in the checkout a dev app runs from restarts it.
The dmg lands in `release/`. The build is unsigned and has no update feed, so after installing run
`xattr -dr com.apple.quarantine /Applications/t2.app` once.
