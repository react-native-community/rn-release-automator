# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`rn-release-automator` — a Node.js CLI that automates the React Native release process. It guides release crew members through branch cuts, cherry-picks, publishing, testing, and announcements with interactive prompts. Uses Flow for type checking.

## Build & Run

```bash
# Build (strips Flow types from src/ into dist/)
npm run build

# Run after building
node dist/index.js              # interactive menu
node dist/index.js <command>    # specific command

# Build + run in one step
npm run dev

# Global dry-run (skips mutations, runs read-only checks)
node dist/index.js --dry-run
```

There is no test suite. All commands support `--dry-run` for safe previewing.

## Commands

The CLI follows the React Native release lifecycle. Each command links to its corresponding guide at `reactwg/react-native-releases/docs/`.

| Command | Input | Purpose |
|---------|-------|---------|
| `init` | — | Validate environment (tools, tokens, repo access, bot merger list) |
| `status` | `--series` or none | Overview of all release series, or details for a specific one |
| `cut-branch` | `--series` | 13-step branch cut workflow (CI check, create branch, template, Discord, Hermes) |
| `create-github-project` | `--series` | Clone and configure a GitHub Project for a release |
| `prepare-release` | `--series` | Analyze picks, determine next version (RC/stable/patch), process picks via bot |
| `publish` | `--version` | CI/picks/npm checks, trigger `create-release.yml` workflow |
| `test-release` | `--version` | Verify repo/branch, clean env, prebuilds, test matrix commands |
| `verify-release` | `--series` | Interactive 8-step post-release verification (npm, template, Maven, changelog, etc.) |
| `post-promotion` | `--series` | Update support policy table, blog post, website version cut |
| `communicate` | `--version` | Generate announcement templates (status, discord, discord-short, github) |

## Architecture

The CLI has two entry modes: interactive (no args → searchable menu with Escape-to-go-back) and direct (`node dist/index.js publish --version 0.85.0`).

**Commands** (`src/commands/`) each export a Commander `Command` instance. Commands take either `--series <X.Y>` (series-scoped) or `--version <X.Y.Z-rc.N>` (version-specific).

**Utils** (`src/utils/`):
- `github.js` — Octokit client with auto-token discovery (`GITHUB_TOKEN` or `gh auth token`). Provides: workflow runs, branch/release CRUD, pick request listing with body parsing, commit status checks, PR details/comments, issue commenting/closing, unpublished commit detection.
- `ui.js` — chalk styling, ora spinners, @inquirer prompts (search/input/confirm). Has `setDryRun()` which adds a red `DRY RUN` badge to all prompts. Escape-to-cancel via `withEscapeCancel` wrapper.
- `version.js` — Parse/format RN versions, series comparison, next RC/patch/minor helpers. Versions >= 0.83 use dual-tag Hermes.
- `preflight.js` — Checks Node, npm, git, gh CLI, GitHub token, repo access to 4 repos.
- `npm-utils.js` — npm registry queries (versions, dist-tags, publication checks).
- `git.js` — Shell-exec git wrappers (branch, cherry-pick, push, etc.).

**Config** (`src/config.js`) — repo coordinates, workflow filenames, version patterns, release schedule dates.

**Docs** (`src/docs.js`) — URL mapping to `reactwg/react-native-releases` guides, shown via `ui.docRef()` at the top of each command.

## Key Design Decisions

- **Dry-run skips mutations only** — read-only checks (CI status, npm queries, pick analysis, branch checks) always run. Only mutations (workflow triggers, comments, branch creation, git push) are gated by `--dry-run`.
- **Global `--dry-run`** — detected from `process.argv` before routing, sets `ui._dryRunMode` which all commands check via `options.dryRun || ui._dryRunMode`.
- **Pick analysis** classifies each pick request into: `bot_merge`, `not_on_main`, `pr_against_branch`, `pr_merged_on_branch`, `hermes`, `multiple_targets`, `complex`, or `manual` — based on parsing the issue body for PR links, commit SHAs, Hermes URLs, and target branches.
- **Support tiers** derived from npm data: Future (RC-only), Active (top 2 stable), End of Cycle (3rd), Unsupported (rest).
- **Only `0.x` series allowed** — `cut-branch` rejects `major !== 0`.
- **Commander `--version` conflict** resolved by remapping to `--cli-version` / `-V`.

## Conventions

- All source files use `// @flow` annotations and `.js` extension.
- The interactive menu uses `@inquirer/prompts` `search` for type-to-filter behavior.
- `CancelPromptError` from `@inquirer/core` is caught in the menu loop to handle Escape → go back.
- Nightly versions are filtered out from all npm version listings.
- Each command shows a `📖` doc reference link after its header.
