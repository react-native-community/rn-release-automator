// @flow

// npm registry query utilities

import { NPM_REGISTRY, NPM_PACKAGE } from "../config.js";

export async function getPackageInfo(
  packageName?: string,
): Promise<any> {
  const pkg = packageName ?? NPM_PACKAGE;
  const response = await fetch(`${NPM_REGISTRY}/${pkg}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch package info for ${pkg}: ${response.statusText}`);
  }
  return response.json();
}

export async function getLatestVersion(
  packageName?: string,
): Promise<string> {
  const info = await getPackageInfo(packageName);
  return info["dist-tags"]?.latest ?? "unknown";
}

export async function getDistTags(
  packageName?: string,
): Promise<{[string]: string}> {
  const info = await getPackageInfo(packageName);
  return info["dist-tags"] ?? {};
}

export async function getPublishedVersions(
  packageName?: string,
): Promise<Array<string>> {
  const info = await getPackageInfo(packageName);
  return Object.keys(info.versions ?? {});
}

export async function isVersionPublished(
  version: string,
  packageName?: string,
): Promise<boolean> {
  const versions = await getPublishedVersions(packageName);
  return versions.includes(version);
}

export async function getVersionInfo(
  version: string,
  packageName?: string,
): Promise<any | null> {
  const pkg = packageName ?? NPM_PACKAGE;
  const response = await fetch(`${NPM_REGISTRY}/${pkg}/${version}`);
  if (!response.ok) return null;
  return response.json();
}
