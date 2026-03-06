// @flow

// Shared Flow types for the Release Automator CLI

export type ReleaseStatus =
  | "not-started"
  | "branch-cut"
  | "rc-in-progress"
  | "rc-published"
  | "stable-published"
  | "abandoned";

export type PickStatus =
  | "pending"
  | "picked"
  | "conflict"
  | "skipped";

export type CIJobStatus =
  | "queued"
  | "in_progress"
  | "completed";

export type Release = {
  version: string,
  branch: string,
  status: ReleaseStatus,
  rcNumber: number,
  picks: Array<PickRequest>,
  ciJobs: Array<CIJob>,
  publishedVersions: Array<PublishedVersion>,
  createdAt: string,
  updatedAt: string,
};

export type PickRequest = {
  id: string,
  commitHash: string,
  prNumber: number,
  title: string,
  author: string,
  status: PickStatus,
  conflictDetails?: string,
};

export type CIJob = {
  id: number,
  name: string,
  workflowName: string,
  status: CIJobStatus,
  conclusion: string | null,
  url: string,
  startedAt: string,
  completedAt: string | null,
};

export type PublishedVersion = {
  version: string,
  tag: string,
  npmDistTag: string,
  publishedAt: string,
  isPrerelease: boolean,
};

export type PreflightResult = {
  ok: boolean,
  checks: Array<PreflightCheck>,
};

export type PreflightCheck = {
  name: string,
  passed: boolean,
  message: string,
  required: boolean,
};

export type ReleaseConfig = {
  version: string,
  branch: string,
  dryRun: boolean,
};

export type WorkflowRun = {
  id: number,
  name: string,
  status: string,
  conclusion: string | null,
  html_url: string,
  created_at: string,
  updated_at: string,
};
