// @flow

// `create-github-project` command — set up a GitHub Project for a new release

import { Command } from "commander";
import chalk from "chalk";
import { execSync } from "child_process";
import { ui } from "../utils/ui.js";
import { RELEASE_SCHEDULE } from "../config.js";
import { DOCS } from "../docs.js";

const SERIES_PATTERN = /^(\d+)\.(\d+)$/;

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

function parseSeries(series: string): {major: number, minor: number} | null {
  const match = series.match(SERIES_PATTERN);
  if (!match) return null;
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
}

function ghCommand(args: string): string | null {
  try {
    return execSync(`gh ${args}`, { encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (err: any) {
    return null;
  }
}

function ghGraphQL(query: string): any | null {
  try {
    const escaped = query.replace(/"/g, '\\"').replace(/\n/g, " ");
    const result = execSync(`gh api graphql -f query="${escaped}"`, {
      encoding: "utf8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(result);
  } catch {
    return null;
  }
}

async function listOrgProjects(): Promise<Array<{id: string, title: string, number: number, url: string}>> {
  const result = ghGraphQL(`
    query {
      organization(login: "reactwg") {
        projectsV2(first: 20, orderBy: {field: CREATED_AT, direction: DESC}) {
          nodes {
            id
            title
            number
            url
          }
        }
      }
    }
  `);
  if (!result?.data?.organization?.projectsV2?.nodes) return [];
  return result.data.organization.projectsV2.nodes;
}

async function copyProject(sourceProjectId: string, title: string): Promise<{id: string, url: string} | null> {
  const result = ghGraphQL(`
    mutation {
      copyProjectV2(input: {
        projectId: "${sourceProjectId}",
        ownerId: "${await getOrgId()}",
        title: "${title}",
        includeDraftIssues: false
      }) {
        projectV2 {
          id
          url
        }
      }
    }
  `);
  if (!result?.data?.copyProjectV2?.projectV2) return null;
  return result.data.copyProjectV2.projectV2;
}

async function getOrgId(): Promise<string> {
  const result = ghGraphQL(`
    query {
      organization(login: "reactwg") {
        id
      }
    }
  `);
  return result?.data?.organization?.id ?? "";
}

async function updateProjectVisibility(projectId: string, isPublic: boolean): Promise<boolean> {
  const result = ghGraphQL(`
    mutation {
      updateProjectV2(input: {
        projectId: "${projectId}",
        public: ${isPublic ? "true" : "false"}
      }) {
        projectV2 {
          id
        }
      }
    }
  `);
  return result?.data?.updateProjectV2?.projectV2 != null;
}

async function updateProjectDescription(projectId: string, description: string): Promise<boolean> {
  const escaped = description.replace(/"/g, '\\"').replace(/\n/g, "\\n");
  const result = ghGraphQL(`
    mutation {
      updateProjectV2(input: {
        projectId: "${projectId}",
        shortDescription: "${escaped}"
      }) {
        projectV2 {
          id
        }
      }
    }
  `);
  return result?.data?.updateProjectV2?.projectV2 != null;
}

function getProjectNumber(projectUrl: string): string | null {
  const match = projectUrl.match(/\/projects\/(\d+)/);
  return match ? match[1] : null;
}

async function clearProjectItems(projectNumber: string): Promise<number> {
  // List items via gh CLI
  let cleared = 0;
  try {
    const result = execSync(
      `gh project item-list ${projectNumber} --owner reactwg --format json -L 100`,
      { encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] },
    );
    const data = JSON.parse(result);
    const items = data.items ?? [];

    for (const item of items) {
      try {
        execSync(
          `gh project item-delete ${projectNumber} --owner reactwg --id ${item.id}`,
          { encoding: "utf8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"] },
        );
        cleared++;
      } catch {
        // skip failed deletions
      }
    }
  } catch {
    // failed to list items
  }
  return cleared;
}

export const createGithubProjectCommand: any = new Command("create-github-project")
  .description("Create a GitHub Project for a new release series")
  .requiredOption("--series <series>", "Release series (e.g., 0.85)")
  .option("--dry-run", "Show what would happen without making changes", false)
  .action(async (options: any) => {
    const dryRun: boolean = options.dryRun || ui._dryRunMode;

    const series = parseSeries(options.series);
    if (!series) {
      ui.error(`Invalid release series: ${options.series}. Expected format: 0.85`);
      process.exit(1);
      return;
    }

    const projectTitle = `React Native 0.${series.minor}`;

    ui.header(`Create GitHub Project — ${projectTitle}`);
    ui.docRef(DOCS.createGithubProject);

    // Verify gh CLI has project scope
    ui.step(1, 6, "Checking GitHub CLI permissions...");
    {
      const scopes = ghCommand("auth status");
      if (!scopes) {
        ui.error("GitHub CLI is not authenticated. Run: gh auth login");
        process.exit(1);
      }
      ui.success("GitHub CLI authenticated");

      // Check if we have project scope
      const projects = await listOrgProjects();
      if (projects.length === 0) {
        ui.warn("Cannot access reactwg projects. The 'project' scope is required.");
        console.log();
        const fix = await ui.confirm("Run 'gh auth refresh -s read:project,project' to add the scope?");
        if (fix) {
          const result = ghCommand("auth refresh -s read:project,project");
          if (result !== null) {
            ui.success("Scope added. Retrying...");
            const retry = await listOrgProjects();
            if (retry.length === 0) {
              ui.error("Still cannot access projects. Check your permissions manually.");
              process.exit(1);
            }
            ui.success(`Found ${retry.length} existing projects`);
          } else {
            ui.error("Failed to refresh auth. Run manually: gh auth refresh -s read:project,project");
            process.exit(1);
          }
        } else {
          ui.dim("  Run manually: gh auth refresh -s read:project,project");
          process.exit(1);
        }
      } else {
        ui.success(`Found ${projects.length} existing projects`);
      }
    }

    // Step 2: Select a project to clone
    ui.step(2, 6, "Selecting project to clone...");
    let sourceProject: {id: string, title: string, number: number, url: string};
    {
      const projects = await listOrgProjects();
      const choices = projects.map((p) => ({
        name: `${p.title} (#${p.number})`,
        value: String(p.number),
      }));

      const selected = await ui.search("Which project should we clone?", choices);
      const found = projects.find((p) => String(p.number) === selected);
      if (!found) {
        ui.error("Project not found");
        process.exit(1);
        return;
      }
      sourceProject = found;
      ui.success(`Will clone: ${sourceProject.title}`);
    }

    // Step 3: Clone the project
    ui.step(3, 6, `Cloning project as "${projectTitle}"...`);
    let newProject: {id: string, url: string} | null = null;
    if (!dryRun) {
      newProject = await copyProject(sourceProject.id, projectTitle);
      if (!newProject) {
        ui.error("Failed to clone project. Check permissions.");
        ui.dim("  You may need: gh auth refresh -s project");
        process.exit(1);
      }
      ui.success(`Project created: ${newProject.url}`);
    } else {
      ui.dryRun(`Would clone "${sourceProject.title}" as "${projectTitle}"`);
    }

    // Step 4: Set project description
    ui.step(4, 6, "Setting project description...");
    {
      const schedule = RELEASE_SCHEDULE.find((s) => s.minor === series.minor);
      const branchCut = schedule?.branchCut ?? "TBD";
      const release = schedule?.release ?? "TBD";

      const description = `React Native ${series.major}.${series.minor} release tracking. Branch cut: ${branchCut}. Target release: ${release}.`;

      if (!dryRun && newProject) {
        const ok = await updateProjectDescription(newProject.id, description);
        if (ok) {
          ui.success("Description updated");
        } else {
          ui.warn("Could not update description — update manually");
        }
      } else {
        ui.dryRun(`Would set description: ${description}`);
      }
    }

    // Step 5: Make project public
    ui.step(5, 6, "Making project public...");
    if (!dryRun && newProject) {
      const ok = await updateProjectVisibility(newProject.id, true);
      if (ok) {
        ui.success("Project is now public");
      } else {
        ui.warn("Could not set visibility — update manually in project settings");
      }
    } else {
      ui.dryRun("Would make project public");
    }

    // Step 6: Give the release crew access
    ui.step(6, 9, "Give the release crew access...");
    {
      ui.dim("  Go to project Settings > Manage access > Add collaborators");
      const settingsUrl = newProject ? `${newProject.url}/settings` : null;
      if (settingsUrl) {
        ui.dim(`  ${settingsUrl}`);
      }
      console.log();
      const action = await ui.search("Grant access?", [
        { name: "Open project settings in browser", value: "open" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "open" && settingsUrl) {
        openUrl(settingsUrl);
        ui.success("  Opened settings in browser");
      } else {
        ui.dim("  Skipped");
      }
    }

    // Step 7: Update project status
    ui.step(7, 9, "Update the project status...");
    {
      ui.dim("  Add release crew member names and GitHub profiles");
      ui.dim("  Set target dates: branch cut, RC, golden release, stable");
      console.log();
      const projectUrl = newProject?.url ?? null;
      const action = await ui.search("Update status?", [
        { name: "Open project in browser", value: "open" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "open" && projectUrl) {
        openUrl(projectUrl);
        ui.success("  Opened project in browser");
      } else {
        ui.dim("  Skipped");
      }
    }

    // Step 8: Enable auto-add workflow
    ui.step(8, 9, "Enable auto-add workflow...");
    {
      ui.dim("  GitHub requires this workflow to be manually enabled each time");
      const workflowsUrl = newProject ? `${newProject.url}/workflows` : null;
      if (workflowsUrl) {
        ui.dim(`  ${workflowsUrl}`);
      }
      console.log();
      const action = await ui.search("Enable workflow?", [
        { name: "Open project workflows in browser", value: "open" },
        { name: "Skip", value: "skip" },
      ]);
      if (action === "open" && workflowsUrl) {
        openUrl(workflowsUrl);
        ui.success("  Opened workflows in browser");
      } else {
        ui.dim("  Skipped");
      }
    }

    // Step 9: Clear cloned items
    ui.step(9, 9, "Clear cloned items...");
    {
      const projectNumber = newProject ? getProjectNumber(newProject.url) : null;

      if (!dryRun && projectNumber) {
        const action = await ui.search("Clear items copied from the previous project?", [
          { name: "Delete all cloned items now", value: "clear" },
          { name: "Skip", value: "skip" },
        ]);
        if (action === "clear") {
          const spinner = ui.spinner("Clearing items...");
          const cleared = await clearProjectItems(projectNumber);
          spinner.stop();
          if (cleared > 0) {
            ui.success(`  Cleared ${cleared} item${cleared === 1 ? "" : "s"}`);
          } else {
            ui.success("  No items to clear");
          }
        } else {
          ui.dim("  Skipped");
        }
      } else if (dryRun) {
        ui.dryRun("Would clear cloned items from the project");
      } else {
        ui.dim("  Skipped — could not determine project number");
      }
    }

    console.log();
    ui.success("📋 Project setup complete!");
    if (newProject) {
      ui.info(`Project URL: ${newProject.url}`);
    }
  });
