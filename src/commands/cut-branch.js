// @flow

// `cut-branch` command — RC0 branch cut automation

import { Command } from "commander";
import chalk from "chalk";
import { execSync } from "child_process";
import { ui } from "../utils/ui.js";
import {
  createBranch,
  getBranch,
  getCommit,
  compareRefs,
  listWorkflowRuns,
} from "../utils/github.js";
import { WORKFLOWS, REACT_NATIVE_REPO } from "../config.js";
import { DOCS } from "../docs.js";

const SERIES_PATTERN = /^(\d+)\.(\d+)$/;

function parseSeries(series: string): {major: number, minor: number} | null {
  const match = series.match(SERIES_PATTERN);
  if (!match) return null;
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
}

function openUrl(url: string): void {
  try {
    execSync(`open "${url}"`, { stdio: "ignore", timeout: 5000 });
  } catch {
    try {
      execSync(`xdg-open "${url}"`, { stdio: "ignore", timeout: 5000 });
    } catch {
      // can't open
    }
  }
}

function isInsideReactNativeRepo(): boolean {
  try {
    const remote = execSync("git remote get-url origin", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return remote.includes(`${REACT_NATIVE_REPO.owner}/${REACT_NATIVE_REPO.repo}`);
  } catch {
    return false;
  }
}

function getCurrentBranch(): string | null {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function isCleanWorkingDir(): boolean {
  try {
    const status = execSync("git status --porcelain", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return status.length === 0;
  } catch {
    return false;
  }
}

function runCommand(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: "inherit", timeout: 120000 });
    return true;
  } catch {
    return false;
  }
}

export const cutBranchCommand: any = new Command("cut-branch")
  .description("Create a new stable branch for RC0")
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

    if (series.major !== 0) {
      ui.error("Only 0.x series are supported. React Native has not reached 1.0 yet.");
      process.exit(1);
      return;
    }

    if (series.minor === 0) {
      ui.warn("Series 0.0 is accepted but should only be used for release testing.");
      console.log();
    }

    const branch = `${series.major}.${series.minor}-stable`;
    const version = `${series.major}.${series.minor}.0-rc.0`;

    ui.header(`Cut Branch — ${series.major}.${series.minor} series`);
    ui.docRef(DOCS.cutBranch);

    // Step 0: Check we're inside react-native on main with clean working dir
    ui.step(1, 13, "Verifying repository state...");
    {
      if (!isInsideReactNativeRepo()) {
        ui.warn("Not inside the react/react-native repository.");
        const proceed = await ui.confirm("Continue anyway? (for testing purposes)");
        if (!proceed) {
          process.exit(1);
        }
      } else {
        ui.success("Inside react/react-native");
      }

      const currentBranch = getCurrentBranch();
      if (currentBranch !== "main") {
        ui.warn(`Current branch is ${chalk.bold(currentBranch ?? "unknown")}, expected ${chalk.bold("main")}.`);
        ui.dim("  Run: git checkout main && git pull");
      } else {
        ui.success("On branch main");
      }

      if (!isCleanWorkingDir()) {
        ui.warn("Working directory is not clean.");
        ui.dim("  Commit or stash your changes first.");
      } else {
        ui.success("Working directory is clean");
      }
    }

    // When main's CI is red, the user may choose to cut from a different
    // (green) commit; this holds that commit-ish until we resolve it below.
    let sourceOverride: string | null = null;

    // Step 1: Check CI is green on main (test_all only)
    ui.step(2, 13, "Checking CI status on main (Test All)...");
    {
      let allGreen = true;
      const failedRuns: Array<{name: string, url: string, conclusion: string}> = [];

      try {
        const runs = await listWorkflowRuns(WORKFLOWS.testAll, "main");
        if (runs.length > 0) {
          const latest = runs[0];
          if (latest.status !== "completed" || latest.conclusion !== "success") {
            allGreen = false;
            failedRuns.push({
              name: latest.name ?? "Test All",
              url: latest.html_url,
              conclusion: latest.conclusion ?? latest.status,
            });
          }
        }
      } catch {
        // skip
      }

      if (allGreen) {
        ui.success("CI is green on main");
      } else {
        ui.warn("CI is not green on main");
        console.log();
        for (const run of failedRuns) {
          const badge = ui.statusBadge(run.conclusion);
          console.log(`  ${badge} ${run.name}`);
          ui.dim(`    ${run.url}`);
        }
        console.log();
        const choice = await ui.select(
          chalk.yellow("main CI is failing. How do you want to proceed?"),
          [
            {
              name: "Cut from a different (green) commit",
              value: "from-commit",
              description: "Enter a commit on main's history to branch from",
            },
            {
              name: "Cut from main HEAD anyway",
              value: "main-head",
              description: "Proceed with the current (red) tip of main",
            },
            {
              name: "Abort",
              value: "abort",
              description: "Fix CI on main before cutting",
            },
          ],
        );
        if (choice === "abort") {
          ui.warn("Aborted. Fix CI on main before cutting.");
          return;
        }
        if (choice === "from-commit") {
          const sha = (await ui.input("Commit SHA to cut from:")).trim();
          if (!sha) {
            ui.error("No commit provided. Aborting.");
            process.exit(1);
            return;
          }
          sourceOverride = sha;
          ui.dim("  Make sure that commit itself has green CI.");
        }
        // choice === "main-head" → leave sourceOverride null; cut from main HEAD
      }
    }

    // Step 2: Prompt to update support.md external dependencies table
    ui.step(3, 13, "Update external dependencies support table...");
    {
      const editUrl = "https://github.com/reactwg/react-native-releases/edit/main/docs/support.md#external-dependencies-supported";
      ui.info("Update the external dependencies table for the new release series.");
      ui.dim(`  ${editUrl}`);
      console.log();
      const action = await ui.search("Update dependencies table?", [
        { name: "Open in browser", value: "open" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "open") {
        openUrl(editUrl);
        ui.success("  Opened in browser");
        await ui.confirm("Press enter when done...", true);
      } else {
        ui.dim("  Skipped");
      }
    }

    // Step 3: Verify branch doesn't exist (read-only)
    ui.step(4, 13, "Checking if branch already exists...");
    try {
      await getBranch(branch);
      ui.error(`Branch ${branch} already exists. Aborting.`);
      process.exit(1);
    } catch {
      ui.success(`Branch ${branch} does not exist yet`);
    }

    // Step 4: Resolve the source commit (read-only)
    ui.step(5, 13, "Resolving source commit...");
    let sourceSha: string;
    let sourceDesc: string;
    if (sourceOverride) {
      let commit;
      try {
        commit = await getCommit(sourceOverride);
      } catch {
        ui.error(`Commit ${sourceOverride} was not found in the repository.`);
        process.exit(1);
        return;
      }
      sourceSha = commit.sha;

      // Verify the commit is on main's history (an ancestor of main).
      try {
        const cmp = await compareRefs(sourceSha, "main");
        if (cmp.status !== "ahead" && cmp.status !== "identical") {
          ui.error(
            `Commit ${sourceSha.slice(0, 8)} is not an ancestor of main (compare status: ${cmp.status}).`,
          );
          ui.dim("  The commit must be on main's history.");
          process.exit(1);
          return;
        }
      } catch {
        ui.warn("Could not verify the commit is an ancestor of main; proceeding anyway.");
      }

      const firstLine = commit.commit.message.split("\n")[0];
      sourceDesc = `commit ${sourceSha.slice(0, 8)} (${firstLine})`;
      ui.success(`Cutting from ${sourceDesc}`);
    } else {
      const main = await getBranch("main");
      sourceSha = main.commit.sha;
      sourceDesc = `main (${sourceSha.slice(0, 8)})`;
      ui.success(`main HEAD: ${sourceSha.slice(0, 8)}`);
    }

    // Step 5: Create stable branch (mutation)
    ui.step(6, 13, `Creating branch ${branch}...`);
    if (!dryRun) {
      const proceed = await ui.confirm(
        `Create branch ${branch} from ${sourceDesc}?`,
      );
      if (!proceed) {
        ui.warn("Aborted by user");
        return;
      }
      await createBranch(branch, sourceSha);
      ui.success(`Branch ${branch} created`);
    } else {
      ui.dryRun(`Would create branch ${branch} from ${sourceDesc}`);
    }

    // Step 5bis: Checkout the branch locally
    ui.step(7, 13, `Checking out ${branch} locally...`);
    if (!dryRun) {
      const ok = runCommand(`git fetch origin && git checkout ${branch}`);
      if (ok) {
        ui.success(`Checked out ${branch}`);
      } else {
        ui.warn(`Could not checkout ${branch}. Run manually: git fetch origin && git checkout ${branch}`);
      }
    } else {
      ui.dryRun(`Would checkout ${branch}`);
    }

    // Step 6: Create template branch
    ui.step(8, 13, `Creating branch ${branch} in react-native-community/template...`);
    {
      const templateRepo = { owner: "react-native-community", repo: "template" };
      if (!dryRun) {
        // Check if branch already exists
        let templateBranchExists = false;
        try {
          await getBranch(branch, templateRepo);
          templateBranchExists = true;
        } catch {
          // doesn't exist
        }

        if (templateBranchExists) {
          ui.success(`Branch ${branch} already exists in template repo`);
        } else {
          const proceed = await ui.confirm(
            `Create branch ${branch} in react-native-community/template from main?`,
          );
          if (proceed) {
            try {
              const templateMain = await getBranch("main", templateRepo);
              const templateSha = templateMain.commit.sha;
              await createBranch(branch, templateSha, templateRepo);
              ui.success(`Branch ${branch} created in template repo (from ${templateSha.slice(0, 8)})`);
            } catch (err: any) {
              ui.warn(`Could not create branch: ${err.message}`);
              ui.dim("  Create it manually: https://github.com/react-native-community/template/branches");
            }
          } else {
            ui.dim("  Skipped");
          }
        }
      } else {
        ui.dryRun(`Would create branch ${branch} in react-native-community/template`);
      }
    }

    // Step 7: Inform CLI channel on Discord
    ui.step(9, 13, "Inform CLI channel on Discord...");
    {
      const discordUrl = "https://discord.com/channels/514829729862516747/1232435652533031013";
      const message = `Hey, cutting ${branch} on react-native now, FYI in case CLI wants to cut a new major 🙂`;
      ui.info("Post this message to #cli on Discord:");
      console.log();
      console.log(`  ${chalk.cyan(message)}`);
      console.log();
      const action = await ui.search("Inform Discord?", [
        { name: "Open Discord channel in browser", value: "open" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "open") {
        openUrl(discordUrl);
        ui.success("  Opened Discord channel");
      } else {
        ui.dim("  Skipped");
      }
    }

    // Step 8: Trigger React Native nightly
    ui.step(10, 13, "Triggering React Native nightly...");
    {
      const nightlyUrl = "https://github.com/react/react-native/actions/workflows/nightly.yml";
      if (!dryRun) {
        const action = await ui.search("Trigger nightly build?", [
          { name: "Open nightly workflow in browser", value: "open" },
          { name: "Skip", value: "skip" },
        ]);
        if (action === "open") {
          openUrl(nightlyUrl);
          ui.success("  Opened nightly workflow — trigger it manually");
        } else {
          ui.dim("  Skipped");
        }
      } else {
        ui.dryRun("Would trigger nightly build");
        ui.dim(`  ${nightlyUrl}`);
      }
    }

    // Step 9: Hermes release
    ui.step(11, 13, "Hermes release...");
    {
      const hermesGuide = "https://github.com/reactwg/react-native-releases/blob/main/docs/guide-hermes-release.md#for-react-native--083";
      ui.info("Follow the Hermes release guide:");
      ui.dim(`  ${hermesGuide}`);
      console.log();
      const action = await ui.search("Open Hermes release guide?", [
        { name: "Open in browser", value: "open" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "open") {
        openUrl(hermesGuide);
        ui.success("  Opened Hermes release guide");
        await ui.confirm("Press enter when Hermes release is done...", true);
      } else {
        ui.dim("  Skipped");
      }
    }

    // Step 10: Bump Hermes version on the release branch
    ui.step(12, 13, "Bump Hermes version on the release branch...");
    {
      ui.info("You need the Hermes tag and v1 tag from the Hermes release.");
      console.log();

      const hermesTag = await ui.input("Enter the Hermes tag (e.g., hermes-2025-03-01-RNv0.85.0-abcdef0123):");
      const hermesV1Tag = await ui.input("Enter the Hermes v1 tag (e.g., v1.0.0):");

      const bumpCmd = `./packages/react-native/scripts/hermes/bump-hermes-version.js -t ${hermesTag} -s ${hermesV1Tag}`;
      ui.info("Running bump command:");
      ui.dim(`  ${bumpCmd}`);
      console.log();

      if (!dryRun) {
        const proceed = await ui.confirm("Run the bump command?");
        if (proceed) {
          const ok = runCommand(bumpCmd);
          if (ok) {
            ui.success("Hermes version bumped");

            // Commit and push
            ui.info("Committing and pushing...");
            const commitOk = runCommand(
              'git add packages/react-native/sdks/.hermesversion packages/react-native/sdks/.hermesv1version packages/react-native/sdks/hermes-engine/version.properties && git commit -m "Bump hermes version" && git push',
            );
            if (commitOk) {
              ui.success("Hermes version bump committed and pushed");
            } else {
              ui.warn("Could not commit/push. Run manually:");
              ui.dim('  git add packages/react-native/sdks/.hermesversion packages/react-native/sdks/.hermesv1version packages/react-native/sdks/hermes-engine/version.properties');
              ui.dim('  git commit -m "Bump hermes version"');
              ui.dim("  git push");
            }
          } else {
            ui.warn("Bump command failed. Run manually:");
            ui.dim(`  ${bumpCmd}`);
          }
        } else {
          ui.dim("  Skipped — run the command above manually");
        }
      } else {
        ui.dryRun(`Would run: ${bumpCmd}`);
        ui.dryRun("Would commit and push the Hermes version bump");
      }
    }

    // Step 11: Follow-ups
    ui.step(13, 13, "Follow-up tasks...");
    console.log();

    console.log(`  ${chalk.bold("a. Bump Hermes on main of Hermes and v1 release branch")}`);
    {
      const url = "https://github.com/reactwg/react-native-releases/blob/main/docs/guide-hermes-release.md#step-5-bump-version-on-main-and-hermes-v1-release-branch";
      ui.dim(`     ${url}`);
      console.log();
      const action = await ui.search("Open Hermes bump guide?", [
        { name: "Open in browser", value: "open" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "open") {
        openUrl(url);
        ui.success("  Opened in browser");
      } else {
        ui.dim("  Skipped");
      }
    }
    console.log();

    console.log(`  ${chalk.bold("b. Bump Hermes on main of React Native")}`);
    {
      const url = "https://github.com/reactwg/react-native-releases/blob/main/docs/guide-hermes-release.md#step-6-only-for-branch-cut-bump-hermes-versions-on-react-native-main-branch";
      ui.dim(`     ${url}`);
      console.log();
      const action = await ui.search("Open React Native Hermes bump guide?", [
        { name: "Open in browser", value: "open" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "open") {
        openUrl(url);
        ui.success("  Opened in browser");
      } else {
        ui.dim("  Skipped");
      }
    }

    console.log();
    ui.success("⚛️  Branch cut complete! Time to make some releases.");
    ui.dim("Follow-ups:");

    console.log();
    console.log(`  1. ${chalk.bold("Bump the react-native monorepo version on main")}`);
    ui.dim("     This needs a commit on main to bump the version to the next minor.");
    {
      const refUrl = "https://github.com/react/react-native/commit/f1bedfb92bd1b0871ffdde1e208403bb56740cdd";
      ui.dim(`     Reference: ${refUrl}`);
      console.log();
      const action = await ui.search("Open reference commit?", [
        { name: "Open in browser", value: "open" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "open") {
        openUrl(refUrl);
        ui.success("  Opened in browser");
      } else {
        ui.dim("  Skipped");
      }
    }

    console.log();
    console.log(`  2. ${chalk.bold("Create GitHub project and continue with prepare-release")}`);
    ui.dim(`     rn-release-automator create-github-project --series ${series.major}.${series.minor}`);
    ui.dim(`     rn-release-automator prepare-release --series ${series.major}.${series.minor}`);
  });
