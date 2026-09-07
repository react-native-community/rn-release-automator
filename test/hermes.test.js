import assert from "node:assert/strict";
import test from "node:test";

import {
  createHermesReleasePlan,
  getHermesBumpCommand,
  getHermesBumpFiles,
  getHermesReleaseMode,
  validateHermesTag,
} from "../dist/utils/hermes.js";
import { parseVersion } from "../dist/utils/version.js";

function version(value) {
  const parsed = parseVersion(value);
  assert.notEqual(parsed, null);
  return parsed;
}

test("RN 0.83 through 0.86 use the dual Hermes release flow", () => {
  const parsed = version("0.86.0-rc.0");
  const plan = createHermesReleasePlan(
    parsed,
    "HERMES_VERSION_NAME=0.17.0\nHERMES_V1_VERSION_NAME=250829098.0.17\n",
    ["release-v0.17", "250829098.0.0-stable"],
  );

  assert.equal(getHermesReleaseMode(parsed), "dual");
  assert.deepEqual(plan, {
    mode: "dual",
    legacyVersion: "0.17.0",
    legacyBranch: "release-v0.17",
    v1Version: "250829098.0.17",
    v1Branch: "250829098.0.0-stable",
    updateLatestV1: true,
  });
  assert.equal(
    getHermesBumpCommand(plan, {
      legacyTag: "hermes-v0.17.0",
      v1Tag: "hermes-v250829098.0.18",
    }),
    "./packages/react-native/scripts/hermes/bump-hermes-version.js -t hermes-v0.17.0 -s hermes-v250829098.0.18",
  );
  assert.deepEqual(getHermesBumpFiles(plan), [
    "packages/react-native/sdks/.hermesversion",
    "packages/react-native/sdks/.hermesv1version",
    "packages/react-native/sdks/hermes-engine/version.properties",
    "packages/react-native/package.json",
  ]);
});

test("RN 0.87 and newer use the Hermes V1-only flow", () => {
  const branches = [
    "250829098.0.0-stable",
    "260318099.0.0-stable",
  ];
  const rn87 = createHermesReleasePlan(
    version("0.87.0"),
    "HERMES_VERSION_NAME=250829098.0.17\n",
    branches,
  );
  const rn88 = createHermesReleasePlan(
    version("0.88.0-rc.0"),
    "HERMES_VERSION_NAME=260318099.0.1\n",
    branches,
  );

  assert.equal(rn87.mode, "v1");
  assert.equal(rn87.v1Branch, "250829098.0.0-stable");
  assert.equal(rn87.updateLatestV1, false);
  assert.equal(rn88.mode, "v1");
  assert.equal(rn88.v1Branch, "260318099.0.0-stable");
  assert.equal(rn88.updateLatestV1, true);
  assert.equal(
    getHermesBumpCommand(rn88, {
      legacyTag: null,
      v1Tag: "hermes-v260318099.0.2",
    }),
    "./packages/react-native/scripts/hermes/bump-hermes-version.js -v hermes-v260318099.0.2",
  );
  assert.deepEqual(getHermesBumpFiles(rn88), [
    "packages/react-native/sdks/.hermesv1version",
    "packages/react-native/sdks/hermes-engine/version.properties",
    "packages/react-native/package.json",
  ]);
});

test("Hermes release planning rejects unsupported and malformed inputs", () => {
  assert.throws(() => getHermesReleaseMode(version("0.82.0")), /0\.83/);
  assert.throws(
    () => createHermesReleasePlan(version("0.88.0"), "", []),
    /HERMES_VERSION_NAME/,
  );
  assert.throws(
    () => createHermesReleasePlan(
      version("0.88.0"),
      "HERMES_VERSION_NAME=260318099.0.1\n",
      [],
    ),
    /latest Hermes V1 release branch/,
  );
  assert.equal(validateHermesTag("hermes-v260318099.0.2"), true);
  assert.equal(validateHermesTag("hermes-v1.2.3; rm -rf /"), false);
});
