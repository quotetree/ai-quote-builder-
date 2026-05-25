export type ScopePhase = "questions" | "generate" | "refine";

export interface ScopeQuestionOption {
  id: string;
  label: string;
}

export interface ScopeQuestion {
  id: string;
  prompt: string;
  options: ScopeQuestionOption[];
  allowCustom?: boolean;
}

export interface ScopeQuestionsResponse {
  questions: ScopeQuestion[];
  contextSummary?: string;
}

export interface ScopeRequestBody {
  projectId: string;
  activeSpreadsheetId?: string | null;
  phase: ScopePhase;
  answers?: Record<string, string>;
  /** Comma-separated section ids for generate phase, e.g. scope_of_work,exclusions */
  generateSectionIds?: string;
  generateOther?: string;
  message?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}
