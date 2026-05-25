"use client";

function renderSimpleMarkdown(text: string) {
  const parts = text.split(/(^## .+$)/gm).filter(Boolean);
  if (parts.length <= 1) {
    return (
      <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{text}</div>
    );
  }
  return (
    <div className="space-y-3">
      {parts.map((part, i) => {
        if (part.startsWith("## ")) {
          return (
            <h3 key={i} className="text-sm font-semibold text-gray-900 mt-2 first:mt-0">
              {part.replace(/^##\s*/, "")}
            </h3>
          );
        }
        return (
          <div key={i} className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
            {part.trim()}
          </div>
        );
      })}
    </div>
  );
}

import MessageAttachmentList, {
  type MessageAttachmentMeta,
} from "./MessageAttachmentList";

interface ScopeMessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  sources?: { title: string; url: string }[];
  attachments?: MessageAttachmentMeta[];
}

export default function ScopeMessageBubble({
  role,
  content,
  sources,
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
          className={`w-full rounded-lg px-3 py-2 ${
            isUser ? "bg-gray-900 text-white text-sm" : "bg-gray-50 border border-gray-200"
          }`}
        >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{content}</p>
        ) : (
          <>
            {renderSimpleMarkdown(content)}
            {sources && sources.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-xs font-semibold text-gray-600 mb-1.5">Sources</p>
                <ul className="space-y-1">
                  {sources.map((s, i) => (
                    <li key={`${s.url}-${i}`}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-green-800 hover:underline break-all"
                      >
                        {s.title || s.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  );
}
