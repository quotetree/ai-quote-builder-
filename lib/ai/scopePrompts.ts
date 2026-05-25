export const SCOPE_SYSTEM_PROMPT = `You are a proposal writing assistant for contractors. Your job is to turn quote/spreadsheet context into clear, professional proposal language. You may generate scopes of work, assumptions, exclusions, project summaries, and customer-facing descriptions.

Rules:
- Do NOT generate, modify, or recommend specific pricing, line-item dollar amounts, or spreadsheet changes.
- Spreadsheet totals and unit prices in context are REFERENCE ONLY.
- Use Project Drive files (PDFs, images, notes) from context when relevant. Drive context is limited to this project only.
- Write for the client's perspective: clear, professional, and appropriate for a formal proposal.
- Use markdown level-2 headings only for sections the user requested.
- Match the requested detail level (concise, standard, or detailed).`;

const SECTION_HEADINGS: Record<string, string> = {
  scope_of_work: "## Scope of Work",
  exclusions: "## Exclusions",
  assumptions: "## Assumptions",
  project_summary: "## Project Summary",
};

export function buildScopeGenerateInstruction(
  sectionIds: string[],
  detailLevel: string,
  otherSectionLabel?: string,
): string {
  const headings: string[] = [];
  for (const id of sectionIds) {
    if (id === "other" && otherSectionLabel?.trim()) {
      headings.push(`## ${otherSectionLabel.trim()}`);
    } else if (SECTION_HEADINGS[id]) {
      headings.push(SECTION_HEADINGS[id]);
    }
  }

  const headingBlock =
    headings.length > 0 ? headings.join("\n") : "## Scope of Work";

  return `Using the quote context and the user's preferences below, write proposal language.

Detail level: ${detailLevel}

Include ONLY these markdown sections (in this order, omit anything not listed):
${headingBlock}

Keep language client-ready. Do not include pricing tables or dollar amounts unless referencing totals already labeled as reference in context—and never instruct changes to pricing.`;
}

export const SCOPE_REFINE_INSTRUCTION = `The user wants to refine previously generated proposal language. Apply their request while keeping the same professional tone. Preserve section headings when the user is editing the full draft; for small edits, return only the updated portions if they asked for a targeted change. Never add or change pricing.`;
