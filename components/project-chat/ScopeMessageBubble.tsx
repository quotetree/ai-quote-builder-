"use client";

import MessageAttachmentList, {
  type MessageAttachmentMeta,
} from "./MessageAttachmentList";
import CopilotMessageContent from "./CopilotMessageContent";
import ReferencedSourcesAccordion from "./ReferencedSourcesAccordion";
import DocumentReferencesAccordion from "./DocumentReferencesAccordion";

interface ScopeMessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  sources?: { title: string; url: string }[];
  documentCitations?: { fileName: string; pageStart: number; pageEnd: number }[];
  attachments?: MessageAttachmentMeta[];
}

export default function ScopeMessageBubble({
  role,
  content,
  sources,
  documentCitations,
  attachments,
}: ScopeMessageBubbleProps) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[95%] flex flex-col ${isUser ? "items-end" : "items-start"}`}>
        {isUser && attachments && attachments.length > 0 && (
          <MessageAttachmentList attachments={attachments} variant="message" />
        )}
        <div
          className={`w-full rounded-lg px-3 py-2.5 ${
            isUser ? "bg-gray-900 text-white text-sm" : "bg-gray-50 border border-gray-200"
          }`}
        >
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{content}</p>
          ) : (
            <>
              <CopilotMessageContent content={content} sources={sources} />
              {documentCitations && documentCitations.length > 0 && (
                <DocumentReferencesAccordion citations={documentCitations} />
              )}
              {sources && sources.length > 0 && (
                <ReferencedSourcesAccordion sources={sources} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
