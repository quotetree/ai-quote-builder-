import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isPlanLayoutCameraQuery,
  isSiteMapDeviceInventoryQuery,
} from "./planLayoutAnalysis.js";

describe("isPlanLayoutCameraQuery", () => {
  it("detects site map camera quoting question", () => {
    const q =
      "Based off the site map i uploaded which style of camera should I be quoting at each location";
    assert.ok(isPlanLayoutCameraQuery(q));
  });

  it("does not treat legend inventory as layout quoting", () => {
    const q = "Based on the site map legend how many cameras and readers are on the drawing";
    assert.ok(isSiteMapDeviceInventoryQuery(q));
    assert.equal(isPlanLayoutCameraQuery(q), false);
  });
});
