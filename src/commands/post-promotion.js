// @flow

// `post-promotion` command — post-stable-promotion tasks (website, blog, docs)

import { Command } from "commander";
import chalk from "chalk";
import { execSync } from "child_process";
import { ui } from "../utils/ui.js";
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

function generateReleasesTable(minor: number): string {
  const next = minor + 1;
  const prev1 = minor - 1;
  const prev2 = minor - 2;
  return [
    "| Version     | Type                       | Status           |",
    "| ----------- | -------------------------- | ---------------- |",
    `| 0.${next}.x${next < 100 ? "  " : " "}  | Next version               | Future           |`,
    `| 0.${minor}.x${minor < 100 ? "  " : " "}  | Latest stable              | Active           |`,
    `| 0.${prev1}.x${prev1 < 100 ? "  " : " "}  | Previous (-1) minor series | Active           |`,
    `| 0.${prev2}.x${prev2 < 100 ? "  " : " "}  | Previous (-2) minor series | End of Cycle     |`,
    `| <=0.${prev2 - 1}.x${(prev2 - 1) < 100 ? " " : ""}  | Old minor series           | Unsupported      |`,
  ].join("\n");
}

export const postPromotionCommand: any = new Command("post-promotion")
  .description("Post-stable-promotion tasks (support policy, blog, website)")
  .requiredOption("--series <series>", "Release series that was promoted (e.g., 0.85)")
  .action(async (options: any) => {
    const series = parseSeries(options.series);
    if (!series) {
      ui.error(`Invalid release series: ${options.series}. Expected format: 0.85`);
      process.exit(1);
      return;
    }

    const minor = series.minor;

    ui.header(`Post-Promotion — 0.${minor} series`);
    ui.docRef(DOCS.postPromotion);

    // 1. Update React Native support policy
    console.log(chalk.bold(`  [1/3] Update the React Native support policy`));
    console.log();
    ui.info("Update the releases table in react-native-website:");
    ui.dim("  File: website/src/components/releases/_releases-table.md");
    console.log();
    ui.info("New table:");
    console.log();
    const table = generateReleasesTable(minor);
    for (const line of table.split("\n")) {
      console.log(`  ${chalk.cyan(line)}`);
    }
    console.log();
    {
      const editUrl = "https://github.com/react/react-native-website/edit/main/website/src/components/releases/_releases-table.md";
      const action = await ui.search("Update support policy?", [
        { name: "Open file in GitHub editor", value: "open" },
        { name: "Copy table to clipboard", value: "copy" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "open") {
        openUrl(editUrl);
        ui.success("  Opened in browser — paste the table above");
      } else if (action === "copy") {
        try {
          execSync("pbcopy", {
            input: table,
            timeout: 5000,
            stdio: ["pipe", "pipe", "pipe"],
          });
          ui.success("  Table copied to clipboard");
        } catch {
          try {
            execSync("xclip -selection clipboard", {
              input: table,
              timeout: 5000,
              stdio: ["pipe", "pipe", "pipe"],
            });
            ui.success("  Table copied to clipboard");
          } catch {
            ui.warn("  Could not copy to clipboard — copy manually from above");
          }
        }
      } else {
        ui.dim("  Skipped");
      }
    }
    console.log();

    // 2. Ship blog post
    console.log(chalk.bold(`  [2/3] Ship blog post`));
    console.log();
    ui.info("Write and publish the release blog post.");
    ui.dim("  Blog posts live in: react-native-website/website/blog/");
    ui.dim(`  Title suggestion: "React Native 0.${minor} — [Highlights]"`);
    console.log();
    {
      const prsUrl = "https://github.com/react/react-native-website/pulls?q=sort%3Aupdated-desc+is%3Apr+is%3Aopen";
      const action = await ui.search("Blog post?", [
        { name: "Open website PRs page", value: "open" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "open") {
        openUrl(prsUrl);
        ui.success("  Opened in browser");
      } else {
        ui.dim("  Skipped");
      }
    }
    console.log();

    // 3. Update reactnative.dev and cut new version
    console.log(chalk.bold(`  [3/3] Update reactnative.dev and cut new website version`));
    console.log();
    ui.info("Steps:");
    ui.dim("  1. Ensure all relevant PRs for the release are merged in react-native-website");
    ui.dim("  2. Cut a new version of the website docs");
    console.log();
    {
      const prsUrl = "https://github.com/react/react-native-website/pulls?q=sort%3Aupdated-desc+is%3Apr+is%3Aopen";
      const instructionsUrl = "https://github.com/react/react-native-website#cutting-a-new-version";
      const action = await ui.search("Update website?", [
        { name: "Open website PRs page", value: "prs" },
        { name: "Open version-cutting instructions", value: "instructions" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "prs") {
        openUrl(prsUrl);
        ui.success("  Opened PRs page in browser");
      } else if (action === "instructions") {
        openUrl(instructionsUrl);
        ui.success("  Opened instructions in browser");
      } else {
        ui.dim("  Skipped");
      }
    }

    console.log();
    ui.success("🎉 Post-promotion checklist complete!");
  });
