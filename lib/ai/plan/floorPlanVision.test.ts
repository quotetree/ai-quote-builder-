import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deviceTypeFromSymbol,
  formatFloorPlanVisionForPrompt,
  friendlyDeviceName,
  isLikelyFloorPlanFileName,
  parseFloorPlanVisionJson,
  parseQtyFromLegendLabel,
  reconcileFloorPlanTotals,
  reconcileInventoryCounts,
  resolveSymbolQuantity,
} from "./floorPlanVision.js";

describe("floorPlanVision", () => {
  it("detects floor plan filenames", () => {
    assert.ok(isLikelyFloorPlanFileName("Artesia Golf Simulator_floorplan_17x22.png"));
    assert.ok(!isLikelyFloorPlanFileName("invoice-march.pdf"));
  });

  it("parses JSON totals", () => {
    const raw = `{"totals":{"fisheye":2,"multisensor":1,"dome":5,"total_cameras":8}}`;
    const parsed = parseFloorPlanVisionJson(raw);
    assert.equal(parsed?.totals?.fisheye, 2);
    assert.equal(parsed?.totals?.total_cameras, 8);
  });

  it("reconciles totals from per-room legend symbol codes", () => {
    const reconciled = reconcileFloorPlanTotals({
      legend: [
        { symbol_code: "FE", quote_style: "fisheye" },
        { symbol_code: "D1", quote_style: "dome" },
      ],
      by_location: [
        {
          location: "A",
          markers: [
            { symbol_code: "FE", qty: 2, quote_style: "dome" },
            { symbol_code: "D1", qty: 5, quote_style: "fisheye" },
          ],
        },
      ],
      totals: { fisheye: 7, multisensor: 1, dome: 0, total_cameras: 8 },
    });
    assert.equal(reconciled?.totals?.fisheye, 2);
    assert.equal(reconciled?.totals?.dome, 5);
  });

  it("parses RDR (3) from legend label", () => {
    assert.equal(parseQtyFromLegendLabel("RDR (3)"), 3);
    assert.equal(parseQtyFromLegendLabel("FCAM (15)"), 15);
  });

  it("quantity-summary legend: RDR (3) beats marker under-count", () => {
    const reconciled = reconcileInventoryCounts({
      legend: [{ symbol_code: "RDR", legend_label: "RDR (3)" }],
      symbol_counts: [{ symbol_code: "RDR", qty: 1 }],
    });
    assert.equal(
      reconciled?.symbol_counts?.find((s) => s.symbol_code === "RDR")?.qty,
      3,
    );
  });

  it("symbol-key legend: RDR (1) with 3 markers uses marker count", () => {
    assert.deepEqual(resolveSymbolQuantity(1, 3), { qty: 3, source: "marker_count" });
    const reconciled = reconcileInventoryCounts({
      legend: [{ symbol_code: "RDR", legend_label: "Reader (1)" }],
      symbol_counts: [{ symbol_code: "RDR", qty: 3 }],
    });
    assert.equal(
      reconciled?.symbol_counts?.find((s) => s.symbol_code === "RDR")?.qty,
      3,
    );
  });

  it("unknown vendor code infers device type from label text", () => {
    assert.equal(deviceTypeFromSymbol("XYZ-42", "Pan-Tilt Dome Camera"), "dome");
    assert.equal(deviceTypeFromSymbol("ABC", "Card Reader"), "reader");
  });

  it("maps FCAM to camera not fisheye for inventory", () => {
    assert.equal(deviceTypeFromSymbol("FCAM", "Fisheye Camera"), "camera");
    assert.equal(friendlyDeviceName("camera", 19), "Cameras");
  });

  it("formats site map inventory with symbol counts", () => {
    const formatted = formatFloorPlanVisionForPrompt("map.png", "{}", {
      legend: [{ symbol_code: "FCAM", device_type: "camera", legend_label: "Fisheye Camera" }],
      symbol_counts: [
        { symbol_code: "FCAM", device_type: "camera", qty: 19 },
        { symbol_code: "RDR", device_type: "reader", qty: 3 },
      ],
    });
    assert.match(formatted, /Cameras[\s\S]*19|Quantity[\s\S]*19/);
    assert.match(formatted, /Readers[\s\S]*3|RDR[\s\S]*\| 3/);
    assert.ok(!/Fisheye:\s*19/i.test(formatted));
  });

  it("formats authoritative totals block", () => {
    const formatted = formatFloorPlanVisionForPrompt(
      "plan.png",
      "{}",
      {
        totals: { fisheye: 2, multisensor: 1, dome: 5, total_cameras: 8 },
        legend: [{ symbol_code: "FCAM", quote_style: "fisheye", legend_label: "Fisheye" }],
      },
    );
    assert.match(formatted, /Fisheye: 2/);
    assert.match(formatted, /Dome: 5/);
    assert.match(formatted, /Do not re-count using 360/);
  });
});
