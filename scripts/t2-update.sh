#!/usr/bin/env bash
# Merge the newest upstream nightly into this fork's main, build t2 from it,
# push main, publish its server for SSH environments, and install it to
# /Applications. See FORK.md.
#
# It works in its own worktree (T2_WORKTREE, default ../t3code-t2-update), so a
# dev app running from the main checkout is never restarted under you. After a
# merge conflict it stops; resolve and commit in that worktree, then run it
# again to continue from the resolved merge.
#
#   scripts/t2-update.sh             merge, build, push, publish, install
#   scripts/t2-update.sh --no-install
set -euo pipefail

install=1
[ "${1:-}" = "--no-install" ] && install=0

repo=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
worktree=${T2_WORKTREE:-$(dirname "$repo")/t3code-t2-update}
fork=timkrase/t3code
git_push() { git -c credential.helper= -c credential.helper='!gh auth git-credential' push "$@"; }

cd "$repo"
git fetch -q origin main
git fetch -q upstream --tags
nightly=$(git for-each-ref --sort=-creatordate --count=1 --format='%(refname:short)' 'refs/tags/v*-nightly.*')

if [ -d "$worktree" ]; then
  if [ -e "$(git -C "$worktree" rev-parse --git-dir)/MERGE_HEAD" ]; then
    echo "A merge is still unresolved in $worktree; finish it and commit, then run this again." >&2
    exit 1
  fi
  # Keep a resolved merge from an earlier run; otherwise start over from main.
  if ! { git -C "$worktree" merge-base --is-ancestor "$nightly" HEAD &&
    git -C "$worktree" merge-base --is-ancestor origin/main HEAD; }; then
    git -C "$worktree" checkout -q -B t2-update origin/main
  fi
else
  git worktree add -q -B t2-update "$worktree" origin/main
fi

cd "$worktree"
if git merge-base --is-ancestor "$nightly" HEAD; then
  echo "main already has $nightly; building it."
elif ! git merge --no-edit -m "Merge upstream nightly $nightly" "$nightly"; then
  echo "Merging $nightly conflicts. Resolve the files above in $worktree, commit, and run this again." >&2
  exit 1
fi

# The commit in the version gives every build its own server release and its
# own runtime directory on SSH hosts.
version="${nightly#v}.t2-$(git rev-parse --short=7 HEAD)"
tag="v$version"

echo "Installing dependencies and typechecking..."
"$repo/node_modules/.bin/vp" i >/dev/null
(cd apps/web && ../../node_modules/.bin/tsc --noEmit -p .)
(cd apps/desktop && ../../node_modules/.bin/tsc --noEmit -p .)

# The build compiles a small Rust resource monitor; without cargo, reuse the
# one an installed app ships.
reuse_monitor=false
if ! command -v cargo >/dev/null; then
  monitor_dir=native/resource-monitor/target/aarch64-apple-darwin/release
  for app in /Applications/t2.app "/Applications/T3 Code (Nightly).app"; do
    if [ -x "$app/Contents/Resources/resource-monitor/t3-resource-monitor" ]; then
      mkdir -p "$monitor_dir"
      cp "$app/Contents/Resources/resource-monitor/t3-resource-monitor" "$monitor_dir/"
      reuse_monitor=true
      break
    fi
  done
fi

echo "Building t2 $version..."
PATH="$worktree/node_modules/.bin:$PATH" T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=$reuse_monitor \
  node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 \
  --build-version "$version" >"$worktree/release-build.log" 2>&1 ||
  { echo "Build failed; see $worktree/release-build.log" >&2; exit 1; }
zip="$worktree/release/t2-$version-arm64.zip"

git_push -q origin HEAD:main
echo "Pushed main with $nightly."

# The tag starts .github/workflows/t2-server.yml, which publishes the server
# archives this build's SSH environments download. Wait for it before
# installing: until then the new app cannot start a server on an SSH host.
if gh release view "$tag" -R "$fork" >/dev/null 2>&1; then
  echo "The t2 server $version is already published."
else
  git tag -f "$tag" HEAD >/dev/null
  git_push -q origin "refs/tags/$tag"
  echo "Publishing the t2 server $version (about 15 minutes)..."
  run_id=""
  for _ in $(seq 1 30); do
    run_id=$(gh run list -R "$fork" --workflow t2-server.yml --branch "$tag" --limit 1 \
      --json databaseId -q '.[0].databaseId')
    [ -n "$run_id" ] && break
    sleep 2
  done
  [ -n "$run_id" ] || { echo "No t2 server run started for $tag." >&2; exit 1; }
  gh run watch "$run_id" -R "$fork" --exit-status --interval 30 >/dev/null ||
    { echo "Publishing failed: https://github.com/$fork/actions/runs/$run_id" >&2; exit 1; }
  echo "Published https://github.com/$fork/releases/tag/$tag"
fi

if [ "$install" = 1 ]; then
  while [ "$(osascript -e 'application id "com.timkrase.t2" is running' 2>/dev/null)" = "true" ]; do
    read -r -p "Quit t2, then press Enter to install $version. " _
  done
  unpacked=$(mktemp -d)
  ditto -x -k "$zip" "$unpacked"
  rm -rf /Applications/t2.app
  mv "$unpacked/t2.app" /Applications/t2.app
  rm -rf "$unpacked"
  xattr -dr com.apple.quarantine /Applications/t2.app 2>/dev/null || true
  echo "Installed /Applications/t2.app $version."
fi

echo "Pull main into $repo when your dev app is stopped:"
echo "  git -C $repo pull --ff-only && $repo/node_modules/.bin/vp i"
