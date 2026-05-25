"use client";

import {
  SCOPE_DETAIL_OPTIONS,
  SCOPE_GENERATE_OPTIONS,
  SCOPE_PROJECT_TYPE_OPTIONS,
  type ScopeAnswersState,
  isScopeQuestionnaireComplete,
} from "@/lib/ai/scopeQuestionnaire";

interface ScopeQuestionnaireProps {
  answers: ScopeAnswersState;
  onChange: (answers: ScopeAnswersState) => void;
  onSubmit: () => void;
  submitting: boolean;
}

const optionCardClass = (selected: boolean) =>
  `rounded-lg border px-3 py-2 text-sm ${
    selected ? "border-green-600 bg-green-50" : "border-gray-200 bg-white hover:border-gray-300"
  }`;

function OtherRadioCard({
  selected,
  text,
  placeholder,
  onSelect,
  onTextChange,
}: {
  selected: boolean;
  text: string;
  placeholder: string;
  onSelect: () => void;
  onTextChange: (value: string) => void;
}) {
  return (
    <div className={optionCardClass(selected)}>
      <label className="flex items-center gap-2 cursor-pointer text-gray-800 mb-1.5">
        <input
          type="radio"
          checked={selected}
          onChange={onSelect}
          className="text-green-600"
        />
        <span className="font-medium">Other</span>
      </label>
      <input
        type="text"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onFocus={() => {
          if (!selected) onSelect();
        }}
        placeholder={placeholder}
        className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500 bg-white"
      />
    </div>
  );
}

function OtherCheckboxCard({
  selected,
  text,
  placeholder,
  onToggle,
  onTextChange,
}: {
  selected: boolean;
  text: string;
  placeholder: string;
  onToggle: () => void;
  onTextChange: (value: string) => void;
}) {
  return (
    <div className={optionCardClass(selected)}>
      <label className="flex items-center gap-2 cursor-pointer text-gray-800 mb-1.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="text-green-600 rounded"
        />
        <span className="font-medium">Other</span>
      </label>
      <input
        type="text"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onFocus={() => {
          if (!selected) onToggle();
        }}
        placeholder={placeholder}
        className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500 bg-white"
      />
    </div>
  );
}

export default function ScopeQuestionnaire({
  answers,
  onChange,
  onSubmit,
  submitting,
}: ScopeQuestionnaireProps) {
  const canSubmit = isScopeQuestionnaireComplete(answers);

  const toggleSection = (id: string) => {
    const current = answers.generate_sections;
    const next = current.includes(id)
      ? current.filter((s) => s !== id)
      : [...current, id];
    onChange({ ...answers, generate_sections: next });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-900">1. What type of project is this?</p>
        <div className="space-y-1.5">
          {SCOPE_PROJECT_TYPE_OPTIONS.filter((o) => o.id !== "other").map((opt) => (
            <label
              key={opt.id}
              className={`flex items-center gap-2 cursor-pointer ${optionCardClass(answers.project_type === opt.id)}`}
            >
              <input
                type="radio"
                name="project_type"
                checked={answers.project_type === opt.id}
                onChange={() => onChange({ ...answers, project_type: opt.id })}
                className="text-green-600"
              />
              <span className="text-gray-800">{opt.label}</span>
            </label>
          ))}
          <OtherRadioCard
            selected={answers.project_type === "other"}
            text={answers.project_type_other}
            placeholder="Your answer…"
            onSelect={() => onChange({ ...answers, project_type: "other" })}
            onTextChange={(value) =>
              onChange({ ...answers, project_type: "other", project_type_other: value })
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-900">
          2. What would you like me to generate?{" "}
          <span className="font-normal text-gray-500">(Select all that apply)</span>
        </p>
        <div className="space-y-1.5">
          {SCOPE_GENERATE_OPTIONS.filter((o) => o.id !== "other").map((opt) => (
            <label
              key={opt.id}
              className={`flex items-center gap-2 cursor-pointer ${optionCardClass(
                answers.generate_sections.includes(opt.id),
              )}`}
            >
              <input
                type="checkbox"
                checked={answers.generate_sections.includes(opt.id)}
                onChange={() => toggleSection(opt.id)}
                className="text-green-600 rounded"
              />
              <span className="text-gray-800">{opt.label}</span>
            </label>
          ))}
          <OtherCheckboxCard
            selected={answers.generate_sections.includes("other")}
            text={answers.generate_other}
            placeholder="Your answer…"
            onToggle={() => toggleSection("other")}
            onTextChange={(value) =>
              onChange({
                ...answers,
                generate_sections: answers.generate_sections.includes("other")
                  ? answers.generate_sections
                  : [...answers.generate_sections, "other"],
                generate_other: value,
              })
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-900">3. How detailed should the output be?</p>
        <div className="space-y-1.5">
          {SCOPE_DETAIL_OPTIONS.filter((o) => o.id !== "other").map((opt) => (
            <label
              key={opt.id}
              className={`flex items-center gap-2 cursor-pointer ${optionCardClass(
                answers.detail_level === opt.id,
              )}`}
            >
              <input
                type="radio"
                name="detail_level"
                checked={answers.detail_level === opt.id}
                onChange={() => onChange({ ...answers, detail_level: opt.id })}
                className="text-green-600"
              />
              <span className="text-gray-800">{opt.label}</span>
            </label>
          ))}
          <OtherRadioCard
            selected={answers.detail_level === "other"}
            text={answers.detail_level_other}
            placeholder="Your answer…"
            onSelect={() => onChange({ ...answers, detail_level: "other" })}
            onTextChange={(value) =>
              onChange({ ...answers, detail_level: "other", detail_level_other: value })
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-900">
          4. Anything else I should know before generating?
        </p>
        <textarea
          value={answers.optional_notes}
          onChange={(e) => onChange({ ...answers, optional_notes: e.target.value })}
          rows={3}
          placeholder="Optional — site conditions, client preferences, standards to reference…"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500 resize-none"
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canSubmit || submitting}
          onClick={onSubmit}
          className="px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-semibold hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Generating…" : "Continue"}
        </button>
      </div>
    </div>
  );
}
