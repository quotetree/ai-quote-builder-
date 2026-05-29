import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  latexFragmentToPlain,
  sanitizeCopilotLatexBlocks,
} from "./sanitizeCopilotMath.js";

describe("sanitizeCopilotMath", () => {
  it("converts profit margin LaTeX to plain text", () => {
    const raw =
      "[ \\text{Target Sales Price} = \\frac{\\text{Total Cost}}{1 - \\text{Profit Margin}} = \\frac{22,648}{0.70} = 32,354.29 ]";
    const plain = latexFragmentToPlain(raw);
    assert.match(plain, /Target Sales Price/);
    assert.match(plain, /÷/);
    assert.match(plain, /22,648/);
    assert.doesNotMatch(plain, /\\frac/);
  });

  it("converts discount percentage LaTeX", () => {
    const raw =
      "[ \\text{Discount Percentage} = \\left(1 - \\frac{15,000}{32,354.29}\\right) \\times 100 \\approx 53.64% ]";
    const plain = latexFragmentToPlain(raw);
    assert.match(plain, /Discount Percentage/);
    assert.match(plain, /≈/);
    assert.match(plain, /53\.64%/);
  });

  it("sanitizes full message blocks", () => {
    const msg = `To maintain a 30% profit margin, the sales price must be:

[ \\text{Target Sales Price} = \\frac{22,648}{0.70} = 32,354.29 ]

Done.`;
    const out = sanitizeCopilotLatexBlocks(msg);
    assert.doesNotMatch(out, /\\frac/);
    assert.match(out, /Target Sales Price/);
    assert.match(out, /32,354\.29/);
  });
});
