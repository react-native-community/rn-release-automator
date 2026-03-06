#!/usr/bin/env node
// @flow

// Entry point — CLI setup with commander + interactive menu

import { Command } from "commander";
import { ui, CancelPromptError } from "./utils/ui.js";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { cutBranchCommand } from "./commands/cut-branch.js";
import { prepareReleaseCommand } from "./commands/prepare-release.js";
import { publishCommand } from "./commands/publish.js";
import { testReleaseCommand } from "./commands/test-release.js";
import { communicateCommand } from "./commands/communicate.js";
import { createGithubProjectCommand } from "./commands/create-github-project.js";
import { verifyReleaseCommand } from "./commands/verify-release.js";
import { postPromotionCommand } from "./commands/post-promotion.js";

import chalk from "chalk";

const BANNER = `
${chalk.cyan("  ____                 _     _   _       _   _")}
${chalk.cyan(" |  _ \\ ___  __ _  ___| |_  | \\ | | __ _| |_(_)_   _____")}
${chalk.cyan(" | |_) / _ \\/ _` |/ __| __| |  \\| |/ _` | __| \\ \\ / / _ \\")}
${chalk.cyan(" |  _ <  __/ (_| | (__| |_  | |\\  | (_| | |_| |\\ V /  __/")}
${chalk.cyan(" |_| \\_\\___|\\__,_|\\___|\\__| |_| \\_|\\__,_|\\__|_| \\_/ \\___|")}
${chalk.bold.magenta("  ____      _                       ")}
${chalk.bold.magenta(" |  _ \\ ___| | ___  __ _ ___  ___   ")}
${chalk.bold.magenta(" | |_) / _ \\ |/ _ \\/ _` / __|/ _ \\  ")}
${chalk.bold.magenta(" |  _ <  __/ |  __/ (_| \\__ \\  __/  ")}
${chalk.bold.magenta(" |_| \\_\\___|_|\\___|\\__,_|___/\\___|  ")}
${chalk.yellow("     _         _                        _")}
${chalk.yellow("    / \\  _   _| |_ ___  _ __ ___   __ _| |_ ___  _ __")}
${chalk.yellow("   / _ \\| | | | __/ _ \\| '_ ` _ \\ / _` | __/ _ \\| '__|")}
${chalk.yellow("  / ___ \\ |_| | || (_) | | | | | | (_| | || (_) | |")}
${chalk.yellow(" /_/   \\_\\__,_|\\__\\___/|_| |_| |_|\\__,_|\\__\\___/|_|")}

  ${chalk.dim("v0.1.0")}  ${chalk.cyan("⚛️  React Native Release Crew Toolkit")}
`;

const program = new Command();

program
  .name("rn-release-automator")
  .description("Automate the React Native release process")
  .version("0.1.0", "-V, --cli-version")
  .option("--dry-run", "Preview actions without making changes");

program.addCommand(initCommand);
program.addCommand(statusCommand);
program.addCommand(cutBranchCommand);
program.addCommand(prepareReleaseCommand);
program.addCommand(publishCommand);
program.addCommand(testReleaseCommand);
program.addCommand(communicateCommand);
program.addCommand(createGithubProjectCommand);
program.addCommand(verifyReleaseCommand);
program.addCommand(postPromotionCommand);

// Interactive menu when no command is given
async function interactiveMenu(dryRun: boolean): Promise<void> {
  console.log(BANNER);

  ui.setDryRun(dryRun);

  if (dryRun) {
    ui.dryRun("Dry-run mode enabled — no changes will be made");
    console.log();
  }

  const tips = [
    "Tip: Use --dry-run to preview any command without side effects",
    "Tip: Press Escape to go back to this menu from any prompt",
    "Tip: You can run commands directly, e.g. rn-release-automator status --series 0.85",
    "Fun fact: React Native 0.1 was released on March 26, 2015",
    "Fun fact: The ⚛️ symbol represents an atom, just like React!",
    "Remember: Always test before you ship! 🧪",
    "Pro tip: Keep #release-crew on Discord updated with your progress",
    "Fun fact: Hermes was named after the Greek messenger god 🏛️",
  ];
  const tip = tips[Math.floor(Math.random() * tips.length)];
  console.log(chalk.dim(`  💡 ${tip}`));
  console.log();

  const choices = [
    {
      name: "🔍 Init — check environment setup",
      value: "init",
    },
    {
      name: "📊 Status — show release overview",
      value: "status",
    },
    {
      name: "✂️  Cut Branch — create stable branch for RC0",
      value: "cut-branch",
    },
    {
      name: "📋 Create GitHub Project — set up a project for a new release",
      value: "create-github-project",
    },
    {
      name: "🍒 Prepare Release — cherry-pick and prepare the branch",
      value: "prepare-release",
    },
    {
      name: "🚀 Publish — trigger and monitor publish pipeline",
      value: "publish",
    },
    {
      name: "🧪 Test Release — run local tests",
      value: "test-release",
    },
    {
      name: "✅ Verify Release — post-release verification checklist",
      value: "verify-release",
    },
    {
      name: "🎉 Post-Promotion — update website, blog, support policy",
      value: "post-promotion",
    },
    {
      name: "📢 Communicate — generate announcement templates",
      value: "communicate",
    },
  ];

  const dryRunArgs = dryRun ? ["--dry-run"] : [];

  while (true) {
    const command = await ui.search("What would you like to do?", choices);

    try {
      if (command === "init") {
        await program.parseAsync([
          "node", "rn-release-automator", command, ...dryRunArgs,
        ]);
      } else if (command === "status") {
        const mode = await ui.search("Status mode:", [
          { name: "Overview — list all supported versions", value: "overview" },
          { name: "Series — details for a specific release series", value: "series" },
        ]);
        if (mode === "series") {
          const series = await ui.input("Enter release series (e.g., 0.85):");
          await program.parseAsync([
            "node", "rn-release-automator", command, "--series", series, ...dryRunArgs,
          ]);
        } else {
          await program.parseAsync([
            "node", "rn-release-automator", command, ...dryRunArgs,
          ]);
        }
      } else if (command === "cut-branch" || command === "prepare-release" || command === "create-github-project" || command === "verify-release" || command === "post-promotion") {
        const series = await ui.input("Enter release series (e.g., 0.85):");
        await program.parseAsync([
          "node", "rn-release-automator", command, "--series", series, ...dryRunArgs,
        ]);
      } else {
        const version = await ui.input(
          "Enter target version (e.g., 0.85.0-rc.0):",
        );
        await program.parseAsync([
          "node", "rn-release-automator", command, "--version", version, ...dryRunArgs,
        ]);
      }
      break;
    } catch (err) {
      if (err instanceof CancelPromptError) {
        // User pressed Escape — go back to the menu
        console.log();
        continue;
      }
      throw err;
    }
  }
}

// Detect if --dry-run is passed at the top level (with or without a command)
const hasDryRun = process.argv.includes("--dry-run");
const argsWithoutDryRun = process.argv.filter((a) => a !== "--dry-run");
const hasCommand = argsWithoutDryRun.length > 2;

if (!hasCommand) {
  interactiveMenu(hasDryRun).catch((err: Error) => {
    ui.error(err.message);
    process.exit(1);
  });
} else {
  if (hasDryRun) {
    ui.setDryRun(true);
  }
  program.parseAsync(process.argv).catch((err: Error) => {
    ui.error(err.message);
    process.exit(1);
  });
}
