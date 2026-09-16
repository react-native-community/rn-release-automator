import assert from "node:assert/strict";
import test from "node:test";

import {
  isReactNativeRemote,
  parseGitHubRemote,
} from "../dist/utils/git.js";

test("parseGitHubRemote supports common GitHub remote formats", () => {
  assert.deepEqual(
    parseGitHubRemote("git@github.com:react/react-native.git"),
    { owner: "react", repo: "react-native" },
  );
  assert.deepEqual(
    parseGitHubRemote("https://github.com/facebook/react-native.git"),
    { owner: "facebook", repo: "react-native" },
  );
  assert.deepEqual(
    parseGitHubRemote("ssh://git@github.com/React/React-Native.git"),
    { owner: "react", repo: "react-native" },
  );
});

test("parseGitHubRemote rejects non-GitHub and malformed remotes", () => {
  assert.equal(parseGitHubRemote("https://example.com/react/react-native"), null);
  assert.equal(parseGitHubRemote("git@github.com:react/react-native/extra.git"), null);
  assert.equal(parseGitHubRemote("not a remote"), null);
});

test("isReactNativeRemote accepts both canonical repository owners", () => {
  assert.equal(isReactNativeRemote("git@github.com:react/react-native.git"), true);
  assert.equal(
    isReactNativeRemote("https://github.com/facebook/react-native"),
    true,
  );
});

test("isReactNativeRemote rejects forks and lookalike repository names", () => {
  assert.equal(isReactNativeRemote("git@github.com:someone/react-native.git"), false);
  assert.equal(isReactNativeRemote("https://github.com/react/react-native-fork"), false);
  assert.equal(
    isReactNativeRemote("https://github.com/notreact/react-native"),
    false,
  );
});
