// @flow

// `test-release` command — local release testing

import { Command } from "commander";
import chalk from "chalk";
import { ui } from "../utils/ui.js";
import { execSync } from "child_process";
import {
  parseVersion,
  formatVersion,
  stableBranch,
} from "../utils/version.js";
import {
  listWorkflowRuns,
  getOctokit,
} from "../utils/github.js";
import {
  WORKFLOWS,
  RN_COMMUNITY_RELEASES_REPO,
} from "../config.js";
import { DOCS } from "../docs.js";

function getCurrentBranch(): string | null {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function isInsideReactNativeRepo(): boolean {
  try {
    const remote = execSync("git remote get-url origin", {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    return remote.includes("facebook/react-native");
  } catch {
    return false;
  }
}

export const testReleaseCommand: any = new Command("test-release")
  .description("Run test-release-local and guide through test matrix")
  .requiredOption("--version <version>", "Version to test")
  .option("--dry-run", "Show what would happen without making changes", false)
  .action(async (options: any) => {
    const dryRun: boolean = options.dryRun || ui._dryRunMode;

    const parsed = parseVersion(options.version);
    if (!parsed) {
      ui.error(`Invalid version: ${options.version}`);
      process.exit(1);
    }

    const branch = stableBranch(parsed);
    const version = formatVersion(parsed);

    ui.header(`Test Release — ${version}`);
    ui.docRef(DOCS.testRelease);

    // Check if manual testing is required for this version
    const rc = parsed.rc;
    const isRC = parsed.isPrerelease;
    const requiresTesting = !isRC || rc === 0 || rc === 1 || rc === 4;

    if (requiresTesting) {
      ui.info("Manual testing is required for this version (RC0, RC1, RC4, or stable).");
    } else {
      ui.warn(`Manual testing is optional for RC${rc ?? ""}.`);
      ui.dim("  Only RC0, RC1, RC4, and stable releases require manual testing.");
      ui.dim("  You can still test if you wish, but it's not a hard requirement.");
      console.log();
      const proceed = await ui.confirm("Continue with testing anyway?");
      if (!proceed) {
        ui.dim("Skipping test release.");
        return;
      }
    }
    console.log();

    // Step 1: Verify we're inside react-native on the correct branch
    ui.step(1, 5, "Verifying repository and branch...");
    {
      const inRepo = isInsideReactNativeRepo();
      if (!inRepo) {
        ui.warn("Not inside the facebook/react-native repository.");
        const proceed = await ui.confirm("Continue anyway? (for testing purposes)");
        if (!proceed) {
          process.exit(1);
        }
      } else {
        ui.success("Inside facebook/react-native");
      }

      const currentBranch = getCurrentBranch();
      if (currentBranch !== branch) {
        ui.warn(`Current branch is ${chalk.bold(currentBranch ?? "unknown")}, expected ${chalk.bold(branch)}.`);
        ui.dim(`  Run: git checkout ${branch}`);
        const proceed = await ui.confirm("Continue anyway?");
        if (!proceed) {
          return;
        }
      } else {
        ui.success(`On branch ${branch}`);
      }
    }

    // Step 2: Verify CI is green on the branch
    ui.step(2, 5, `Checking CI status on ${branch}...`);
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
          // skip
        }
      }

      if (allGreen) {
        ui.success("CI is green — prebuilds should be available");
      } else {
        ui.warn("CI is not green on " + branch);
        ui.warn("Prebuilds may not be available. You may need to build locally.");
        console.log();
        for (const run of failedRuns) {
          const badge = ui.statusBadge(run.conclusion);
          console.log(`  ${badge} ${run.name}`);
          ui.dim(`    ${run.url}`);
        }
        console.log();
      }
    }

    // Step 3: Ask about cleaning the environment
    ui.step(3, 5, "Environment setup...");
    {
      const shouldClean = await ui.confirm("Clean the environment before testing?");
      if (shouldClean) {
        if (!dryRun) {
          ui.info("Running: yarn && yarn test-release-local-clean && yarn");
          try {
            execSync("yarn && yarn test-release-local-clean && yarn", {
              stdio: "inherit",
              timeout: 300000,
            });
            ui.success("Environment cleaned");
          } catch {
            ui.error("Clean failed. You may need to run the commands manually.");
          }
        } else {
          ui.dryRun("Would run: yarn && yarn test-release-local-clean && yarn");
        }
      } else {
        ui.dim("  Skipping clean");
      }
    }

    // Step 4: Ask about prebuilds
    ui.step(4, 5, "Configuration...");
    const usePrebuilds = await ui.confirm("Download prebuilds from CI? (requires GITHUB_TOKEN or gh auth)");

    let ciTokenFlag = "";
    if (usePrebuilds) {
      // Try to get the token
      let token = process.env.GITHUB_TOKEN ?? "";
      if (!token) {
        try {
          token = execSync("gh auth token", { encoding: "utf8", timeout: 5000 }).trim();
        } catch {
          // no token
        }
      }
      if (token) {
        ciTokenFlag = ` -c ${token}`;
        ui.success("GitHub token found — prebuilds will be downloaded");
      } else {
        ui.warn("No GitHub token found. Prebuilds won't be available.");
        ciTokenFlag = "";
      }
    }

    // Step 5: Ask about creating a test report
    ui.step(5, 5, "Test report...");
    {
      const createReport = await ui.confirm("Create a new test report issue?");
      if (createReport) {
        const reportUrl = `https://github.com/reactwg/react-native-releases/issues/new?assignees=&labels=Type%3A+Test+Report&projects=&template=test_report.yml&title=%5B${version}%5D+Test+Report`;
        ui.info("Open this URL to create the test report:");
        ui.dim(`  ${reportUrl}`);
        console.log();
      }
    }

    // Print the test commands
    console.log();
    ui.header("Test Commands");

    const testDimensions = [
      { target: "RNTester", platform: "iOS" },
      { target: "RNTester", platform: "Android" },
      { target: "RNTestProject", platform: "iOS" },
      { target: "RNTestProject", platform: "Android" },
    ];

    ui.info("Run these commands to test each configuration:");
    console.log();

    for (const { target, platform } of testDimensions) {
      const cmd = `yarn test-release-local -t ${target} -p ${platform}${ciTokenFlag}`;
      console.log(`  ${chalk.bold(`${target} + ${platform} + Hermes`)}`);
      console.log(`  ${chalk.cyan(cmd)}`);
      console.log();
    }

    ui.divider();
    ui.info("Test checklist:");
    console.log();
    console.log("  - [ ] RNTester + iOS + Hermes");
    console.log("  - [ ] RNTester + Android + Hermes");
    console.log("  - [ ] RNTestProject + iOS + Hermes");
    console.log("  - [ ] RNTestProject + Android + Hermes");
    console.log();

    ui.dim("For each configuration, verify:");
    ui.dim("  - App builds and launches successfully");
    ui.dim("  - Basic navigation works");
    ui.dim("  - No red screen errors");
    ui.dim("  - Metro bundler connects (debug mode)");
    console.log();
    ui.dim("Refer to the test cases spreadsheet:");
    ui.dim("  https://docs.google.com/spreadsheets/d/1p0Zs37ecau7Ty4L_4g1jf7PlivOmIEPjmDYq9Jp8qWI/edit?usp=sharing");
  });
