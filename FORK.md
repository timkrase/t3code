# t2

This fork builds T3 Code as **t2**: its own app name, bundle id (`com.timkrase.t2`), `t2://`
scheme, and state in `~/.t2`, so it runs beside the official T3 Code apps without sharing their
state. It adds environment launchers (on-demand machines such as boat.dev sandboxes, started on
send, stopped once their threads settle, woken on the next message).

## Update

`scripts/t2-update.sh` merges the newest upstream nightly tag into `main`, typechecks, builds t2
with that nightly's version, installs it to `/Applications`, and pushes `main`. It works in its own
worktree (`../t3code-t2-update`), so a running dev app is left alone. On a merge conflict it stops;
resolve and commit in that worktree, then run it again. Nightly tags are merged rather than
`upstream/main` because each has a published release, whose server SSH environments install.

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

SSH environments install the published T3 server release whose version equals the app's, so build
with the newest upstream release tag in `main`'s history. Without Rust, reuse the resource monitor
from an installed official app.

```sh
mkdir -p native/resource-monitor/target/aarch64-apple-darwin/release
cp "/Applications/T3 Code (Nightly).app/Contents/Resources/resource-monitor/t3-resource-monitor" \
  native/resource-monitor/target/aarch64-apple-darwin/release/
PATH="$PWD/node_modules/.bin:$PATH" T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=true \
  node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 \
  --build-version "$(git describe --tags --abbrev=0 --match 'v[0-9]*' | sed 's/^v//')"
```

Build from a separate worktree: switching branches in the checkout a dev app runs from restarts it.
The dmg lands in `release/`. The build is unsigned and has no update feed, so after installing run
`xattr -dr com.apple.quarantine /Applications/t2.app` once.
