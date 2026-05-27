export const DEFAULT_MAX_CHUNKS = 12;
export const RFP_MAX_CHUNKS = parseInt(process.env.RFP_MAX_CHUNKS ?? "35", 10);
export const RFP_MAX_CONTEXT_TOKENS = parseInt(
  process.env.RFP_MAX_CONTEXT_TOKENS ?? "32000",
  10,
);
export const MAX_CHUNKS_PER_PAGE_SPAN = 2;
export const PER_PASS_LIMIT = 8;

export const RFP_FILENAME_RE = /rfp|pws|spec|bid|sow|itb|rfq|scope|proposal/i;
export const RFP_MIN_PAGES_FOR_MODE = 20;
