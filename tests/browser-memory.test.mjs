import test from "node:test";
import assert from "node:assert/strict";
import { processFamilyRss } from "../scripts/browser-memory.mjs";
test("process RSS sampler includes only the selected Chromium family across arbitrary row order", () => {
  assert.equal(processFamilyRss("3 2 30\n8 1 80\n2 7 20\n7 1 70\n", 7), 120 * 1024);
  assert.equal(processFamilyRss("3 2 30\n2 1 20", 99), 0);
});
