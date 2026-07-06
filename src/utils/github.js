// @flow

// Octokit wrapper for GitHub Actions, Repos, and Projects APIs

import { Octokit } from "@octokit/rest";
import { execSync } from "child_process";
import { REACT_NATIVE_REPO, RN_COMMUNITY_RELEASES_REPO } from "../config.js";
import type { WorkflowRun } from "../types.js";

let _octokit: any = null;

function getToken(): string {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }
  try {
    return execSync("gh auth token", { encoding: "utf8" }).trim();
  } catch {
    throw new Error(
      "No GitHub token found. Set GITHUB_TOKEN or install gh CLI and run `gh auth login`.",
    );
  }
}

export function getOctokit(): any {
  if (!_octokit) {
    _octokit = new Octokit({ auth: getToken() });
  }
  return _octokit;
}

export async function triggerWorkflow(
  workflowFile: string,
  ref: string,
  inputs: {[string]: string},
  repo?: {owner: string, repo: string},
): Promise<void> {
  const target = repo ?? REACT_NATIVE_REPO;
  await getOctokit().actions.createWorkflowDispatch({
    ...target,
    workflow_id: workflowFile,
    ref,
    inputs,
  });
}

export async function listWorkflowRuns(
  workflowFile: string,
  branch?: string,
  repo?: {owner: string, repo: string},
): Promise<Array<WorkflowRun>> {
  const target = repo ?? REACT_NATIVE_REPO;
  const params: any = {
    ...target,
    workflow_id: workflowFile,
    per_page: 10,
  };
  if (branch) {
    params.branch = branch;
  }
  const { data } = await getOctokit().actions.listWorkflowRuns(params);
  return data.workflow_runs;
}

export async function getWorkflowRun(
  runId: number,
  repo?: {owner: string, repo: string},
): Promise<WorkflowRun> {
  const target = repo ?? REACT_NATIVE_REPO;
  const { data } = await getOctokit().actions.getWorkflowRun({
    ...target,
    run_id: runId,
  });
  return data;
}

export async function pollWorkflowRun(
  runId: number,
  onUpdate?: (run: WorkflowRun) => void,
  repo?: {owner: string, repo: string},
  intervalMs?: number,
): Promise<WorkflowRun> {
  const interval = intervalMs ?? 15000;
  while (true) {
    const run = await getWorkflowRun(runId, repo);
    if (onUpdate) onUpdate(run);

    if (run.status === "completed") {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  // Flow requires this even though it's unreachable
  throw new Error("Unreachable");
}

export async function createBranch(
  branchName: string,
  fromSha: string,
  repo?: {owner: string, repo: string},
): Promise<void> {
  const target = repo ?? REACT_NATIVE_REPO;
  await getOctokit().git.createRef({
    ...target,
    ref: `refs/heads/${branchName}`,
    sha: fromSha,
  });
}

export async function getBranch(
  branchName: string,
  repo?: {owner: string, repo: string},
): Promise<any> {
  const target = repo ?? REACT_NATIVE_REPO;
  const { data } = await getOctokit().repos.getBranch({
    ...target,
    branch: branchName,
  });
  return data;
}

// Resolve a commit-ish (full/short SHA, tag, or branch) to its commit data.
// Throws if the ref cannot be found.
export async function getCommit(
  ref: string,
  repo?: {owner: string, repo: string},
): Promise<any> {
  const target = repo ?? REACT_NATIVE_REPO;
  const { data } = await getOctokit().repos.getCommit({
    ...target,
    ref,
  });
  return data;
}

// Compare two refs. The returned `status` is one of
// "ahead" | "behind" | "identical" | "diverged", relative to `base`.
// `base` is an ancestor of `head` when status is "ahead" or "identical".
export async function compareRefs(
  base: string,
  head: string,
  repo?: {owner: string, repo: string},
): Promise<any> {
  const target = repo ?? REACT_NATIVE_REPO;
  const { data } = await getOctokit().repos.compareCommits({
    ...target,
    base,
    head,
  });
  return data;
}

export async function createRelease(
  tagName: string,
  name: string,
  body: string,
  prerelease: boolean,
  repo?: {owner: string, repo: string},
): Promise<any> {
  const target = repo ?? REACT_NATIVE_REPO;
  const { data } = await getOctokit().repos.createRelease({
    ...target,
    tag_name: tagName,
    name,
    body,
    prerelease,
  });
  return data;
}

export async function listReleases(
  repo?: {owner: string, repo: string},
  perPage?: number,
): Promise<Array<any>> {
  const target = repo ?? REACT_NATIVE_REPO;
  const { data } = await getOctokit().repos.listReleases({
    ...target,
    per_page: perPage ?? 20,
  });
  return data;
}

export async function getRepoInfo(
  repo?: {owner: string, repo: string},
): Promise<any> {
  const target = repo ?? REACT_NATIVE_REPO;
  const { data } = await getOctokit().repos.get(target);
  return data;
}

export type UnpublishedCommit = {
  sha: string,
  message: string,
  isLocal: boolean,
  hasPR: boolean,
};

export async function getUnpublishedCommits(
  branch: string,
  seriesPrefix: string,
  repo?: {owner: string, repo: string},
): Promise<{tag: string | null, commits: Array<UnpublishedCommit>}> {
  const target = repo ?? REACT_NATIVE_REPO;

  // Find the latest release tag for this series
  const releases = await listReleases(target, 50);
  const matching = releases
    .filter((r) => r.tag_name.startsWith(`v${seriesPrefix}`))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (matching.length === 0) {
    return { tag: null, commits: [] };
  }

  const latestTag = matching[0].tag_name;

  // Compare tag to branch HEAD
  const { data } = await getOctokit().repos.compareCommits({
    ...target,
    base: latestTag,
    head: branch,
  });

  const commits: Array<UnpublishedCommit> = data.commits.map((c) => {
    const firstLine = c.commit.message.split("\n")[0];
    const isLocal = firstLine.includes("[LOCAL]");
    const hasPR = /\(#\d+\)/.test(firstLine);
    return {
      sha: c.sha,
      message: firstLine,
      isLocal,
      hasPR,
    };
  });

  return { tag: latestTag, commits };
}

export async function listBranches(
  repo?: {owner: string, repo: string},
  perPage?: number,
): Promise<Array<any>> {
  const target = repo ?? REACT_NATIVE_REPO;
  const { data } = await getOctokit().repos.listBranches({
    ...target,
    per_page: perPage ?? 100,
  });
  return data;
}

export type PickRequest = {
  number: number,
  title: string,
  url: string,
  body: string,
  series: string | null,
  author: string,
};

export async function listPickRequests(): Promise<Array<PickRequest>> {
  const picks: Array<PickRequest> = [];
  let page = 1;
  while (true) {
    const { data } = await getOctokit().issues.listForRepo({
      ...RN_COMMUNITY_RELEASES_REPO,
      state: "open",
      labels: "Type Pick Request",
      per_page: 100,
      page,
    });
    if (data.length === 0) break;
    for (const issue of data) {
      const match = issue.title.match(/^\[(\d+\.\d+)\]/);
      picks.push({
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        body: issue.body ?? "",
        series: match ? match[1] : null,
        author: issue.user?.login ?? "unknown",
      });
    }
    page++;
  }
  return picks;
}

export async function getCommitStatus(
  sha: string,
  branch: string,
  repo?: {owner: string, repo: string},
): Promise<"on_branch" | "not_on_branch" | "unknown"> {
  const target = repo ?? REACT_NATIVE_REPO;
  try {
    const { data } = await getOctokit().repos.compareCommits({
      ...target,
      base: branch,
      head: sha,
    });
    // "behind" or "identical" means the commit is on the branch
    return data.status === "behind" || data.status === "identical"
      ? "on_branch"
      : "not_on_branch";
  } catch {
    return "unknown";
  }
}

export async function getPRDetails(
  prNumber: number,
  repo?: {owner: string, repo: string},
): Promise<any> {
  const target = repo ?? REACT_NATIVE_REPO;
  const { data } = await getOctokit().pulls.get({
    ...target,
    pull_number: prNumber,
  });
  return data;
}

export async function getPRComments(
  prNumber: number,
  repo?: {owner: string, repo: string},
): Promise<Array<any>> {
  const target = repo ?? REACT_NATIVE_REPO;
  const { data } = await getOctokit().issues.listComments({
    ...target,
    issue_number: prNumber,
    per_page: 100,
  });
  return data;
}

export async function createIssueComment(
  issueNumber: number,
  body: string,
  repo?: {owner: string, repo: string},
): Promise<void> {
  const target = repo ?? RN_COMMUNITY_RELEASES_REPO;
  await getOctokit().issues.createComment({
    ...target,
    issue_number: issueNumber,
    body,
  });
}

export async function closeIssue(
  issueNumber: number,
  repo?: {owner: string, repo: string},
): Promise<void> {
  const target = repo ?? RN_COMMUNITY_RELEASES_REPO;
  await getOctokit().issues.update({
    ...target,
    issue_number: issueNumber,
    state: "closed",
  });
}
