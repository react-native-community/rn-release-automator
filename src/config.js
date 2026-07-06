// @flow

// Constants and configuration for the Release Automator CLI

export const REACT_NATIVE_REPO: {owner: string, repo: string} = {
  owner: "react",
  repo: "react-native",
};

export const HERMES_REPO: {owner: string, repo: string} = {
  owner: "facebook",
  repo: "hermes",
};

export const RN_COMMUNITY_RELEASES_REPO: {owner: string, repo: string} = {
  owner: "reactwg",
  repo: "react-native-releases",
};

export const WORKFLOWS: {[string]: string} = {
  createRelease: "create-release.yml",
  testAll: "test-all.yml",
  testRelease: "test-release-local.yml",
  publishRelease: "publish-release.yml",
  hermesRelease: "create-hermes-release.yml",
};

export const NPM_PACKAGE: string = "react-native";
export const NPM_REGISTRY: string = "https://registry.npmjs.org";

export const GITHUB_PROJECT_NUMBER: number = 76;

export const STABLE_BRANCH_PATTERN: RegExp = /^\d+\.\d+-stable$/;

export const VERSION_PATTERN: RegExp =
  /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/;

export const DEFAULT_LABELS: {[string]: string} = {
  pickRequest: "Pick Request",
  picked: "Picked",
  conflict: "Conflict",
};

export const MAVEN_CENTRAL_URL: string =
  "https://repo1.maven.org/maven2/com/facebook/react/react-native";

// Release schedule from https://reactnative.dev/docs/next/releases
// Format: [minor, branchCutDate, releaseDate]
export const RELEASE_SCHEDULE: Array<{minor: number, branchCut: string, release: string}> = [
  { minor: 85, branchCut: "2026-03-02", release: "2026-04-06" },
  { minor: 86, branchCut: "2026-05-04", release: "2026-06-08" },
  { minor: 87, branchCut: "2026-07-06", release: "2026-08-10" },
  { minor: 88, branchCut: "2026-09-07", release: "2026-10-12" },
  { minor: 89, branchCut: "2026-11-03", release: "2026-12-07" },
];
