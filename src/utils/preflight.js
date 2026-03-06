// @flow

// Pre-flight checks for environment validation

import { execSync } from "child_process";
import type { PreflightResult, PreflightCheck } from "../types.js";
import { getOctokit, getRepoInfo } from "./github.js";
import { REACT_NATIVE_REPO, HERMES_REPO, RN_COMMUNITY_RELEASES_REPO } from "../config.js";

const TEMPLATE_REPO = { owner: "react-native-community", repo: "template" };

function checkCommand(name: string, cmd: string): PreflightCheck {
  try {
    const output = execSync(cmd, { encoding: "utf8", timeout: 10000 }).trim();
    return { name, passed: true, message: output, required: true };
  } catch {
    return { name, passed: false, message: `${name} not found`, required: true };
  }
}

async function checkRepoAccess(
  repo: {owner: string, repo: string},
): Promise<PreflightCheck> {
  const fullName = `${repo.owner}/${repo.repo}`;
  try {
    const info = await getRepoInfo(repo);
    const perms = info.permissions;
    const canPush = perms?.push ?? false;
    return {
      name: `GitHub: ${fullName}`,
      passed: true,
      message: canPush ? "push access" : "read-only",
      required: true,
    };
  } catch (err: any) {
    return {
      name: `GitHub: ${fullName}`,
      passed: false,
      message: err.message ?? "Cannot access repository",
      required: true,
    };
  }
}

function checkGitHubToken(): PreflightCheck {
  if (process.env.GITHUB_TOKEN) {
    return {
      name: "GitHub token",
      passed: true,
      message: "GITHUB_TOKEN environment variable set",
      required: true,
    };
  }
  try {
    execSync("gh auth token", { encoding: "utf8", timeout: 5000 });
    return {
      name: "GitHub token",
      passed: true,
      message: "Using gh CLI token",
      required: true,
    };
  } catch {
    return {
      name: "GitHub token",
      passed: false,
      message: "No GitHub token found. Set GITHUB_TOKEN or run `gh auth login`",
      required: true,
    };
  }
}

function checkCleanWorkingTree(): PreflightCheck {
  try {
    const status = execSync("git status --porcelain", {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (status.length === 0) {
      return {
        name: "Clean working tree",
        passed: true,
        message: "Working tree is clean",
        required: false,
      };
    }
    return {
      name: "Clean working tree",
      passed: false,
      message: "Working tree has uncommitted changes",
      required: false,
    };
  } catch {
    return {
      name: "Clean working tree",
      passed: true,
      message: "Not in a git repository (ok for remote operations)",
      required: false,
    };
  }
}

export async function runPreflight(): Promise<PreflightResult> {
  const checks: Array<PreflightCheck> = [
    checkCommand("Node.js", "node --version"),
    checkCommand("npm", "npm --version"),
    checkCommand("git", "git --version"),
    checkCommand("gh CLI", "gh --version"),
    checkGitHubToken(),
    checkCleanWorkingTree(),
    await checkRepoAccess(REACT_NATIVE_REPO),
    await checkRepoAccess(HERMES_REPO),
    await checkRepoAccess(TEMPLATE_REPO),
    await checkRepoAccess(RN_COMMUNITY_RELEASES_REPO),
  ];

  const ok = checks
    .filter((c) => c.required)
    .every((c) => c.passed);

  return { ok, checks };
}
