// @flow

// `prepare-release` command — cherry-pick + CI monitoring

import { Command } from "commander";
import chalk from "chalk";
import { ui } from "../utils/ui.js";
import {
  parseVersion,
  formatVersion,
  stableBranch,
  nextRC,
  nextPatch,
} from "../utils/version.js";
import {
  getBranch,
  listWorkflowRuns,
  listPickRequests,
  getCommitStatus,
  getPRDetails,
  getPRComments,
  createIssueComment,
  closeIssue,
  getUnpublishedCommits,
} from "../utils/github.js";
import type { PickRequest } from "../utils/github.js";
import { getPublishedVersions } from "../utils/npm-utils.js";
import { WORKFLOWS } from "../config.js";
import { DOCS } from "../docs.js";

const SERIES_PATTERN = /^(\d+)\.(\d+)$/;

function parseSeries(series: string): {major: number, minor: number} | null {
  const match = series.match(SERIES_PATTERN);
  if (!match) return null;
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
}

type AnalyzedPick = {
  pick: PickRequest,
  type: "bot_merge" | "not_on_main" | "manual" | "pr_against_branch" | "pr_merged_on_branch" | "multiple_targets" | "complex" | "hermes",
  sha: string | null,
  prNumber: number | null,
  ciStatus: string | null,
  reason: string | null,
  targetBranches: Array<string> | null,
};

function parsePickBody(body: string): {
  targetBranches: Array<string>,
  prLinks: Array<number>,
  commitShas: Array<string>,
  hasHermesLinks: boolean,
} {
  // Extract target branches
  const targetSection = body.match(/### Target Branch[\s\S]*?(?=###|$)/)?.[0] ?? "";
  const targetBranches = targetSection.match(/\d+\.\d+/g) ?? [];

  // Extract links section
  const linksSection = body.match(/### Link to commit or PR[\s\S]*?(?=###|$)/)?.[0] ?? "";

  // Check for Hermes links
  const hasHermesLinks = /github\.com\/facebook\/hermes\//.test(linksSection);

  // Extract PR numbers (react-native only)
  const prMatches = linksSection.match(
    /https:\/\/github\.com\/react\/react-native\/pull\/(\d+)/g,
  ) ?? [];
  const prLinks = prMatches.map((url) => {
    const m = url.match(/\/pull\/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }).filter(Boolean);

  // Extract commit SHAs from URLs and bare SHAs
  const commitUrlMatches = linksSection.match(
    /https:\/\/github\.com\/react\/react-native\/commit\/([a-f0-9]{7,40})/g,
  ) ?? [];
  const commitShas = commitUrlMatches.map((url) => {
    const m = url.match(/\/commit\/([a-f0-9]{7,40})/);
    return m ? m[1] : "";
  }).filter(Boolean);

  return { targetBranches, prLinks, commitShas, hasHermesLinks };
}

async function analyzePick(
  pick: PickRequest,
  branch: string,
): Promise<AnalyzedPick> {
  const { targetBranches, prLinks, commitShas, hasHermesLinks } = parsePickBody(pick.body);

  // Check for Hermes links — requires a Hermes release, manual handling
  if (hasHermesLinks) {
    return {
      pick, type: "hermes", sha: null, prNumber: null,
      ciStatus: null, targetBranches: null,
      reason: "Involves facebook/hermes. Requires a Hermes release — manual handling needed.",
    };
  }

  // Check for multiple target branches
  if (targetBranches.length > 1) {
    return {
      pick, type: "multiple_targets", sha: null, prNumber: null,
      ciStatus: null, targetBranches,
      reason: `Targets branches: ${targetBranches.join(", ")}. Needs separate pick requests.`,
    };
  }

  const totalLinks = prLinks.length + commitShas.length;

  // Check for multiple PRs/commits
  if (totalLinks > 1) {
    return {
      pick, type: "complex", sha: null, prNumber: null,
      ciStatus: null, targetBranches: null,
      reason: `Contains ${prLinks.length} PR(s) and ${commitShas.length} commit(s). Requires manual review.`,
    };
  }

  // Single commit SHA
  if (commitShas.length === 1 && prLinks.length === 0) {
    const sha = commitShas[0];
    const status = await getCommitStatus(sha, "main");
    if (status === "on_branch") {
      return {
        pick, type: "bot_merge", sha, prNumber: null,
        ciStatus: null, targetBranches: null,
        reason: "Commit is on main. Can use bot to merge.",
      };
    }
    return {
      pick, type: "not_on_main", sha, prNumber: null,
      ciStatus: null, targetBranches: null,
      reason: "Commit is not on main yet. Requires manual cherry-pick.",
    };
  }

  // Single PR link
  if (prLinks.length === 1 && commitShas.length === 0) {
    const prNum = prLinks[0];
    try {
      const pr = await getPRDetails(prNum);

      // PR against the release branch
      if (pr.base?.ref === branch) {
        if (pr.state === "closed" && pr.merged) {
          // PR is merged on the branch but pick request is still open
          return {
            pick, type: "pr_merged_on_branch", sha: pr.merge_commit_sha, prNumber: prNum,
            ciStatus: null, targetBranches: null,
            reason: `PR #${prNum} is already merged into ${branch}. Pick request can be closed.`,
          };
        }
        const ciStatus = pr.mergeable_state ?? "unknown";
        return {
          pick, type: "pr_against_branch", sha: null, prNumber: prNum,
          ciStatus, targetBranches: null,
          reason: `PR #${prNum} targets ${branch}. Merge manually on GitHub.`,
        };
      }

      // PR is merged — find the merge SHA
      if (pr.state === "closed") {
        // Check comments for merge SHA
        const comments = await getPRComments(prNum);
        for (const c of comments) {
          const mergeMatch = c.body?.match(
            /merged.*?\b([a-f0-9]{40})\b/i,
          );
          if (mergeMatch) {
            const sha = mergeMatch[1];
            const status = await getCommitStatus(sha, "main");
            if (status === "on_branch") {
              return {
                pick, type: "bot_merge", sha, prNumber: prNum,
                ciStatus: null, targetBranches: null,
                reason: `PR #${prNum} merged as ${sha.slice(0, 12)}. Can use bot to merge.`,
              };
            }
            return {
              pick, type: "not_on_main", sha, prNumber: prNum,
              ciStatus: null, targetBranches: null,
              reason: `PR #${prNum} merged as ${sha.slice(0, 12)} but commit is not on main yet.`,
            };
          }
        }

        // Fallback: use merge_commit_sha from PR
        if (pr.merge_commit_sha) {
          const sha = pr.merge_commit_sha;
          const status = await getCommitStatus(sha, "main");
          if (status === "on_branch") {
            return {
              pick, type: "bot_merge", sha, prNumber: prNum,
              ciStatus: null, targetBranches: null,
              reason: `PR #${prNum} merge commit ${sha.slice(0, 12)}. Can use bot to merge.`,
            };
          }
        }

        return {
          pick, type: "manual", sha: null, prNumber: prNum,
          ciStatus: null, targetBranches: null,
          reason: `PR #${prNum} is closed but could not determine merge SHA.`,
        };
      }

      // PR is still open
      return {
        pick, type: "manual", sha: null, prNumber: prNum,
        ciStatus: null, targetBranches: null,
        reason: `PR #${prNum} is still open. Not merged yet.`,
      };
    } catch (err: any) {
      return {
        pick, type: "manual", sha: null, prNumber: prNum,
        ciStatus: null, targetBranches: null,
        reason: `Could not fetch PR #${prNum}: ${err.message}`,
      };
    }
  }

  // No links found
  return {
    pick, type: "manual", sha: null, prNumber: null,
    ciStatus: null, targetBranches: null,
    reason: "No commit or PR link found in the pick request.",
  };
}

async function analyzePicks(
  picks: Array<PickRequest>,
  branch: string,
): Promise<Array<AnalyzedPick>> {
  const results: Array<AnalyzedPick> = [];
  for (const pick of picks) {
    const spinner = ui.spinner(`Analyzing #${pick.number}...`);
    const result = await analyzePick(pick, branch);
    spinner.stop();
    results.push(result);
  }
  return results;
}

export const prepareReleaseCommand: any = new Command("prepare-release")
  .description("Cherry-pick commits and prepare next RC")
  .requiredOption("--series <series>", "Release series (e.g., 0.85)")
  .option("--dry-run", "Show what would happen without making changes", false)
  .action(async (options: any) => {
    const dryRun: boolean = options.dryRun || ui._dryRunMode;

    const series = parseSeries(options.series);
    if (!series) {
      ui.error(`Invalid release series: ${options.series}. Expected format: 0.85`);
      process.exit(1);
      return;
    }

    const branch = `${series.major}.${series.minor}-stable`;
    const seriesPrefix = `${series.major}.${series.minor}.`;

    ui.header(`Prepare Release — ${series.major}.${series.minor} series`);
    ui.docRef(DOCS.prepareRelease);

    // Check if this series is still supported
    // Support window: latest 3 stable series are supported (2 active + 1 EoC)
    try {
      const allVersions = await getPublishedVersions();
      const stableSeries: Array<{major: number, minor: number}> = [];
      const seen = new Set();
      for (const v of allVersions) {
        if (v.includes("-nightly") || v.includes("-rc.")) continue;
        const match = v.match(/^(\d+)\.(\d+)\./);
        if (!match) continue;
        const key = `${match[1]}.${match[2]}`;
        if (!seen.has(key)) {
          seen.add(key);
          stableSeries.push({ major: parseInt(match[1], 10), minor: parseInt(match[2], 10) });
        }
      }
      stableSeries.sort((a, b) => {
        if (a.major !== b.major) return b.major - a.major;
        return b.minor - a.minor;
      });

      const rank = stableSeries.findIndex(
        (s) => s.major === series.major && s.minor === series.minor,
      );

      if (rank >= 3) {
        ui.warn(
          `Series ${series.major}.${series.minor} is unsupported (rank #${rank + 1}, only latest 3 are supported).`,
        );
        ui.warn("Patches for unsupported versions are exceptional. Make sure this is intentional.");
        console.log();
        const proceed = await ui.confirm("Continue anyway?");
        if (!proceed) {
          ui.warn("Aborted");
          return;
        }
        console.log();
      }
    } catch {
      // Non-fatal — skip support check if npm is unreachable
    }

    // Fetch the latest published version in this series
    const spinner = ui.spinner("Fetching latest version in series...");
    let latestVersion: string | null = null;
    let latestParsed: any = null;
    try {
      const allVersions = await getPublishedVersions();
      const seriesVersions = allVersions
        .filter((v) => v.startsWith(seriesPrefix) && !v.includes("-nightly"))
        .sort()
        .reverse();

      if (seriesVersions.length > 0) {
        latestVersion = seriesVersions[0];
        latestParsed = parseVersion(latestVersion);
      }
    } catch (err: any) {
      spinner.stop();
      ui.warn(`Could not fetch npm versions: ${err.message}`);
    }
    spinner.stop();

    // Determine next version
    let targetVersion: string;
    let isPrerelease: boolean;

    if (!latestParsed) {
      // No versions published yet — this is RC0
      targetVersion = `${series.major}.${series.minor}.0-rc.0`;
      isPrerelease = true;
      ui.info(`No published versions found. Starting at ${chalk.bold(targetVersion)}`);
    } else {
      const isRC = latestParsed.isPrerelease;
      ui.info(`Latest published version: ${chalk.bold(latestVersion ?? "")}`);
      console.log();

      if (isRC) {
        // Currently in RC phase — offer next RC or promote to stable
        const nextRCVersion = formatVersion(nextRC(latestParsed));
        const stableVersion = formatVersion({
          ...latestParsed,
          rc: undefined,
          isPrerelease: false,
        });

        const choice = await ui.search("What do you want to release?", [
          {
            name: `Next RC — ${nextRCVersion}`,
            value: "next-rc",
          },
          {
            name: `Promote to stable — ${stableVersion}`,
            value: "stable",
          },
        ]);

        if (choice === "stable") {
          targetVersion = stableVersion;
          isPrerelease = false;
        } else {
          targetVersion = nextRCVersion;
          isPrerelease = true;
        }
      } else {
        // Already stable — offer next patch
        const nextPatchVersion = formatVersion(nextPatch(latestParsed));
        ui.info(`Next patch: ${chalk.bold(nextPatchVersion)}`);

        const proceed = await ui.confirm(
          `Prepare ${nextPatchVersion}?`,
          true,
        );
        if (!proceed) {
          ui.warn("Aborted");
          return;
        }
        targetVersion = nextPatchVersion;
        isPrerelease = false;
      }
    }

    console.log();
    ui.info(`Target version: ${chalk.bold(targetVersion)}`);
    console.log();

    // Step 1: Check CI status on the branch (read-only)
    ui.step(1, 3, `Checking CI status on ${branch}...`);
    {
      let allGreen = true;
      const failedRuns: Array<{name: string, url: string, conclusion: string}> = [];

      const workflowsToCheck = [
        WORKFLOWS.createRelease,
        WORKFLOWS.testRelease,
      ];

      for (const workflow of workflowsToCheck) {
        try {
          const runs = await listWorkflowRuns(workflow, branch);
          if (runs.length > 0) {
            const latest = runs[0];
            if (latest.status !== "completed" || latest.conclusion !== "success") {
              allGreen = false;
              failedRuns.push({
                name: latest.name ?? workflow,
                url: latest.html_url,
                conclusion: latest.conclusion ?? latest.status,
              });
            }
          }
        } catch {
          // Workflow may not exist for this branch, skip
        }
      }

      if (allGreen) {
        ui.success("CI is green on " + branch);
      } else {
        ui.warn("CI is not green on " + branch);
        console.log();
        for (const run of failedRuns) {
          const badge = ui.statusBadge(run.conclusion);
          console.log(`  ${badge} ${run.name}`);
          ui.dim(`    ${run.url}`);
        }
        console.log();
      }
    }

    // Step 2: Check for unpublished commits on the branch (read-only)
    ui.step(2, 4, `Checking for unpublished commits on ${branch}...`);
    try {
      const { tag, commits } = await getUnpublishedCommits(
        branch,
        `${series.major}.${series.minor}.`,
      );

      if (!tag) {
        ui.dim("  No release tags found for this series yet");
      } else if (commits.length === 0) {
        ui.success(`No unpublished commits since ${tag}`);
      } else {
        ui.info(`${commits.length} unpublished commit${commits.length === 1 ? "" : "s"} since ${tag}:`);
        console.log();
        for (const c of commits) {
          let label = "";
          if (c.isLocal) {
            label = chalk.bgYellow.black(" LOCAL ");
          } else if (!c.hasPR) {
            label = chalk.bgRed.white(" NO PR ");
          } else {
            label = chalk.bgGreen.black(" PR ");
          }
          console.log(`  ${label} ${chalk.dim(c.sha.slice(0, 8))} ${c.message}`);
        }
        console.log();

        const localCount = commits.filter((c) => c.isLocal).length;
        const noPRCount = commits.filter((c) => !c.hasPR && !c.isLocal).length;
        if (localCount > 0) {
          ui.warn(`${localCount} [LOCAL] commit${localCount === 1 ? "" : "s"} — these were pushed directly without a PR.`);
        }
        if (noPRCount > 0) {
          ui.warn(`${noPRCount} commit${noPRCount === 1 ? "" : "s"} without associated PR — may have been pushed directly.`);
        }
      }
    } catch (err: any) {
      ui.warn(`Could not check unpublished commits: ${err.message}`);
    }

    // Step 3: Analyze pending pick requests (read-only analysis, mutations gated)
    ui.step(3, 4, "Analyzing pending pick requests...");
    try {
      const allPicks = await listPickRequests();
      const seriesKey = `${series.major}.${series.minor}`;
      const seriesPicks = allPicks.filter((p) => p.series === seriesKey);

      if (seriesPicks.length === 0) {
        ui.success("No pending pick requests");
      } else {
        // Analyze each pick
        const analyzed = await analyzePicks(seriesPicks, branch);

        // Show summary
        ui.info(`${analyzed.length} pending pick${analyzed.length === 1 ? "" : "s"} for ${seriesKey}:`);
        console.log();

        for (const a of analyzed) {
          const title = a.pick.title.replace(/^\[\d+\.\d+\]\s*/, "");
          const statusIcon = a.type === "bot_merge" ? chalk.green("●")
            : a.type === "manual" ? chalk.yellow("●")
            : a.type === "pr_against_branch" ? chalk.blue("●")
            : a.type === "pr_merged_on_branch" ? chalk.green("●")
            : a.type === "hermes" ? chalk.red("●")
            : chalk.red("●");
          const typeLabel = a.type === "bot_merge" ? chalk.green("bot merge")
            : a.type === "manual" ? chalk.yellow("manual")
            : a.type === "pr_against_branch" ? chalk.blue("PR on branch")
            : a.type === "pr_merged_on_branch" ? chalk.green("already merged")
            : a.type === "not_on_main" ? chalk.yellow("not on main yet")
            : a.type === "multiple_targets" ? chalk.red("multi-target")
            : a.type === "hermes" ? chalk.red("hermes")
            : chalk.red("complex");
          console.log(`  ${statusIcon} ${chalk.cyan(`#${a.pick.number}`)} ${title} ${chalk.dim(`by @${a.pick.author}`)}  [${typeLabel}]`);
          if (a.sha) {
            ui.dim(`    SHA: ${a.sha}`);
          }
          if (a.reason) {
            ui.dim(`    ${a.reason}`);
          }
        }
        console.log();

        // Walk through each pick one by one
        ui.header("Process Pick Requests");

        for (const a of analyzed) {
          const title = a.pick.title.replace(/^\[\d+\.\d+\]\s*/, "");
          console.log();
          ui.info(`#${a.pick.number}: ${title}`);
          ui.dim(`  ${a.pick.url}`);
          if (a.sha) ui.dim(`  SHA: ${a.sha}`);
          if (a.reason) ui.dim(`  ${a.reason}`);
          console.log();

          if (a.type === "bot_merge") {
            if (!dryRun) {
              const action = await ui.search(`Pick #${a.pick.number}:`, [
                {
                  name: `Comment "@react-native-bot merge ${(a.sha ?? "").slice(0, 12)} ${branch}"`,
                  value: "bot",
                },
                { name: "Skip this pick", value: "skip" },
              ]);

              if (action === "bot") {
                const comment = `@react-native-bot merge ${a.sha ?? ""} ${branch}`;
                await createIssueComment(a.pick.number, comment);
                ui.success(`Commented on #${a.pick.number}: ${comment}`);
              } else {
                ui.dim("  Skipped");
              }
            } else {
              ui.dryRun(`Would comment "@react-native-bot merge ${(a.sha ?? "").slice(0, 12)} ${branch}" on #${a.pick.number}`);
            }
          } else if (a.type === "not_on_main") {
            ui.warn("  Commit is not on main yet. This requires manual cherry-picking.");
          } else if (a.type === "pr_against_branch") {
            ui.info(`  PR #${a.prNumber ?? ""} targets ${branch} directly.`);
            if (a.ciStatus) {
              ui.info(`  CI status: ${a.ciStatus}`);
            }
            ui.warn("  Merge this PR manually on GitHub.");
            ui.dim(`  https://github.com/react/react-native/pull/${a.prNumber ?? ""}`);
          } else if (a.type === "pr_merged_on_branch") {
            ui.success(`  PR #${a.prNumber ?? ""} is already merged into ${branch}.`);
            ui.warn("  This pick request is still open but the work is done.");
            if (!dryRun) {
              const action = await ui.search(`Pick #${a.pick.number}:`, [
                { name: "Close this pick request", value: "close" },
                { name: "Skip", value: "skip" },
              ]);
              if (action === "close") {
                await closeIssue(a.pick.number);
                ui.success(`  Closed #${a.pick.number}`);
              } else {
                ui.dim("  Skipped");
              }
            } else {
              ui.dryRun(`Would offer to close #${a.pick.number}`);
            }
          } else if (a.type === "hermes") {
            ui.warn("  This pick involves facebook/hermes.");
            ui.warn("  Hermes changes require a Hermes release — this needs manual handling.");
          } else if (a.type === "multiple_targets") {
            ui.warn("  This pick has multiple target branches and needs to be duplicated.");
            ui.warn(`  Target branches: ${a.targetBranches?.join(", ") ?? "unknown"}`);
          } else {
            ui.warn("  This pick has multiple PRs or commits. Requires manual review.");
          }
        }
      }
    } catch (err: any) {
      ui.warn(`Could not fetch pick requests: ${err.message}`);
    }

    // Step 4: Verify branch exists (read-only)
    ui.step(4, 4, `Verifying branch ${branch}...`);
    {
      try {
        const branchData = await getBranch(branch);
        ui.success(`Branch ${branch} found (HEAD: ${branchData.commit.sha.slice(0, 8)})`);
      } catch {
        ui.error(`Branch ${branch} not found. Run cut-branch first.`);
        process.exit(1);
      }
    }

    console.log();
    ui.success("🍒 Prepare release complete!");
    ui.dim("Next steps:");
    ui.dim(`  rn-release-automator publish --version ${targetVersion}`);
    ui.dim(`  rn-release-automator status --series ${series.major}.${series.minor}`);

    if (!isPrerelease && targetVersion.endsWith(".0")) {
      console.log();
      ui.info(chalk.bold("This is a .0 stable release!"));
      ui.dim("  After publishing, run the verification checklist:");
      ui.dim(`  rn-release-automator verify-release --series ${series.major}.${series.minor}`);
    }
  });
