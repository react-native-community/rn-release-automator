// @flow

// `status` command — release status overview

import { Command } from "commander";
import chalk from "chalk";
import { ui } from "../utils/ui.js";
import {
  getBranch,
  listWorkflowRuns,
  listReleases,
  listBranches,
  listPickRequests,
} from "../utils/github.js";
import { getDistTags, getPublishedVersions } from "../utils/npm-utils.js";
import { WORKFLOWS, RELEASE_SCHEDULE } from "../config.js";

const SERIES_PATTERN = /^(\d+)\.(\d+)$/;
const STABLE_BRANCH_PATTERN = /^(\d+)\.(\d+)-stable$/;

function parseSeries(series: string): {major: number, minor: number} | null {
  const match = series.match(SERIES_PATTERN);
  if (!match) return null;
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
}

async function showOverview(): Promise<void> {
  ui.header("Release Status — Overview");

  // Fetch stable branches
  const spinner = ui.spinner("Fetching supported versions...");
  let stableBranches: Array<{name: string, major: number, minor: number}> = [];
  try {
    const branches = await listBranches();
    stableBranches = branches
      .map((b) => {
        const match = b.name.match(STABLE_BRANCH_PATTERN);
        if (!match) return null;
        return {
          name: b.name,
          major: parseInt(match[1], 10),
          minor: parseInt(match[2], 10),
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.major !== b.major) return b.major - a.major;
        return b.minor - a.minor;
      });
  } catch (err: any) {
    spinner.stop();
    ui.error(`Could not fetch branches: ${err.message}`);
    return;
  }

  // Fetch npm data
  let distTags: {[string]: string} = {};
  let allVersions: Array<string> = [];
  try {
    distTags = await getDistTags();
    allVersions = await getPublishedVersions();
  } catch {
    // non-fatal, we'll just show less info
  }

  // Fetch pending picks
  let picksBySeries: {[string]: number} = {};
  try {
    const picks = await listPickRequests();
    for (const pick of picks) {
      if (pick.series) {
        picksBySeries[pick.series] = (picksBySeries[pick.series] ?? 0) + 1;
      }
    }
  } catch {
    // non-fatal
  }
  spinner.stop();

  // Show dist-tags
  if (Object.keys(distTags).length > 0) {
    ui.info("npm dist-tags");
    ui.table([
      ["latest", String(distTags.latest ?? "unknown")],
      ["next", String(distTags.next ?? "none")],
    ]);
    console.log();
  }

  // Show table of supported versions
  // Support tiers: latest 3 stable series are supported.
  // - "Future": has RCs but no stable release yet
  // - "Active": the latest stable series
  // - "End of Cycle": 2nd and 3rd latest stable series
  // - "Unsupported": everything older

  const latestVersion = distTags.latest ?? "";

  // Classify each branch
  type BranchInfo = {
    major: number,
    minor: number,
    latest: string,
    rcOnly: boolean,
    pickCount: number,
  };

  const branchInfos: Array<BranchInfo> = stableBranches.slice(0, 30).map((branch) => {
    const prefix = `${branch.major}.${branch.minor}.`;
    const versions = allVersions
      .filter((v) => v.startsWith(prefix) && !v.includes("-nightly"))
      .sort()
      .reverse();

    const stableVersions = versions.filter((v) => !v.includes("-rc."));
    const rcVersions = versions.filter((v) => v.includes("-rc."));
    const latest = stableVersions[0] ?? rcVersions[0] ?? "—";
    const rcOnly = stableVersions.length === 0 && rcVersions.length > 0;
    const seriesKey = `${branch.major}.${branch.minor}`;
    const pickCount = picksBySeries[seriesKey] ?? 0;

    return { major: branch.major, minor: branch.minor, latest, rcOnly, pickCount };
  });

  // Split into future (RC-only) and has-stable
  const futureVersions = branchInfos.filter((b) => b.rcOnly);
  const stableVersionsList = branchInfos.filter((b) => !b.rcOnly && b.latest !== "—");
  // The rest (no versions at all) are ignored

  // Active = 1st stable, 2nd stable also active, End of Cycle = 3rd, Unsupported = rest
  const active = stableVersionsList.slice(0, 2);
  const endOfCycle = stableVersionsList.slice(2, 3);
  const unsupported = stableVersionsList.slice(3, 10);

  function printRow(b: BranchInfo, badge: string) {
    const seriesLabel = chalk.bold(`${b.major}.${b.minor}`);
    const versionLabel = b.rcOnly ? chalk.yellow(b.latest) : chalk.green(b.latest);
    const picksLabel = b.pickCount > 0
      ? chalk.red(`  ${b.pickCount} pick${b.pickCount === 1 ? "" : "s"}`)
      : "";
    console.log(`  ${seriesLabel}  ${versionLabel}  ${badge}${picksLabel}`);
  }

  // Collect all known future minors (from schedule) that don't have a branch yet
  const today = new Date().toISOString().slice(0, 10);
  const existingMinors = new Set(branchInfos.map((b) => b.minor));
  const scheduledFuture = RELEASE_SCHEDULE.filter(
    (s) => !existingMinors.has(s.minor),
  ).sort((a, b) => a.minor - b.minor);

  // Show future versions with schedule info
  if (futureVersions.length > 0 || scheduledFuture.length > 0) {
    ui.info("Future");

    // Scheduled versions without branches yet
    for (const s of scheduledFuture) {
      const schedule = RELEASE_SCHEDULE.find((r) => r.minor === s.minor);
      const dateInfo = schedule
        ? chalk.dim(`  branch cut: ${schedule.branchCut}  release: ${schedule.release}`)
        : "";
      console.log(`  ${chalk.bold(`0.${s.minor}`)}  ${chalk.dim("—")}  ${chalk.bgGray.white(" SCHEDULED ")}${dateInfo}`);
    }

    // Versions with RCs already
    for (const b of futureVersions) {
      const schedule = RELEASE_SCHEDULE.find((r) => r.minor === b.minor);
      const dateInfo = schedule
        ? chalk.dim(`  release: ${schedule.release}`)
        : "";
      const seriesLabel = chalk.bold(`${b.major}.${b.minor}`);
      const versionLabel = chalk.yellow(b.latest);
      const picksLabel = b.pickCount > 0
        ? chalk.red(`  ${b.pickCount} pick${b.pickCount === 1 ? "" : "s"}`)
        : "";
      console.log(`  ${seriesLabel}  ${versionLabel}  ${chalk.bgCyan.black(" RC ")}${picksLabel}${dateInfo}`);
    }
    console.log();
  }

  if (active.length > 0) {
    ui.info("Active");
    for (const b of active) {
      printRow(b, chalk.bgGreen.black(" LATEST "));
    }
    console.log();
  }

  if (endOfCycle.length > 0) {
    ui.info("End of Cycle");
    for (const b of endOfCycle) {
      printRow(b, chalk.bgYellow.black(" EoC "));
    }
    console.log();
  }

  if (unsupported.length > 0) {
    ui.info("Unsupported");
    for (const b of unsupported) {
      printRow(b, chalk.bgGray.white(" EOL "));
    }
    console.log();
  }

  ui.dim("Run `status --series <X.Y>` for details on a specific series.");
}

async function showSeriesStatus(
  seriesStr: string,
  dryRun: boolean,
): Promise<void> {
  const series = parseSeries(seriesStr);
  if (!series) {
    ui.error(`Invalid release series: ${seriesStr}. Expected format: 0.85`);
    process.exit(1);
    return;
  }

  const branch = `${series.major}.${series.minor}-stable`;
  const seriesPrefix = `${series.major}.${series.minor}.`;

  ui.header(`Release Status — ${series.major}.${series.minor} series`);

  if (dryRun) {
    ui.dryRun("Would fetch branch, CI, npm, and release data");
    return;
  }

  // Branch status
  ui.info("Branch");
  try {
    const branchData = await getBranch(branch);
    ui.table([
      ["Branch", branch],
      ["HEAD", branchData.commit.sha.slice(0, 8)],
      ["Protected", branchData.protected ? "yes" : "no"],
    ]);
  } catch {
    ui.warn(`Branch ${branch} not found`);
  }

  console.log();

  // CI status
  ui.info("CI — Recent workflow runs");
  try {
    const runs = await listWorkflowRuns(
      WORKFLOWS.createRelease,
      branch,
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
  } catch (err: any) {
    ui.warn(`Could not fetch CI runs: ${err.message}`);
  }

  console.log();

  // npm status — show all published versions in this series
  ui.info("npm");
  try {
    const tags = await getDistTags();
    ui.table([
      ["latest", String(tags.latest ?? "unknown")],
      ["next", String(tags.next ?? "none")],
    ]);

    const allVersions = await getPublishedVersions();
    const seriesVersions = allVersions
      .filter((v) => v.startsWith(seriesPrefix) && !v.includes("-nightly"))
      .sort()
      .reverse();

    if (seriesVersions.length > 0) {
      console.log();
      ui.info(`Published versions in ${series.major}.${series.minor} series`);
      for (const v of seriesVersions) {
        const isRC = v.includes("-rc.");
        const label = isRC ? chalk.yellow(v) : chalk.green(v);
        console.log(`  ${label}`);
      }
    } else {
      ui.dim(`  No published versions in ${series.major}.${series.minor} series`);
    }
  } catch (err: any) {
    ui.warn(`Could not fetch npm data: ${err.message}`);
  }

  console.log();

  // GitHub releases
  ui.info("GitHub Releases");
  try {
    const releases = await listReleases();
    const matching = releases.filter(
      (r) => r.tag_name.startsWith(`v${series.major}.${series.minor}`),
    );
    if (matching.length === 0) {
      ui.dim("  No matching releases found");
    } else {
      for (const rel of matching.slice(0, 5)) {
        const pre = rel.prerelease ? " (pre-release)" : "";
        ui.table([[rel.tag_name, `${rel.created_at}${pre}`]]);
      }
    }
  } catch (err: any) {
    ui.warn(`Could not fetch releases: ${err.message}`);
  }

  console.log();

  // Pending pick requests
  ui.info("Pending Picks");
  try {
    const allPicks = await listPickRequests();
    const seriesKey = `${series.major}.${series.minor}`;
    const seriesPicks = allPicks.filter((p) => p.series === seriesKey);

    if (seriesPicks.length === 0) {
      ui.dim("  No pending pick requests");
    } else {
      console.log(`  ${chalk.yellow(`${seriesPicks.length}`)} pending pick${seriesPicks.length === 1 ? "" : "s"}:`);
      console.log();
      for (const pick of seriesPicks) {
        const title = pick.title.replace(/^\[\d+\.\d+\]\s*/, "");
        console.log(`  ${chalk.cyan(`#${pick.number}`)} ${title} ${chalk.dim(`by @${pick.author}`)}`);
        ui.dim(`    ${pick.url}`);
      }
    }
  } catch (err: any) {
    ui.warn(`Could not fetch pick requests: ${err.message}`);
  }
}

export const statusCommand: any = new Command("status")
  .description("Show release status overview")
  .option("--series <series>", "Release series (e.g., 0.85)")
  .option("--dry-run", "Show what would happen without making changes", false)
  .action(async (options: any) => {
    const dryRun: boolean = options.dryRun || ui._dryRunMode;

    if (options.series) {
      await showSeriesStatus(options.series, dryRun);
    } else {
      await showOverview();
    }
  });
