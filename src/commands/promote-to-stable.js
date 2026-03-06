// @flow

// `post-promotion` command — interactive post-release verification checklist

import { Command } from "commander";
import chalk from "chalk";
import { execSync } from "child_process";
import { ui } from "../utils/ui.js";
import { getPublishedVersions, isVersionPublished } from "../utils/npm-utils.js";

const SERIES_PATTERN = /^(\d+)\.(\d+)$/;

function parseSeries(series: string): {major: number, minor: number} | null {
  const match = series.match(SERIES_PATTERN);
  if (!match) return null;
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
}

function runCommand(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: "inherit", timeout: 60000 });
    return true;
  } catch {
    return false;
  }
}

function openUrl(url: string): void {
  try {
    execSync(`open "${url}"`, { stdio: "ignore", timeout: 5000 });
  } catch {
    try {
      execSync(`xdg-open "${url}"`, { stdio: "ignore", timeout: 5000 });
    } catch {
      // can't open, user will use the printed link
    }
  }
}

export const postPromotionCommand: any = new Command("post-promotion")
  .description("Interactive post-release verification checklist")
  .requiredOption("--series <series>", "Release series (e.g., 0.85)")
  .action(async (options: any) => {
    const series = parseSeries(options.series);
    if (!series) {
      ui.error(`Invalid release series: ${options.series}. Expected format: 0.85`);
      process.exit(1);
      return;
    }

    const seriesPrefix = `${series.major}.${series.minor}.`;

    // Find the latest published version in this series
    const spinner = ui.spinner("Fetching latest version...");
    let version: string | null = null;
    let isStable = false;
    try {
      const allVersions = await getPublishedVersions();
      const seriesVersions = allVersions
        .filter((v) => v.startsWith(seriesPrefix) && !v.includes("-nightly"))
        .sort()
        .reverse();

      if (seriesVersions.length > 0) {
        version = seriesVersions[0];
        isStable = !version.includes("-rc.");
      }
    } catch (err: any) {
      spinner.stop();
      ui.error(`Could not fetch versions: ${err.message}`);
      process.exit(1);
      return;
    }
    spinner.stop();

    if (!version) {
      ui.error(`No published versions found for ${series.major}.${series.minor} series.`);
      process.exit(1);
      return;
    }

    ui.info(`Latest version: ${chalk.bold(version)}`);
    console.log();

    ui.header(`Post-Promotion Checklist — ${version}`);

    // 1. Verify npm publication
    console.log(chalk.bold(`  [1/8] Verify npm publication`));
    ui.dim(`     npm view react-native@${version}`);
    console.log();
    {
      const action = await ui.search("Verify npm?", [
        { name: "Run npm view now", value: "run" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "run") {
        const ok = runCommand(`npm view react-native@${version} version`);
        if (ok) {
          ui.success(`  react-native@${version} is on npm`);
        } else {
          ui.warn("  Could not verify — check manually");
        }
      } else {
        ui.dim("  Skipped");
      }
    }
    console.log();

    // 2. Verify template
    console.log(chalk.bold(`  [2/8] Verify template`));
    ui.dim(`     npx @react-native-community/cli init /tmp/TestApp --version ${version}`);
    ui.dim("     Build and run on iOS + Android");
    console.log();
    {
      const action = await ui.search("Verify template?", [
        { name: "Run init in /tmp/TestApp now", value: "run" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "run") {
        runCommand("rm -rf /tmp/TestApp");
        ui.info("  Running: npx @react-native-community/cli init /tmp/TestApp --version " + version);
        const ok = runCommand(`npx @react-native-community/cli init /tmp/TestApp --version ${version}`);
        if (ok) {
          ui.success("  Template created at /tmp/TestApp");
          ui.dim("  cd /tmp/TestApp && npx react-native run-ios");
          ui.dim("  cd /tmp/TestApp && npx react-native run-android");
        } else {
          ui.warn("  Template init failed — check the output above");
        }
      } else {
        ui.dim("  Skipped");
      }
    }
    console.log();

    // 3. Verify upgrade helper
    console.log(chalk.bold(`  [3/8] Verify upgrade helper`));
    {
      const url = "https://react-native-community.github.io/upgrade-helper/";
      ui.dim(`     ${url}`);
      console.log();
      const action = await ui.search("Verify upgrade helper?", [
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

    // 4. Verify Maven artifacts
    console.log(chalk.bold(`  [4/8] Verify Maven artifacts`));
    {
      const url = `https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/${version}`;
      ui.dim(`     ${url}`);
      console.log();
      const action = await ui.search("Verify Maven?", [
        { name: "Open in browser", value: "open" },
        { name: "Run curl check", value: "curl" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "open") {
        openUrl(url);
        ui.success("  Opened in browser");
      } else if (action === "curl") {
        const ok = runCommand(`curl -sfI "${url}/" > /dev/null`);
        if (ok) {
          ui.success("  Maven artifacts found:");
          const base = `https://repo1.maven.org/maven2/com/facebook/react`;
          ui.dim(`    ${base}/react-native-artifacts/${version}/`);
          ui.dim(`    ${base}/react-native-artifacts/${version}/react-native-artifacts-${version}-hermes-framework-dSYM-debug.tar.gz`);
          ui.dim(`    ${base}/react-native-artifacts/${version}/react-native-artifacts-${version}-hermes-framework-dSYM-release.tar.gz`);
          ui.dim(`    ${base}/react-android/${version}/`);
        } else {
          ui.warn("  Maven artifacts not found yet — may take a few minutes");
        }
      } else {
        ui.dim("  Skipped");
      }
    }
    console.log();

    // 5. Review and merge changelog PR
    console.log(chalk.bold(`  [5/8] Review and merge changelog PR`));
    {
      const url = "https://github.com/facebook/react-native/pulls?q=is%3Apr+is%3Aopen+%22%5BRN%5D%5BChangelog%5D%22+in%3Atitle";
      ui.dim(`     ${url}`);
      console.log();
      const action = await ui.search("Review changelog PR?", [
        { name: "Open PRs page in browser", value: "open" },
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

    // 6. Publish GitHub release
    console.log(chalk.bold(`  [6/8] Publish GitHub release`));
    {
      const url = `https://github.com/facebook/react-native/releases/tag/v${version}`;
      ui.dim(`     ${url}`);
      if (isStable) {
        ui.dim("     Mark as 'Latest release' (not pre-release)");
      } else {
        ui.dim("     Mark as 'Pre-release'");
      }
      console.log();
      const action = await ui.search("Open GitHub release?", [
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

    // 7. Communicate the release
    console.log(chalk.bold(`  [7/8] Communicate the release`));
    ui.dim(`     rn-release-automator communicate --version ${version}`);
    console.log();
    {
      const action = await ui.search("Generate announcements?", [
        { name: "Run communicate command now", value: "run" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "run") {
        runCommand(`node ${process.argv[1]} communicate --version ${version}`);
      } else {
        ui.dim("  Skipped");
      }
    }
    console.log();

    // 8. Update GitHub project
    console.log(chalk.bold(`  [8/8] Update GitHub project`));
    {
      // Try to find the project URL for this series
      let projectUrl = "https://github.com/orgs/reactwg/projects";
      try {
        const result = execSync(
          `gh api graphql -f query='{ organization(login: "reactwg") { projectsV2(first: 20, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { title url } } } }'`,
          { encoding: "utf8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"] },
        );
        const data = JSON.parse(result);
        const projects = data?.data?.organization?.projectsV2?.nodes ?? [];
        const match = projects.find((p: any) =>
          p.title.includes(`0.${series.minor}`) || p.title.includes(`${series.major}.${series.minor}`),
        );
        if (match) {
          projectUrl = match.url;
        }
      } catch {
        // fallback to generic URL
      }

      ui.dim("     Close resolved pick requests and update project status");
      ui.dim(`     ${projectUrl}`);
      console.log();
      const action = await ui.search("Open GitHub project?", [
        { name: "Open in browser", value: "open" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "open") {
        openUrl(projectUrl);
        ui.success("  Opened in browser");
      } else {
        ui.dim("  Skipped");
      }
    }

    console.log();
    ui.success("Post-promotion checklist complete!");
  });
