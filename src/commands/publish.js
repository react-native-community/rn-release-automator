// @flow

// `publish` command — trigger + monitor publish pipeline

import { Command } from "commander";
import chalk from "chalk";
import { ui } from "../utils/ui.js";
import {
  parseVersion,
  formatVersion,
  stableBranch,
} from "../utils/version.js";
import {
  triggerWorkflow,
  listWorkflowRuns,
  pollWorkflowRun,
  getBranch,
  listPickRequests,
} from "../utils/github.js";
import { isVersionPublished } from "../utils/npm-utils.js";
import { WORKFLOWS } from "../config.js";
import { DOCS } from "../docs.js";

export const publishCommand: any = new Command("publish")
  .description("Trigger and monitor publish pipeline")
  .requiredOption("--version <version>", "Version to publish")
  .option("--no-monitor", "Don't poll for workflow completion")
  .option("--dry-run", "Show what would happen without making changes", false)
  .action(async (options: any) => {
    const dryRun: boolean = options.dryRun || ui._dryRunMode;
    const shouldMonitor: boolean = options.monitor !== false;

    const parsed = parseVersion(options.version);
    if (!parsed) {
      ui.error(`Invalid version: ${options.version}`);
      process.exit(1);
    }

    const branch = stableBranch(parsed);
    const version = formatVersion(parsed);

    ui.header(`Publish — ${version}`);
    ui.docRef(DOCS.publish);

    // Step 1: Check CI status on the branch (read-only)
    ui.step(1, 5, `Checking CI status on ${branch}...`);
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
        ui.error("CI is not green on " + branch);
        console.log();
        for (const run of failedRuns) {
          const badge = ui.statusBadge(run.conclusion);
          console.log(`  ${badge} ${run.name}`);
          ui.dim(`    ${run.url}`);
        }
        console.log();
        if (!dryRun) {
          const proceed = await ui.confirm(
            chalk.yellow("CI is failing. Publish anyway?"),
          );
          if (!proceed) {
            ui.warn("Aborted. Fix CI before publishing.");
            return;
          }
        }
      }
    }

    // Step 2: Check pending picks (read-only)
    ui.step(2, 5, "Checking pending pick requests...");
    try {
      const allPicks = await listPickRequests();
      const seriesKey = `${parsed.major}.${parsed.minor}`;
      const seriesPicks = allPicks.filter((p) => p.series === seriesKey);

      if (seriesPicks.length === 0) {
        ui.success("No pending pick requests");
      } else {
        ui.warn(`${seriesPicks.length} pending pick${seriesPicks.length === 1 ? "" : "s"} for ${seriesKey}:`);
        console.log();
        for (const pick of seriesPicks) {
          const title = pick.title.replace(/^\[\d+\.\d+\]\s*/, "");
          console.log(`  ${chalk.cyan(`#${pick.number}`)} ${title} ${chalk.dim(`by @${pick.author}`)}`);
          ui.dim(`    ${pick.url}`);
        }
        console.log();
        if (!dryRun) {
          const proceed = await ui.confirm(
            chalk.yellow("There are pending picks. Publish anyway?"),
          );
          if (!proceed) {
            ui.warn("Aborted. Cherry-pick pending changes first.");
            return;
          }
        }
      }
    } catch (err: any) {
      ui.warn(`Could not fetch pick requests: ${err.message}`);
    }

    // Step 3: Check if already published (read-only)
    ui.step(3, 5, "Checking if already published on npm...");
    {
      const published = await isVersionPublished(version);
      if (published) {
        ui.error(`${version} is already published on npm!`);
        ui.warn("Re-publishing an existing version will likely fail.");
        const proceed = await ui.confirm(
          chalk.red("Are you sure you want to continue?"),
        );
        if (!proceed) return;
      } else {
        ui.success(`${version} not yet published`);
      }
    }

    // Step 4: Trigger create-release workflow (mutation)
    ui.step(4, 5, "Triggering create-release workflow...");
    if (!dryRun) {
      const isLatest = !parsed.isPrerelease;
      const proceed = await ui.confirm(
        `Trigger create-release for ${version} on ${branch}?`,
      );
      if (!proceed) {
        ui.warn("Aborted");
        return;
      }

      await triggerWorkflow(WORKFLOWS.createRelease, branch, {
        version,
        "is-latest-on-npm": String(isLatest),
        "dry-run": "false",
      });
      ui.success("create-release workflow triggered");
    } else {
      ui.dryRun(`Would trigger create-release for ${version}`);
    }

    // Step 5: Monitor workflow (mutation — only if workflow was triggered)
    if (shouldMonitor && !dryRun) {
      ui.step(5, 5, "Monitoring workflow...");
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const runs = await listWorkflowRuns(WORKFLOWS.createRelease, branch);
      if (runs.length === 0) {
        ui.warn("No workflow runs found yet. Check GitHub Actions manually.");
      } else {
        const latestRun = runs[0];
        ui.info(`Workflow run: ${latestRun.html_url}`);

        const spinner = ui.spinner("Waiting for workflow to complete...");
        const result = await pollWorkflowRun(latestRun.id, (run) => {
          spinner.text = `Status: ${run.status} — ${run.html_url}`;
        });
        spinner.stop();

        if (result.conclusion === "success") {
          ui.success("Publish workflow completed successfully");
        } else {
          ui.error(`Publish workflow ${result.conclusion ?? "failed"}`);
          ui.dim(`  ${result.html_url}`);
        }
      }
    } else if (!shouldMonitor) {
      ui.step(5, 5, "Skipping monitoring (--no-monitor)");
    } else {
      ui.dryRun("Would monitor workflow progress");
    }

    console.log();
    ui.success("🚀 Publish flow complete!");
  });
