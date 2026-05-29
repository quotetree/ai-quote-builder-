/**
 * Copilot renders markdown only (no KaTeX). Models often emit LaTeX for math — convert to plain text.
 */

function readBracedGroup(input: string, start: number): { value: string; end: number } | null {
  if (input[start] !== "{") return null;
  let depth = 0;
  for (let i = start; i < input.length; i++) {
    if (input[i] === "{") depth++;
    else if (input[i] === "}") {
      depth--;
      if (depth === 0) {
        return { value: input.slice(start + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

/** Turn one LaTeX expression fragment into readable plain text. */
export function latexFragmentToPlain(latex: string): string {
  let s = latex.trim();
  s = s.replace(/^\[|\]$/g, "").trim();
  s = s.replace(/^\\\[|\\\]$/g, "").trim();
  s = s.replace(/^\$\$|\$\$$/g, "").trim();

  let guard = 0;
  while (guard++ < 50) {
    const before = s;

    s = s.replace(/\\text\{([^}]*)\}/g, "$1");
    s = s.replace(/\\textbf\{([^}]*)\}/g, "$1");
    s = s.replace(/\\mathrm\{([^}]*)\}/g, "$1");

    const fracIdx = s.indexOf("\\frac");
    if (fracIdx >= 0) {
      let i = fracIdx + 5;
      while (i < s.length && /\s/.test(s[i]!)) i++;
      const num = readBracedGroup(s, i);
      if (!num) break;
      i = num.end;
      while (i < s.length && /\s/.test(s[i]!)) i++;
      const den = readBracedGroup(s, i);
      if (!den) break;
      const numPlain = latexFragmentToPlain(num.value);
      const denPlain = latexFragmentToPlain(den.value);
      s = `${s.slice(0, fracIdx)}(${numPlain} ÷ ${denPlain})${s.slice(den.end)}`;
      continue;
    }

    s = s.replace(/\\left\s*[\(\[\{]/g, "(");
    s = s.replace(/\\right\s*[\)\]\}]/g, ")");
    s = s.replace(/\\times/g, "×");
    s = s.replace(/\\div/g, "÷");
    s = s.replace(/\\approx/g, "≈");
    s = s.replace(/\\%/g, "%");
    s = s.replace(/\\,/g, " ");
    s = s.replace(/\\;/g, " ");
    s = s.replace(/\\\\/g, " ");
    s = s.replace(/\\cdot/g, "·");

    if (s === before) break;
  }

  s = s.replace(/\\([a-zA-Z]+)/g, "$1");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  return s;
}

const LATEX_BLOCK_RE =
  /(?:^|\n)\s*(?:\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\[\s*([\s\S]*?)\s*\])\s*(?=\n|$)/g;

function looksLikeLatex(inner: string): boolean {
  return /\\(?:frac|text|left|right|times|approx|div|textbf|mathrm)/.test(inner);
}

/** Replace display-math LaTeX blocks with plain-text equivalents. */
export function sanitizeCopilotLatexBlocks(content: string): string {
  return content.replace(LATEX_BLOCK_RE, (full, dollar, bracket, square) => {
    const inner = (dollar ?? bracket ?? square ?? "").trim();
    if (!inner || !looksLikeLatex(inner)) return full;
    const plain = latexFragmentToPlain(inner);
    return `\n\n${plain}\n\n`;
  });
}
