// @flow

// `hermes` command — Hermes release flow with dual-tag support for >= 0.83

import { Command } from "commander";
import { ui } from "../utils/ui.js";
import {
  parseVersion,
  formatVersion,
  stableBranch,
  usesDualHermesTag,
} from "../utils/version.js";
import { triggerWorkflow, listWorkflowRuns } from "../utils/github.js";
import { HERMES_REPO, WORKFLOWS } from "../config.js";
import { DOCS } from "../docs.js";

export const hermesCommand: any = new Command("hermes")
  .description("Trigger Hermes release (dual-tag for >= 0.83)")
  .requiredOption("--version <version>", "React Native version for Hermes release")
  .option("--dry-run", "Show what would happen without making changes", false)
  .action(async (options: any) => {
    const dryRun: boolean = options.dryRun || ui._dryRunMode;

    const parsed = parseVersion(options.version);
    if (!parsed) {
      ui.error(`Invalid version: ${options.version}`);
      process.exit(1);
    }

    const version = formatVersion(parsed);
    const branch = stableBranch(parsed);
    const dualTag = usesDualHermesTag(parsed);

    ui.header(`Hermes Release — ${version}`);
    ui.docRef(DOCS.hermes);

    ui.table([
      ["Version", version],
      ["Branch", branch],
      ["Dual-tag", dualTag ? "yes (>= 0.83)" : "no (legacy)"],
    ]);
    console.log();

    if (dualTag) {
      ui.info(
        "This version uses dual-tag Hermes: both hermes-YYYY-MM-DD and react-native version tags.",
      );
    }

    // Step 1: Trigger Hermes release
    ui.step(1, 2, "Triggering Hermes release workflow...");
    if (!dryRun) {
      const inputs: {[string]: string} = {
        version,
        branch,
      };
      if (dualTag) {
        inputs.dual_tag = "true";
      }

      const proceed = await ui.confirm(
        `Trigger Hermes release for ${version}?`,
      );
      if (!proceed) {
        ui.warn("Aborted");
        return;
      }

      await triggerWorkflow(
        WORKFLOWS.hermesRelease,
        "main",
        inputs,
        HERMES_REPO,
      );
      ui.success("Hermes release workflow triggered");
    } else {
      ui.dryRun("Would trigger Hermes release workflow");
    }

    // Step 2: Show recent runs
    ui.step(2, 2, "Recent Hermes workflow runs:");
    if (!dryRun) {
      try {
        const runs = await listWorkflowRuns(
          WORKFLOWS.hermesRelease,
          undefined,
          HERMES_REPO,
        );
        if (runs.length === 0) {
          ui.dim("  No workflow runs found");
        } else {
          for (const run of runs.slice(0, 5)) {
            const badge = ui.statusBadge(run.conclusion ?? run.status);
            console.log(`  ${badge} ${run.name} — ${run.created_at}`);
            ui.dim(`    ${run.html_url}`);
          }
        }
      } catch {
        ui.dim("  Could not fetch Hermes workflow runs");
      }
    } else {
      ui.dryRun("Would list recent Hermes workflow runs");
    }

    console.log();
    ui.success("Hermes release triggered!");
  });
