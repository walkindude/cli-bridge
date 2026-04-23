# Pre-public history scrub plan — cli-bridge

**Status:** DRAFT. Do not execute without reading end-to-end and taking a backup.
This file itself should be deleted (or gitignored) before going public.

## Finding

Commits `dd1cea5`, `c5130ad`, and `d64132e` contain hardcoded `/Users/steve/src/cli-bridge`
paths in `tests/integration/server.test.ts` (lines 394 and 403). The working tree is
already fixed on the current branch, but the strings survive in git history.

gosymdb history is clean — no rewrite needed there.

## Options

### Option A — do nothing

The paths are in a test file that runs happily on any machine (the test skips when
`dist/server.js` isn't present). They're mildly unprofessional to have in public
history, not a security or privacy leak. Many open-source projects have worse stuff
in early commits.

**When to pick this:** you want to ship fast and don't mind the cosmetic blemish.

### Option B — interactive rebase (recommended if you scrub)

Rewrite the three commits so the paths are gone from their blobs. Linear history,
only affected commits change SHA. Force-push required (safe — repo is private, no
collaborators).

#### Step 1. Safety net (REQUIRED)

```bash
cd ~/src/cli-bridge
git branch backup-before-scrub   # keeps old SHAs reachable locally
git tag backup-before-scrub      # belt + suspenders
```

#### Step 2. Confirm what you're about to change

```bash
git log --all --oneline -- tests/integration/server.test.ts
git log -p dd1cea5 -- tests/integration/server.test.ts | head -40
```

#### Step 3. Rebase

```bash
git rebase -i dd1cea5^
```

In the editor that opens, change the action for the three affected commits
(`dd1cea5`, `c5130ad`, `d64132e`) from `pick` to `edit`:

```
edit dd1cea5 Add MCP instructions, esbuild bundle, strict lint, marketplace, release CI
edit c5130ad chore: update dependencies
edit d64132e fix: security hardening for npm publish readiness
pick  03f7fe9 docs: rewrite README intro to explain the problem clearly
```

At each `edit` stop, fix the file:

```bash
# Replace absolute paths with relative resolution (same fix already in HEAD).
# You can copy the current HEAD version in directly:
git checkout HEAD@{0} -- tests/integration/server.test.ts 2>/dev/null || \
  git show master:tests/integration/server.test.ts > tests/integration/server.test.ts

git add tests/integration/server.test.ts
git commit --amend --no-edit
git rebase --continue
```

If the third stop auto-resolves (commit already matches HEAD), just
`git rebase --skip` or `--continue` as appropriate.

#### Step 4. Verify

```bash
# No occurrences of /Users/steve/ in history:
git log --all -p | grep -c "/Users/steve/" || echo "clean"

# Working tree still fine:
pnpm test
```

#### Step 5. Force-push

```bash
# Sanity-check remote config first:
git remote -v
git log --oneline HEAD..origin/master  # should be empty or obvious

# Force-push — only run when you're ready. Never run --force on main/master
# of a repo with collaborators without coordinating.
git push --force-with-lease origin master
```

`--force-with-lease` is safer than `--force`: fails if someone else has pushed
in the meantime. On a private single-maintainer repo this is effectively `--force`
with a safety belt.

#### Step 6. Cleanup

```bash
# If everything looks good:
git branch -D backup-before-scrub
git tag -d backup-before-scrub

# Delete this plan file:
rm HISTORY-SCRUB-PLAN.md
```

### Option C — git filter-repo (if you add more files to scrub later)

Install: `brew install git-filter-repo` (or see upstream docs).

```bash
git filter-repo --path-glob 'tests/integration/server.test.ts' --replace-text <(cat <<'EOF'
/Users/steve/src/cli-bridge==>__REPO_ROOT__
EOF
)
```

filter-repo rewrites every commit touching that path, replacing the matched
strings. Full verification step same as Option B step 4.

## Do NOT do these

- `git filter-branch` — deprecated, slow, historically buggy. Use filter-repo.
- `--no-verify` on any commits made during the rebase — there's no reason to
  skip hooks for this fix.
- Force-push without first creating the backup branch/tag.
- Run any of this on a public repo after open-sourcing — git object SHAs will
  break links, forks, and anyone who cloned. Scrub BEFORE going public, not after.
