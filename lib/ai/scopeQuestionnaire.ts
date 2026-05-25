/** Fixed Scope mode questionnaire (always the same four questions). */

export const SCOPE_PROJECT_TYPE_OPTIONS = [
  { id: "new_installation", label: "New installation" },
  { id: "retrofit", label: "Retrofit" },
  { id: "change_order", label: "Change order" },
  { id: "service_work", label: "Service work" },
  { id: "tenant_improvement", label: "Tenant improvement" },
  { id: "repair_troubleshooting", label: "Repair/troubleshooting" },
  { id: "other", label: "Other — your answer" },
] as const;

export const SCOPE_GENERATE_OPTIONS = [
  { id: "scope_of_work", label: "Scope of work" },
  { id: "exclusions", label: "Exclusions" },
  { id: "assumptions", label: "Assumptions" },
  { id: "project_summary", label: "Project summary" },
  { id: "other", label: "Other (your answer)" },
] as const;

export const SCOPE_DETAIL_OPTIONS = [
  { id: "concise", label: "Concise" },
  { id: "standard", label: "Standard" },
  { id: "detailed", label: "Detailed" },
  { id: "other", label: "Other — your answer" },
] as const;

export type ScopeAnswersState = {
  project_type: string;
  project_type_other: string;
  generate_sections: string[];
  generate_other: string;
  detail_level: string;
  detail_level_other: string;
  optional_notes: string;
};

export function getDefaultScopeAnswers(): ScopeAnswersState {
  return {
    project_type: "",
    project_type_other: "",
    generate_sections: [],
    generate_other: "",
    detail_level: "",
    detail_level_other: "",
    optional_notes: "",
  };
}

export function scopeAnswersToApiPayload(answers: ScopeAnswersState): Record<string, string> {
  const projectTypeLabel =
    answers.project_type === "other"
      ? answers.project_type_other.trim()
      : SCOPE_PROJECT_TYPE_OPTIONS.find((o) => o.id === answers.project_type)?.label ??
        answers.project_type;

  const sections = answers.generate_sections
    .filter((id) => id !== "other")
    .map(
      (id) =>
        SCOPE_GENERATE_OPTIONS.find((o) => o.id === id)?.label ?? id,
    );
  if (answers.generate_sections.includes("other") && answers.generate_other.trim()) {
    sections.push(answers.generate_other.trim());
  }

  const detailLabel =
    answers.detail_level === "other"
      ? answers.detail_level_other.trim()
      : SCOPE_DETAIL_OPTIONS.find((o) => o.id === answers.detail_level)?.label ??
        answers.detail_level;

  return {
    project_type: projectTypeLabel,
    generate_sections: sections.join(", "),
    detail_level: detailLabel,
    optional_notes: answers.optional_notes.trim(),
  };
}

export function formatScopeAnswersForDisplay(answers: ScopeAnswersState): string {
  const payload = scopeAnswersToApiPayload(answers);
  const lines = [
    `Project type: ${payload.project_type}`,
    `Generate: ${payload.generate_sections}`,
    `Detail level: ${payload.detail_level}`,
  ];
  if (payload.optional_notes) {
    lines.push(`Additional notes: ${payload.optional_notes}`);
  }
  return lines.join("\n");
}

export function isScopeQuestionnaireComplete(answers: ScopeAnswersState): boolean {
  if (!answers.project_type) return false;
  if (answers.project_type === "other" && !answers.project_type_other.trim()) return false;
  if (answers.generate_sections.length === 0) return false;
  if (
    answers.generate_sections.includes("other") &&
    answers.generate_sections.length === 1 &&
    !answers.generate_other.trim()
  ) {
    return false;
  }
  // Other + at least one standard section: optional free-text section title
  if (!answers.detail_level) return false;
  if (answers.detail_level === "other" && !answers.detail_level_other.trim()) return false;
  return true;
}
