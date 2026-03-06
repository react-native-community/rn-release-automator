# ⚛️ rn-release-automator

A CLI tool that automates the [React Native](https://reactnative.dev/) release process — branch cuts, cherry-picks, publishing, testing, and announcements.

Built for the React Native Release Crew. Guides you step-by-step through every phase of a release with interactive prompts, pre-flight checks, and GitHub API integrations.

## Usage

```bash
npx rn-release-automator@latest
```

Pass `--dry-run` to play with the CLI without making any changes:

```bash
npx rn-release-automator@latest --dry-run
```

You can also invoke commands directly:

```bash
npx rn-release-automator@latest status
npx rn-release-automator@latest status --series 0.85
npx rn-release-automator@latest prepare-release --series 0.85
npx rn-release-automator@latest publish --version 0.85.0-rc.1
```

Use `--help` on any command to see available flags:

```bash
npx rn-release-automator@latest --help
npx rn-release-automator@latest cut-branch --help
```

## Commands

Commands follow the React Native release lifecycle. Each links to its corresponding guide in [reactwg/react-native-releases](https://github.com/reactwg/react-native-releases/tree/main/docs).

| Command | Description |
|---------|-------------|
| `init` | Validate environment — tools, tokens, repo access, bot merger list |
| `status` | Overview of all release series, or details for a specific one |
| `cut-branch` | Full branch cut workflow — CI check, create branch, template, Discord, Hermes |
| `create-github-project` | Clone and configure a GitHub Project for tracking a release |
| `prepare-release` | Analyze pick requests, determine next version, process picks via bot |
| `publish` | Pre-flight checks, trigger `create-release.yml` workflow, monitor |
| `test-release` | Verify repo/branch, clean env, download prebuilds, test matrix |
| `verify-release` | Interactive 8-step post-release verification (npm, template, Maven, etc.) |
| `post-promotion` | Update support policy, ship blog post, cut new website version |
| `communicate` | Generate announcement templates (Discord, GitHub, status tracker) |

## Release Workflow

A typical release follows these steps:

```
1. init              → verify your environment is set up
2. cut-branch        → create the stable branch (RC0 only)
3. create-github-project → set up the release tracking project
4. prepare-release   → cherry-pick fixes, analyze pending picks
5. publish           → trigger the create-release workflow
6. test-release      → run through the test matrix
7. verify-release    → verify npm, Maven, template, changelog
8. post-promotion    → update website, blog, support policy
9. communicate       → generate and post announcements
```

For patch releases, skip steps 2-3 and start at `prepare-release`.

## Prerequisites

- **Node.js** >= 18
- **GitHub CLI** (`gh`) authenticated — `gh auth login`
- **Git** with push access to `facebook/react-native`
- For project management: `gh auth refresh -s project` (adds the `project` scope)

The `init` command checks all of these for you.

## Features

### Smart Pick Analysis

`prepare-release` analyzes each pending [pick request](https://github.com/reactwg/react-native-releases/issues) and classifies it:

- 🟢 **Bot merge** — commit is on main, can use `@react-native-bot merge`
- 🟡 **Not on main** — commit hasn't landed on main yet
- 🔵 **PR on branch** — PR targets the stable branch directly
- 🟢 **Already merged** — PR is merged but pick request is still open
- 🔴 **Hermes** — involves `facebook/hermes`, needs a Hermes release
- 🔴 **Multi-target** — targets multiple branches, needs duplication
- 🔴 **Complex** — multiple PRs/commits, needs manual review

### Support Tiers

`status` shows versions grouped by [support tier](https://reactnative.dev/docs/next/releases):

- **Future** — scheduled versions and active RCs
- **Active** — latest 2 stable series
- **End of Cycle** — 3rd latest stable series
- **Unsupported** — everything older

### Dry Run

`--dry-run` skips all mutations (workflow triggers, comments, branch creation, git push) but still runs read-only checks (CI status, npm queries, pick analysis). Every prompt shows a red `DRY RUN` badge.

## Configuration

The CLI auto-discovers your GitHub token from:

1. `GITHUB_TOKEN` environment variable
2. `gh auth token` (GitHub CLI)

No configuration files needed.

## Repositories

The CLI interacts with these repositories:

- [facebook/react-native](https://github.com/facebook/react-native) — branches, workflows, releases
- [facebook/hermes](https://github.com/facebook/hermes) — Hermes release coordination
- [react-native-community/template](https://github.com/react-native-community/template) — template branch creation
- [reactwg/react-native-releases](https://github.com/reactwg/react-native-releases) — pick requests, release guides, GitHub Projects

## Development

```bash
git clone https://github.com/cortinico/rn-cli.git
cd rn-cli
npm install
npm run build    # strip Flow types → dist/
npm start        # run the CLI
npm run dev      # build + run in one step
```

The project uses [Flow](https://flow.org/) for type checking:

```bash
npm run flow
```

## License

MIT
