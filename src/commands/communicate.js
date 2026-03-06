// @flow

// `communicate` command — generate announcement templates

import { Command } from "commander";
import { ui } from "../utils/ui.js";
import {
  parseVersion,
  formatVersion,
  stableBranch,
} from "../utils/version.js";
import { DOCS } from "../docs.js";

function generateDiscordAnnouncement(
  version: string,
  branch: string,
  isRC: boolean,
): string {
  if (isRC) {
    return `🚀 **React Native ${version} Release Candidate**

A new release candidate is available!

\`\`\`
npm install react-native@${version}
\`\`\`

**What's in this RC:**
- [TODO: Add highlights from changelog]

**How to test:**
1. Create a new project: \`npx @react-native-community/cli init MyApp --version ${version}\`
2. Or upgrade: \`npx react-native upgrade ${version}\`

**Report issues:** https://github.com/facebook/react-native/issues

Branch: \`${branch}\``;
  }

  return `🎉 **React Native ${version} is now available!**

\`\`\`
npm install react-native@${version}
\`\`\`

**Highlights:**
- [TODO: Add highlights from changelog]

**Full changelog:** https://github.com/facebook/react-native/releases/tag/v${version}

**Upgrade guide:** https://react-native-community.github.io/upgrade-helper/?from=PREV_VERSION&to=${version}`;
}

function generateGitHubReleaseBody(
  version: string,
  branch: string,
  isRC: boolean,
): string {
  const prerelaseNote = isRC
    ? `> [!WARNING]
> This is a release candidate. It is not intended for production use.

`
    : "";

  return `${prerelaseNote}## Highlights

<!-- TODO: Add highlights -->

## Breaking Changes

<!-- TODO: Add breaking changes, if any -->

## Changelog

<!-- TODO: Link to full changelog -->

---

Install:
\`\`\`bash
npm install react-native@${version}
\`\`\`

Report issues: https://github.com/facebook/react-native/issues`;
}

function generateStatusMessage(
  version: string,
  branch: string,
  parsed: any,
): string {
  const major = parsed.major;
  const minor = parsed.minor;
  const rc = parsed.rc;
  const isRC = parsed.isPrerelease;
  const isRC0 = isRC && rc === 0;

  // Determine which CI job to watch based on version
  const ciJobName = minor >= 78
    ? "`test_ios_rntester`"
    : "`build_npm_package`";

  // Determine if this is a release that needs testing (RC0, RC1, RC4, or stable)
  const needsTesting = isRC0 || rc === 1 || rc === 4 || !isRC;
  const testingStep = needsTesting
    ? `* ⌛ (ONLY for RC0,1,4,stable) Test release → https://github.com/reactwg/react-native-releases/blob/main/docs/guide-release-testing.md
  * ⌛ <Tester Name>: https://github.com/reactwg/react-native-releases/issues/`
    : `* — (Skipped) Test release — not required for RC${String(rc)}`;

  return `# ${version}

* ⌛ Pick changes and push \`${branch}\`
* ⌛ Wait for ${ciJobName} to complete → https://github.com/facebook/react-native/actions
* ⌛ Verify that E2E tests are green → https://github.com/facebook/react-native/actions
${testingStep}
* ⌛ Publish release job → https://github.com/facebook/react-native/actions
* ⌛ Verify template: \`npx @react-native-community/cli init\` + \`build\` for iOS + Android
* ⌛ Verify upgrade helper → https://react-native-community.github.io/upgrade-helper/?from=PREV_VERSION&to=${version}
* ⌛ Verify Maven assets → https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/${version}
* ⌛ Generate changelog PR → https://github.com/facebook/react-native/pulls
* ⌛ Create GitHub release → https://github.com/facebook/react-native/releases/tag/v${version}
* ⌛ Communicate release to \`#releases-coordination\` on Discord
* ⌛ Communicate release to \`React Native Releases\` on Workplace (Meta internal)
* ⌛ Update GitHub project`;
}

function generateShortDiscordAnnouncement(version: string): string {
  return `📢 ${version} is out!

📦 Release tag: https://github.com/facebook/react-native/releases/tag/v${version}
📝 Changelog PR: https://github.com/facebook/react-native/pull/<PR_NUMBER>`;
}

export const communicateCommand: any = new Command("communicate")
  .description("Generate release announcement templates")
  .requiredOption("--version <version>", "Version to announce")
  .option(
    "--format <format>",
    "Announcement format: discord, discord-short, github, status, all",
    "all",
  )
  .option("--dry-run", "Show what would happen without making changes", false)
  .action(async (options: any) => {
    const parsed = parseVersion(options.version);
    if (!parsed) {
      ui.error(`Invalid version: ${options.version}`);
      process.exit(1);
    }

    const version = formatVersion(parsed);
    const branch = stableBranch(parsed);
    const isRC = parsed.isPrerelease;
    const format: string = options.format ?? "all";

    ui.header(`Announcement — ${version}`);
    ui.docRef(DOCS.communicate);

    if (format === "status" || format === "all") {
      ui.info("Release Status Message (for #release-crew Discord):");
      ui.divider();
      console.log(generateStatusMessage(version, branch, parsed));
      ui.divider();
      console.log();
    }

    if (format === "discord" || format === "all") {
      ui.info("Discord Announcement:");
      ui.divider();
      console.log(generateDiscordAnnouncement(version, branch, isRC));
      ui.divider();
      console.log();
    }

    if (format === "discord-short" || format === "all") {
      ui.info("Discord Short Announcement:");
      ui.divider();
      console.log(generateShortDiscordAnnouncement(version));
      ui.divider();
      console.log();
    }

    if (format === "github" || format === "all") {
      ui.info("GitHub Release Body:");
      ui.divider();
      console.log(generateGitHubReleaseBody(version, branch, isRC));
      ui.divider();
      console.log();
    }

    ui.dim("Copy the template above and customize the TODO sections.");
    ui.dim("Update ⌛ to ✅ as steps complete, or 🚨 if there's a problem.");
  });
