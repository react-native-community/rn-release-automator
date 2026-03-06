// @flow

// `init` command — environment validation

import { Command } from "commander";
import { execSync } from "child_process";
import { ui } from "../utils/ui.js";
import { runPreflight } from "../utils/preflight.js";
import { getOctokit } from "../utils/github.js";

const BOT_MERGER_URL =
  "https://github.com/reactwg/react-native-releases/blob/main/.github/workflows/react-native-bot-merger.yml";

async function getAllowedBotUsers(): Promise<Array<string>> {
  try {
    const octokit = getOctokit();
    const { data } = await octokit.repos.getContent({
      owner: "reactwg",
      repo: "react-native-releases",
      path: ".github/workflows/react-native-bot-merger.yml",
    });
    const content = Buffer.from(data.content, "base64").toString("utf8");
    const match = content.match(/const allowedUsers = \[([\s\S]*?)\]/);
    if (!match) return [];
    const usernames = match[1].match(/'([^']+)'/g) ?? [];
    return usernames.map((u) => u.replace(/'/g, ""));
  } catch {
    return [];
  }
}

function getCurrentGitHubUser(): string | null {
  try {
    return execSync("gh api user -q .login", {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

export const initCommand: any = new Command("init")
  .description("Validate that the environment is properly set up")
  .action(async () => {
    ui.header("Release Automator — Environment Check");

    const spinner = ui.spinner("Running preflight checks...");
    const preflight = await runPreflight();
    spinner.stop();

    for (const check of preflight.checks) {
      if (check.passed) {
        ui.success(`${check.name}: ${check.message}`);
      } else if (check.required) {
        ui.error(`${check.name}: ${check.message}`);
      } else {
        ui.warn(`${check.name}: ${check.message}`);
      }
    }

    console.log();

    // Check if the current user is in the bot merger allowed list
    ui.info("Checking bot merger access...");
    const currentUser = getCurrentGitHubUser();
    if (currentUser) {
      const allowedUsers = await getAllowedBotUsers();
      if (allowedUsers.length === 0) {
        ui.warn("Could not fetch allowed users list");
      } else if (allowedUsers.includes(currentUser)) {
        ui.success(`@${currentUser} is in the @react-native-bot allowed list`);
      } else {
        ui.warn(`@${currentUser} is NOT in the @react-native-bot allowed list`);
        ui.dim("  You won't be able to use the bot merge command during prepare-release.");
        ui.dim(`  Ask to be added: ${BOT_MERGER_URL}`);
      }
    } else {
      ui.warn("Could not determine your GitHub username (gh api user failed)");
    }

    console.log();

    if (preflight.ok) {
      ui.success("⚛️  Environment is ready. You're good to go!");
    } else {
      ui.error("Preflight checks failed. Fix the issues above and retry.");
      process.exit(1);
    }
  });
