import assert from "node:assert/strict";
import test from "node:test";

import { WORKFLOWS } from "../dist/config.js";

test("manual nightlies use the consolidated npm publishing workflow", () => {
  assert.equal(WORKFLOWS.nightly, "publish-npm.yml");
});
