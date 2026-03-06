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
 * Check if the version uses the dual-tag Hermes scheme (>= 0.83).
 */
export function usesDualHermesTag(v: ParsedVersion): boolean {
  return v.major > 0 || v.minor >= 83;
}
