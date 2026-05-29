import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { buildFullProjectContext } from "@/lib/ai/buildFullProjectContext";
import {
  buildScopeGenerateInstruction,
  SCOPE_REFINE_INSTRUCTION,
  SCOPE_SYSTEM_PROMPT,
} from "@/lib/ai/scopePrompts";
import type { ScopeRequestBody } from "@/lib/ai/scopeTypes";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const maxDuration = 120;

function formatAnswers(answers: Record<string, string> | undefined): string {
  if (!answers || Object.keys(answers).length === 0) return "(no answers provided)";
  return Object.entries(answers)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
}

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ScopeRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    projectId,
    activeSpreadsheetId,
    phase,
    answers,
    generateSectionIds,
    generateOther,
    message,
    history,
  } = body;

  if (!projectId || !phase) {
    return NextResponse.json({ error: "projectId and phase are required" }, { status: 400 });
  }

  if (phase === "refine" && !message?.trim()) {
    return NextResponse.json({ error: "message is required for refine phase" }, { status: 400 });
  }

  const userMessageForContext =
    phase === "refine"
      ? message?.trim()
      : [
          answers?.project_type,
          answers?.generate_sections,
          answers?.optional_notes,
          generateSectionIds,
          generateOther,
        ]
          .filter(Boolean)
          .join(" ");

  const fullContext = await buildFullProjectContext(supabase, projectId, {
    activeSpreadsheetId: activeSpreadsheetId ?? null,
    userMessage: userMessageForContext,
    userId: user.id,
  });

  if (!fullContext) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const contextBlock = fullContext.combinedPrompt;

  try {
    if (phase === "questions") {
      return NextResponse.json(
        { error: "Dynamic questions are disabled. Use the in-app questionnaire." },
        { status: 400 },
      );
    }

    if (phase === "generate") {
      const sectionIds = (generateSectionIds ?? answers?.generate_section_ids ?? "scope_of_work")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const detailLevel = answers?.detail_level ?? "Standard";
      const otherLabel = generateOther ?? answers?.generate_other ?? "";

      const generateInstruction = buildScopeGenerateInstruction(
        sectionIds,
        detailLevel,
        otherLabel,
      );

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.5,
        messages: [
          { role: "system", content: `${SCOPE_SYSTEM_PROMPT}\n\n${generateInstruction}` },
          {
            role: "user",
            content: `--- QUOTE CONTEXT ---\n${contextBlock}\n\n--- USER PREFERENCES ---\n${formatAnswers(answers)}`,
          },
        ],
      });

      const content = completion.choices[0]?.message?.content?.trim() ?? "";
      return NextResponse.json({ phase: "generate", content });
    }

    const historyMessages = (history ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-12)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.6,
      messages: [
        { role: "system", content: `${SCOPE_SYSTEM_PROMPT}\n\n${SCOPE_REFINE_INSTRUCTION}` },
        {
          role: "user",
          content: `--- QUOTE CONTEXT (reference) ---\n${contextBlock}`,
        },
        ...historyMessages,
        { role: "user", content: message!.trim() },
      ],
    });

    const content = completion.choices[0]?.message?.content?.trim() ?? "";
    return NextResponse.json({ phase: "refine", content });
  } catch (err) {
    console.error("[scope] error", err);
    const msg = err instanceof Error ? err.message : "Scope generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
