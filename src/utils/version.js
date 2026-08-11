// @flow

// Version parsing and validation utilities

import { VERSION_PATTERN } from "../config.js";

export type ParsedVersion = {
  major: number,
  minor: number,
  patch: number,
  rc?: number,
  isPrerelease: boolean,
};

export function parseVersion(version: string): ParsedVersion | null {
  const match = version.match(VERSION_PATTERN);
  if (!match) return null;

  const [, major, minor, patch, rc] = match;
  return {
    major: parseInt(major, 10),
    minor: parseInt(minor, 10),
    patch: parseInt(patch, 10),
    rc: rc !== undefined ? parseInt(rc, 10) : undefined,
    isPrerelease: rc !== undefined,
  };
}

export function formatVersion(v: ParsedVersion): string {
  const base = `${v.major}.${v.minor}.${v.patch}`;
  return v.rc !== undefined ? `${base}-rc.${v.rc}` : base;
}

export function stableBranch(v: ParsedVersion): string {
  return `${v.major}.${v.minor}-stable`;
}

export function nextPatch(v: ParsedVersion): ParsedVersion {
  return { ...v, patch: v.patch + 1, rc: undefined, isPrerelease: false };
}

export function nextRC(v: ParsedVersion): ParsedVersion {
  const currentRC = v.rc ?? -1;
  return { ...v, rc: currentRC + 1, isPrerelease: true };
}

export function nextMinor(v: ParsedVersion): ParsedVersion {
  return {
    major: v.major,
    minor: v.minor + 1,
    patch: 0,
    rc: 0,
    isPrerelease: true,
  };
}

export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  if (a.rc === undefined && b.rc === undefined) return 0;
  if (a.rc === undefined) return 1;
  if (b.rc === undefined) return -1;
  return a.rc - b.rc;
}

export function isValidVersion(version: string): boolean {
  return VERSION_PATTERN.test(version);
}

/**
 * Published versions in a release series, newest-first.
 *
 * Sorting the raw strings gets this wrong in two ways: `"0.87.0"` is a prefix
 * of `"0.87.0-rc.4"` so the RC sorts above the stable release it precedes, and
 * `"0.83.9"` sorts above `"0.83.10"`.
 *
 * Versions that aren't a plain `X.Y.Z` or `X.Y.Z-rc.N` are dropped — nightlies,
 * `0.0.0-<sha>` commit builds, and the pre-0.57 `X.Y.Z-rcN` format can't be
 * ordered meaningfully against a release series.
 */
export function versionsInSeries(
  versions: Array<string>,
  major: number,
  minor: number,
): Array<string> {
  const prefix = `${major}.${minor}.`;
  const parsed: Array<{ raw: string, version: ParsedVersion }> = [];
  for (const raw of versions) {
    const version = raw.startsWith(prefix) ? parseVersion(raw) : null;
    if (version != null) {
      parsed.push({ raw, version });
    }
  }
  return parsed
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((entry) => entry.raw);
}

/**
 * Check if the version uses the dual-tag Hermes scheme (>= 0.83).
 */
export function usesDualHermesTag(v: ParsedVersion): boolean {
  return v.major > 0 || v.minor >= 83;
}
