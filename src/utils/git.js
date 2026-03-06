// @flow

// Git operations via child_process exec

import { execSync } from "child_process";

function git(args: string, cwd?: string): string {
  const options: any = { encoding: "utf8", timeout: 30000 };
  if (cwd) options.cwd = cwd;
  return execSync(`git ${args}`, options).trim();
}

export function currentBranch(cwd?: string): string {
  return git("rev-parse --abbrev-ref HEAD", cwd);
}

export function currentSha(cwd?: string): string {
  return git("rev-parse HEAD", cwd);
}

export function checkout(branch: string, cwd?: string): void {
  git(`checkout ${branch}`, cwd);
}

export function createLocalBranch(
  branchName: string,
  startPoint?: string,
  cwd?: string,
): void {
  const from = startPoint ? ` ${startPoint}` : "";
  git(`checkout -b ${branchName}${from}`, cwd);
}

export function cherryPick(commitHash: string, cwd?: string): boolean {
  try {
    git(`cherry-pick ${commitHash}`, cwd);
    return true;
  } catch {
    return false;
  }
}

export function abortCherryPick(cwd?: string): void {
  try {
    git("cherry-pick --abort", cwd);
  } catch {
    // Ignore if no cherry-pick in progress
  }
}

export function push(
  remote: string,
  branch: string,
  force?: boolean,
  cwd?: string,
): void {
  const forceFlag = force ? " --force-with-lease" : "";
  git(`push${forceFlag} ${remote} ${branch}`, cwd);
}

export function fetch(remote: string, ref?: string, cwd?: string): void {
  const refArg = ref ? ` ${ref}` : "";
  git(`fetch ${remote}${refArg}`, cwd);
}

export function isCleanWorkingTree(cwd?: string): boolean {
  const status = git("status --porcelain", cwd);
  return status.length === 0;
}

export function log(
  count: number,
  format?: string,
  cwd?: string,
): string {
  const fmt = format ?? "%h %s";
  return git(`log -${count} --format="${fmt}"`, cwd);
}

export function diffStat(
  from: string,
  to: string,
  cwd?: string,
): string {
  return git(`diff --stat ${from}..${to}`, cwd);
}
