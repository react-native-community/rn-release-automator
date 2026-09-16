// @flow

// Version-aware Hermes release planning for React Native release branches.

import type { ParsedVersion } from "./version.js";

export type HermesReleaseMode = "dual" | "v1";

export type HermesReleasePlan = {
  mode: HermesReleaseMode,
  legacyVersion: string | null,
  legacyBranch: string | null,
  v1Version: string,
  v1Branch: string,
  updateLatestV1: boolean,
};

export type HermesReleaseTags = {
  legacyTag: string | null,
  v1Tag: string,
};

const VERSION_PROPERTIES_PATH =
  "packages/react-native/sdks/hermes-engine/version.properties";

export const HERMES_VERSION_PROPERTIES_PATH: string = VERSION_PROPERTIES_PATH;

export function getHermesReleaseMode(
  version: ParsedVersion,
): HermesReleaseMode {
  if (version.major > 0 || version.minor >= 87) {
    return "v1";
  }
  if (version.major === 0 && version.minor >= 83) {
    return "dual";
  }
  throw new Error("Hermes release guidance supports React Native 0.83 and newer");
}

export function parseHermesVersionProperties(
  contents: string,
): {[string]: string} {
  const properties: {[string]: string} = {};
  for (const line of contents.split("\n")) {
    const match = line.trim().match(/^([A-Z0-9_]+)=(.+)$/);
    if (match) {
      properties[match[1]] = match[2].trim();
    }
  }
  return properties;
}

function v1StableBranch(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.\d+$/);
  if (!match) {
    throw new Error(`Unexpected Hermes V1 version: ${version}`);
  }
  return `${match[1]}.${match[2]}.0-stable`;
}

function legacyStableBranch(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.\d+$/);
  if (!match) {
    throw new Error(`Unexpected legacy Hermes version: ${version}`);
  }
  return `release-v${match[1]}.${match[2]}`;
}

function compareNumericVersions(a: string, b: string): number {
  const aParts = a.split(".").map((part) => parseInt(part, 10));
  const bParts = b.split(".").map((part) => parseInt(part, 10));
  const length = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < length; index++) {
    const difference = (aParts[index] ?? 0) - (bParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function createHermesReleasePlan(
  version: ParsedVersion,
  versionProperties: string,
  hermesBranches: Array<string>,
): HermesReleasePlan {
  const mode = getHermesReleaseMode(version);
  const properties = parseHermesVersionProperties(versionProperties);
  const v1Version = mode === "v1"
    ? properties.HERMES_VERSION_NAME
    : properties.HERMES_V1_VERSION_NAME;

  if (!v1Version) {
    const property = mode === "v1"
      ? "HERMES_VERSION_NAME"
      : "HERMES_V1_VERSION_NAME";
    throw new Error(`${property} is missing from ${VERSION_PROPERTIES_PATH}`);
  }

  const v1Branch = v1StableBranch(v1Version);
  const v1Branches = hermesBranches
    .filter((branch) => /^\d+\.\d+\.0-stable$/.test(branch))
    .sort((a, b) => compareNumericVersions(b, a));
  if (v1Branches.length === 0) {
    throw new Error("Could not determine the latest Hermes V1 release branch");
  }

  const legacyVersion = mode === "dual"
    ? properties.HERMES_VERSION_NAME ?? null
    : null;
  if (mode === "dual" && !legacyVersion) {
    throw new Error(`HERMES_VERSION_NAME is missing from ${VERSION_PROPERTIES_PATH}`);
  }

  return {
    mode,
    legacyVersion,
    legacyBranch: legacyVersion ? legacyStableBranch(legacyVersion) : null,
    v1Version,
    v1Branch,
    updateLatestV1: v1Branches[0] === v1Branch,
  };
}

export function validateHermesTag(tag: string): boolean {
  return /^hermes-v[0-9A-Za-z][0-9A-Za-z._-]*$/.test(tag);
}

export function getHermesBumpCommand(
  plan: HermesReleasePlan,
  tags: HermesReleaseTags,
): string {
  const script = "./packages/react-native/scripts/hermes/bump-hermes-version.js";
  if (!validateHermesTag(tags.v1Tag)) {
    throw new Error(`Invalid Hermes V1 tag: ${tags.v1Tag}`);
  }

  if (plan.mode === "v1") {
    return `${script} -v ${tags.v1Tag}`;
  }

  if (!tags.legacyTag || !validateHermesTag(tags.legacyTag)) {
    throw new Error(`Invalid legacy Hermes tag: ${tags.legacyTag ?? ""}`);
  }
  return `${script} -t ${tags.legacyTag} -s ${tags.v1Tag}`;
}

export function getHermesBumpFiles(
  plan: HermesReleasePlan,
): Array<string> {
  const files = [
    "packages/react-native/sdks/.hermesv1version",
    "packages/react-native/sdks/hermes-engine/version.properties",
    "packages/react-native/package.json",
  ];
  if (plan.mode === "dual") {
    files.unshift("packages/react-native/sdks/.hermesversion");
  }
  return files;
}
