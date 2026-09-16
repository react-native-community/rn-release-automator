// @flow

// `hermes` command and shared Hermes release guidance.

import { Command } from "commander";
import { execSync } from "child_process";
import { ui } from "../utils/ui.js";
import {
  parseVersion,
  formatVersion,
  stableBranch,
} from "../utils/version.js";
import type { ParsedVersion } from "../utils/version.js";
import {
  getBranch,
  getRepoFileContent,
  listBranches,
} from "../utils/github.js";
import {
  createHermesReleasePlan,
  getHermesBumpCommand,
  getHermesBumpFiles,
  validateHermesTag,
  HERMES_VERSION_PROPERTIES_PATH,
} from "../utils/hermes.js";
import type {
  HermesReleasePlan,
  HermesReleaseTags,
} from "../utils/hermes.js";
import {
  currentBranch,
  isInsideReactNativeRepo,
} from "../utils/git.js";
import { HERMES_REPO, WORKFLOWS } from "../config.js";
import { DOCS } from "../docs.js";

const HERMES_PUBLISH_SCRIPT = "utils/scripts/hermes/publish-npm.js";

export type PreparedHermesRelease = {
  plan: HermesReleasePlan,
  tags: HermesReleaseTags,
  reactNativeBranch: string,
};

function openUrl(url: string): void {
  try {
    execSync(`open "${url}"`, { stdio: "ignore", timeout: 5000 });
  } catch {
    try {
      execSync(`xdg-open "${url}"`, { stdio: "ignore", timeout: 5000 });
    } catch {
      // The URL is printed as a fallback.
    }
  }
}

function runCommand(command: string): boolean {
  try {
    execSync(command, { stdio: "inherit", timeout: 120000 });
    return true;
  } catch {
    return false;
  }
}

async function getLatestV1Control(
  branch: string,
): Promise<"input" | "automatic" | "unknown"> {
  try {
    const workflow = await getRepoFileContent(
      `.github/workflows/${WORKFLOWS.hermesRelease}`,
      branch,
      HERMES_REPO,
    );
    if (/^\s+update-latest-v1:/m.test(workflow)) {
      return "input";
    }

    const publishScript = await getRepoFileContent(
      HERMES_PUBLISH_SCRIPT,
      branch,
      HERMES_REPO,
    );
    if (/--tag latest-v1/.test(publishScript)) {
      return "automatic";
    }
  } catch {
    // The user still gets the safe, explicit fallback guidance below.
  }
  return "unknown";
}

async function resolveHermesReleasePlan(
  version: ParsedVersion,
  sourceRef: string,
): Promise<HermesReleasePlan> {
  const [properties, branches] = await Promise.all([
    getRepoFileContent(HERMES_VERSION_PROPERTIES_PATH, sourceRef),
    listBranches(HERMES_REPO, 100),
  ]);
  const plan = createHermesReleasePlan(
    version,
    properties,
    branches.map((branch) => branch.name),
  );

  const requiredBranches = [plan.v1Branch];
  if (plan.legacyBranch) requiredBranches.push(plan.legacyBranch);
  for (const branch of requiredBranches) {
    try {
      await getBranch(branch, HERMES_REPO);
    } catch {
      throw new Error(`Required Hermes branch ${branch} does not exist`);
    }
  }

  return plan;
}

async function promptForTag(message: string): Promise<string> {
  const tag = (await ui.input(message)).trim();
  if (!validateHermesTag(tag)) {
    throw new Error(
      `Invalid Hermes tag "${tag}". Expected a tag beginning with hermes-v.`,
    );
  }
  return tag;
}

export async function prepareHermesRelease(
  version: ParsedVersion,
  sourceRef: string,
  dryRun: boolean,
): Promise<PreparedHermesRelease> {
  const plan = await resolveHermesReleasePlan(version, sourceRef);
  const workflowUrl =
    `https://github.com/facebook/hermes/actions/workflows/${WORKFLOWS.hermesRelease}`;
  const guideAnchor = plan.mode === "v1"
    ? "#for-react-native--087"
    : "#for-react-native-083--x--087";
  const guideUrl = `${DOCS.hermes}${guideAnchor}`;
  const latestV1Control = await getLatestV1Control(plan.v1Branch);

  ui.table([
    ["Mode", plan.mode === "v1" ? "Hermes V1 only" : "Legacy + Hermes V1"],
    ["Hermes V1 branch", plan.v1Branch],
    ["Update latest-v1", plan.updateLatestV1 ? "yes" : "no"],
  ]);
  if (plan.legacyBranch) {
    ui.table([["Legacy branch", plan.legacyBranch]]);
  }
  console.log();

  ui.info("Hermes publishing is a manual, Meta-only prerequisite.");
  ui.dim(`  Guide: ${guideUrl}`);
  ui.dim(`  Workflow: ${workflowUrl}`);
  console.log();

  if (plan.mode === "dual") {
    ui.info(`Run the workflow with release type Release on ${plan.legacyBranch ?? "the legacy branch"}.`);
    ui.info(`Run it again with release type Release on ${plan.v1Branch}.`);
  } else {
    ui.info(`Run the workflow with release type Release on ${plan.v1Branch}.`);
  }

  if (latestV1Control === "input") {
    ui.info(
      plan.updateLatestV1
        ? "Check Update latest-v1 because this is the newest Hermes train."
        : "Leave Update latest-v1 unchecked because this is a maintenance train.",
    );
  } else if (latestV1Control === "automatic" && plan.updateLatestV1) {
    ui.info("This train updates latest-v1 automatically; no checkbox is shown.");
  } else {
    ui.warn(
      `Could not confirm latest-v1 behavior for ${plan.v1Branch}; verify it before publishing.`,
    );
  }
  console.log();

  if (!dryRun) {
    const action = await ui.search("Open the Hermes release resources?", [
      { name: "Open workflow", value: "workflow" },
      { name: "Open guide", value: "guide" },
      { name: "Continue without opening", value: "continue" },
    ]);
    if (action === "workflow") openUrl(workflowUrl);
    if (action === "guide") openUrl(guideUrl);
  } else {
    ui.dryRun("Would open the Hermes workflow or release guide");
  }

  const legacyTag = plan.mode === "dual"
    ? await promptForTag("Enter the legacy Hermes tag (e.g., hermes-v0.17.0):")
    : null;
  const v1Tag = await promptForTag(
    "Enter the Hermes V1 tag (e.g., hermes-v260318099.0.2):",
  );

  return {
    plan,
    tags: { legacyTag, v1Tag },
    reactNativeBranch: stableBranch(version),
  };
}

export async function bumpHermesVersion(
  prepared: PreparedHermesRelease,
  dryRun: boolean,
): Promise<void> {
  const command = getHermesBumpCommand(prepared.plan, prepared.tags);
  const files = getHermesBumpFiles(prepared.plan);
  const commitCommand =
    `git add ${files.join(" ")} && git commit -m "Bump hermes version" && git push`;

  ui.info("Hermes bump command:");
  ui.dim(`  ${command}`);
  console.log();

  if (dryRun) {
    ui.dryRun(`Would run: ${command}`);
    ui.dryRun(`Would run: ${commitCommand}`);
    return;
  }

  if (!isInsideReactNativeRepo()) {
    throw new Error(
      "The Hermes bump must run from a react/react-native or facebook/react-native checkout",
    );
  }
  if (currentBranch() !== prepared.reactNativeBranch) {
    throw new Error(
      `The Hermes bump must run on ${prepared.reactNativeBranch}`,
    );
  }

  const proceed = await ui.confirm("Run the Hermes bump command?");
  if (!proceed) {
    ui.dim("  Skipped — run the command above manually");
    return;
  }

  if (!runCommand(command)) {
    ui.warn("Hermes bump failed. Run the command above manually.");
    return;
  }
  ui.success("Hermes version bumped");

  ui.info("Committing and pushing the Hermes version bump...");
  if (runCommand(commitCommand)) {
    ui.success("Hermes version bump committed and pushed");
  } else {
    ui.warn("Could not commit or push. Run manually:");
    ui.dim(`  git add ${files.join(" ")}`);
    ui.dim('  git commit -m "Bump hermes version"');
    ui.dim("  git push");
  }
}

export const hermesCommand: any = new Command("hermes")
  .description("Guide a Hermes release and update the React Native branch")
  .requiredOption("--version <version>", "React Native version for the Hermes release")
  .option("--dry-run", "Show what would happen without making changes", false)
  .action(async (options: any) => {
    const dryRun: boolean = options.dryRun || ui._dryRunMode;
    const parsed = parseVersion(options.version);
    if (!parsed) {
      ui.error(`Invalid version: ${options.version}`);
      process.exit(1);
      return;
    }

    const version = formatVersion(parsed);
    const sourceRef = stableBranch(parsed);
    ui.header(`Hermes Release — ${version}`);
    ui.docRef(DOCS.hermes);

    try {
      const prepared = await prepareHermesRelease(parsed, sourceRef, dryRun);
      await bumpHermesVersion(prepared, dryRun);
      console.log();
      ui.success("Hermes release preparation complete!");
    } catch (error: any) {
      ui.error(error.message ?? "Could not prepare the Hermes release");
      process.exit(1);
    }
  });
