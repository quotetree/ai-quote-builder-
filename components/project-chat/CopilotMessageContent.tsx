"use client";

import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";
import {
  deriveLinkLabel,
  preprocessCopilotContent,
  type SourceLink,
} from "@/lib/copilot/formatMessageContent";

interface CopilotMessageContentProps {
  content: string;
  sources?: SourceLink[];
}

function getLinkLabel(href: string | undefined, children: ReactNode, sources?: SourceLink[]): string {
  const childText = String(children ?? "").trim();
  if (
    childText &&
    href &&
    childText !== href &&
    !childText.startsWith("http://") &&
    !childText.startsWith("https://")
  ) {
    return childText;
  }
  return deriveLinkLabel(href ?? "", sources);
}

function buildMarkdownComponents(sources?: SourceLink[]): Components {
  return {
    h1: ({ children }) => (
      <h3 className="text-base font-semibold text-gray-900 mt-4 mb-2 first:mt-0">{children}</h3>
    ),
    h2: ({ children }) => (
      <h3 className="text-sm font-semibold text-gray-900 mt-4 mb-2 first:mt-0">{children}</h3>
    ),
    h3: ({ children }) => (
      <h4 className="text-sm font-semibold text-gray-800 mt-3 mb-1.5 first:mt-0">{children}</h4>
    ),
    p: ({ children }) => (
      <p className="text-sm text-gray-800 leading-relaxed mb-3 last:mb-0">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="text-sm text-gray-800 list-disc pl-5 space-y-1.5 mb-3 last:mb-0">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="text-sm text-gray-800 list-decimal pl-5 space-y-1.5 mb-3 last:mb-0">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed pl-0.5">{children}</li>,
    strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
    em: ({ children }) => <em className="text-gray-700 not-italic">{children}</em>,
    hr: () => <hr className="my-4 border-gray-200" />,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-green-600/40 pl-3 my-3 text-sm text-gray-600 italic">
        {children}
      </blockquote>
    ),
    code: ({ children }) => (
      <code className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono text-gray-800">{children}</code>
    ),
    pre: ({ children }) => (
      <pre className="rounded-lg bg-gray-100 border border-gray-200 px-3 py-2 text-xs overflow-x-auto mb-3">
        {children}
      </pre>
    ),
    a: ({ href, children }) => {
      const label = getLinkLabel(href, children, sources);
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800 hover:bg-green-100 hover:text-green-900 transition-colors no-underline"
        >
          <span>{label}</span>
          <ExternalLink size={11} className="shrink-0 opacity-70" aria-hidden />
        </a>
      );
    },
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-xs text-left">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-gray-100 text-gray-700 font-medium">{children}</thead>,
    th: ({ children }) => (
      <th className="px-3 py-2 border-b border-gray-200 font-semibold">{children}</th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-2 border-b border-gray-100 text-gray-800">{children}</td>
    ),
  };
}

export default function CopilotMessageContent({ content, sources }: CopilotMessageContentProps) {
  const processed = preprocessCopilotContent(content, {
    sources,
    stripSourcesSection: Boolean(sources && sources.length > 0),
  });

  return (
    <div className="max-w-[38rem] copilot-message-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={buildMarkdownComponents(sources)}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}
