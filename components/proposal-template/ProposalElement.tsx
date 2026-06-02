"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Calendar,
  CheckSquare,
  Copy,
  FileSignature,
  FileText,
  GripVertical,
  ImageIcon,
  MoreVertical,
  Paperclip,
  Pen,
  Plus,
  Trash2,
  Type,
  Upload,
  Variable,
} from "lucide-react";
import { ELEMENT_LABELS, ProposalRecipient, ResizeHandle, TemplateElement, signerColor } from "./proposalTemplateTypes";
import { PAGE_HEIGHT, PAGE_WIDTH } from "./ProposalPage";
import SignatureModal from "./SignatureModal";
import DatePickerPopup from "./DatePickerPopup";
import QuoteBlock, { QuoteWithProfile } from "./QuoteBlock";

const ELEMENT_ICONS: Record<string, React.ReactNode> = {
  text: <Type size={13} />,
  image: <ImageIcon size={13} />,
  attachment: <Paperclip size={13} />,
  signature: <FileSignature size={13} />,
  date: <Calendar size={13} />,
  initial: <Pen size={13} />,
  checkbox: <CheckSquare size={13} />,
  custom_variable: <Variable size={13} />,
  quote: <FileText size={13} />,
};

interface ProposalElementProps {
  element: TemplateElement;
  isSelected: boolean;
  isReadOnly?: boolean;
  showOverflowWarning?: boolean;
  recipients?: ProposalRecipient[];
  /** Pre-fetched quote data keyed by quoteId (used in export mode to skip client-side fetches) */
  quoteDataMap?: Record<string, QuoteWithProfile>;
  onSelect: (id: string) => void;
  onMoveStart: (id: string, startX: number, startY: number) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onContentChange: (id: string, content: string) => void;
  /**
   * Called instead of onContentChange when a custom_variable element's value
   * changes. Receives the variable's name and new value so the caller can sync
   * every matching custom_variable across the whole document.
   */
  onCustomVarSync?: (variableName: string, content: string) => void;
  onHeightChange: (id: string, height: number) => void;
  onInsertAfter: (id: string, anchorX: number, anchorY: number) => void;
  onResizeStart: (id: string, handle: ResizeHandle, clientX: number, clientY: number, startEl: { x: number; y: number; w: number; h: number; elementType?: string }) => void;
  onAlignImage: (id: string, targetX: number) => void;
  onVariableNameChange?: (id: string, name: string) => void;
  /** Called when the user clicks "Change Quote" on a quote element in editor mode */
  onChangeQuote?: (elementId: string) => void;
}

export default function ProposalElement({
  element,
  isSelected,
  isReadOnly = false,
  showOverflowWarning = false,
  recipients = [],
  quoteDataMap,
  onSelect,
  onMoveStart,
  onDuplicate,
  onDelete,
  onContentChange,
  onCustomVarSync,
  onHeightChange,
  onInsertAfter,
  onResizeStart,
  onAlignImage,
  onVariableNameChange,
  onChangeQuote,
}: ProposalElementProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showQuoteMenu, setShowQuoteMenu] = useState(false);
  const [varIsEditing, setVarIsEditing] = useState(false);
  const [varDraft, setVarDraft] = useState("");
  const quoteMenuRef = useRef<HTMLDivElement>(null);
  const editableRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const varValueRef = useRef<HTMLInputElement>(null);
  const assignDropdownRef = useRef<HTMLDivElement>(null);
  // Track when the user is editing so we don't stomp innerHTML mid-keystroke
  const isFocused = useRef(false);

  const { id, type, x, y, w, h, content, styles } = element;

  const commitVarValue = useCallback(
    (value: string) => {
      if (onCustomVarSync && element.variableName) {
        onCustomVarSync(element.variableName, value);
      } else {
        onContentChange(id, value);
      }
    },
    [id, element.variableName, onCustomVarSync, onContentChange]
  );

  const beginVarEdit = useCallback(() => {
    setVarIsEditing(true);
    setVarDraft("");
    setTimeout(() => varValueRef.current?.focus(), 0);
  }, []);

  const endVarEdit = useCallback(
    (value: string) => {
      setVarIsEditing(false);
      commitVarValue(value);
    },
    [commitVarValue]
  );

  useEffect(() => {
    setVarIsEditing(false);
    setVarDraft("");
  }, [id]);

  // Track previous selection state so we can detect when the element is selected
  // programmatically (e.g. from the field manager) vs. by a direct click.
  const wasSelectedRef = useRef(false);
  useEffect(() => {
    const justSelected = isSelected && !wasSelectedRef.current;
    wasSelectedRef.current = isSelected;
    if (!justSelected || isReadOnly || isFocused.current) return;
    // Focus the editable when the element is selected via the field manager panel
    if (type === "text") {
      setTimeout(() => editableRef.current?.focus(), 150);
    } else if (type === "custom_variable") {
      setTimeout(() => beginVarEdit(), 150);
    }
  }, [isSelected, isReadOnly, type, beginVarEdit]);

  // For recipient-assignable elements: look up the assigned recipient by email stored in variableName
  const ASSIGNABLE_TYPES = ["signature", "initial", "date", "checkbox"];
  const isAssignable = ASSIGNABLE_TYPES.includes(type);
  const assignedRecipientIndex = isAssignable
    ? recipients.findIndex((r) => r.email.toLowerCase() === (element.variableName ?? "").toLowerCase())
    : -1;
  const assignedRecipient = assignedRecipientIndex >= 0 ? recipients[assignedRecipientIndex] : undefined;

  // Close assign dropdown on outside click
  useEffect(() => {
    if (!showAssignDropdown) return;
    const handleOutside = (e: MouseEvent) => {
      if (assignDropdownRef.current && !assignDropdownRef.current.contains(e.target as Node)) {
        setShowAssignDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showAssignDropdown]);

  // Close quote menu on outside click
  useEffect(() => {
    if (!showQuoteMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (quoteMenuRef.current && !quoteMenuRef.current.contains(e.target as Node)) {
        setShowQuoteMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showQuoteMenu]);

  // The maximum pixel height this text box can occupy on the page.
  // Computed once from the element's y position — no render cycle needed.
  const MAX_H = Math.max(40, PAGE_HEIGHT - y - 40);

  // Ref-based limit flag so handleKeyDown can block input synchronously,
  // without waiting for a React render cycle after handleHeightChange fires.
  const isAtLimitRef = useRef(false);

  const baseStyle: React.CSSProperties = {
    fontSize: styles.fontSize,
    fontFamily: styles.fontFamily,
    color: styles.color,
  };

  // Keep innerHTML in sync when content is updated externally (load / undo)
  useEffect(() => {
    if (type !== "text") return;
    if (!editableRef.current || isFocused.current) return;
    if (editableRef.current.innerHTML !== (content || "")) {
      editableRef.current.innerHTML = content || "";
    }
  }, [content, type]);

  const syncHeight = () => {
    if (!editableRef.current) return;
    const scrollH = editableRef.current.scrollHeight;
    // Update the ref synchronously so the very next keydown sees the correct state
    isAtLimitRef.current = scrollH >= MAX_H;
    onHeightChange(id, Math.max(40, scrollH));
  };

  const handleInput = () => {
    if (!editableRef.current) return;
    onContentChange(id, editableRef.current.innerHTML);
    syncHeight();
  };

  // No keyboard blocker — users can edit anywhere inside the box.
  // The maxHeight + overflowY:hidden CSS on the contentEditable hard-caps the
  // visible area; the onScroll reset keeps the top anchored so existing text
  // stays in view. isAtLimitRef still drives the warning bar via onHeightChange.

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isReadOnly) return;
    if (e.target instanceof HTMLElement && e.target.isContentEditable) return;
    if (e.target instanceof HTMLInputElement) return;
    e.stopPropagation();
    onSelect(id);
    onMoveStart(id, e.clientX, e.clientY);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isReadOnly) return;
    e.stopPropagation();
    onSelect(id);
    if (type === "text") {
      setTimeout(() => editableRef.current?.focus(), 0);
    }
    if (type === "custom_variable") {
      setTimeout(() => beginVarEdit(), 0);
    }
  };

  const renderContent = () => {
    if (type === "text") {
      return (
        <div
          ref={editableRef}
          contentEditable={!isReadOnly}
          suppressContentEditableWarning
          onFocus={() => { isFocused.current = true; }}
          onBlur={() => {
            isFocused.current = false;
            // Final sync on blur
            if (editableRef.current) onContentChange(id, editableRef.current.innerHTML);
          }}
          onInput={handleInput}
          onPaste={() => setTimeout(syncHeight, 0)}
          onMouseDown={(e) => e.stopPropagation()}
          data-placeholder="Type here…"
          className="w-full outline-none px-1 leading-relaxed break-words min-h-[40px] empty:before:content-[attr(data-placeholder)] empty:before:text-gray-300 empty:before:pointer-events-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
          style={{
            ...baseStyle,
            // In edit mode, cap height at the page boundary so text can't
            // run off the bottom. In read-only / export mode remove all
            // clipping so every line renders fully — overflowY:hidden can
            // slice the last line mid-glyph, which shows up clearly in PDFs.
            ...(isReadOnly ? {} : {
              maxHeight: MAX_H,
              overflowY: "hidden" as const,
            }),
          }}
          onScroll={() => {
            // The browser silently changes scrollTop to keep the cursor in view.
            // Resetting it to 0 keeps existing text visible and pushes new
            // overflow out the bottom (clipped) rather than the top.
            if (editableRef.current) editableRef.current.scrollTop = 0;
          }}
        />
      );
    }

    if (type === "image") {
      const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = ""; // reset so same file can be re-selected

        const objectUrl = URL.createObjectURL(file);
        const img = new window.Image();
        img.onload = () => {
          // Cap the longest edge at 1 400 px to keep the DataURL small enough
          // to fit in a Supabase JSONB column and avoid network-payload issues.
          const MAX_DIM = 1400;
          let { width: w, height: h } = img;
          if (w > MAX_DIM || h > MAX_DIM) {
            if (w >= h) { h = Math.round((h * MAX_DIM) / w); w = MAX_DIM; }
            else        { w = Math.round((w * MAX_DIM) / h); h = MAX_DIM; }
          }
          const canvas = document.createElement("canvas");
          canvas.width  = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          URL.revokeObjectURL(objectUrl);
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, w, h);
          onContentChange(id, canvas.toDataURL("image/jpeg", 0.82));
        };
        img.onerror = () => URL.revokeObjectURL(objectUrl);
        img.src = objectUrl;
      };

      return (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          {content ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={content}
              alt="Uploaded"
              className="w-full h-full object-contain select-none"
              draggable={false}
            />
          ) : (
            /* Placeholder — click does NOT open file picker; use the Upload button in the toolbar */
            <div className="w-full h-full flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded bg-gray-50 text-gray-400 gap-2 pointer-events-none select-none">
              <ImageIcon size={22} />
              <span className="text-xs font-medium">Select element, then use Upload ↑</span>
            </div>
          )}
        </>
      );
    }

    // ── Quote element ─────────────────────────────────────────────────────────
    if (type === "quote") {
      // Parse stored JSON content: { quoteId, quoteName, quoteNumber }
      let quoteId = "";
      let quoteName = "";
      let quoteNumber = "";
      try {
        const parsed = JSON.parse(content || "{}");
        quoteId = parsed.quoteId ?? "";
        quoteName = parsed.quoteName ?? "";
        quoteNumber = parsed.quoteNumber ?? "";
      } catch {
        // malformed content — treat as empty
      }

      // Read-only / export: render the full quote table with full-page padding
      if (isReadOnly) {
        return (
          <div className="w-full" style={{ padding: "40px 48px" }}>
            <QuoteBlock
              quoteId={quoteId}
              preloadedData={quoteId ? quoteDataMap?.[quoteId] : undefined}
            />
          </div>
        );
      }

      // Editor mode: compact placeholder row
      const displayName = quoteName
        ? `#${quoteNumber} — ${quoteName}`
        : "Select a quote…";

      return (
        <div className="w-full h-full flex items-center gap-2 px-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-700 select-none overflow-hidden">
          <FileText size={14} className="text-gray-400 flex-shrink-0" />
          <span className="flex-1 truncate font-medium">{displayName}</span>
          {/* Three-dot menu */}
          <div className="relative flex-shrink-0" ref={quoteMenuRef}>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(id);
                setShowQuoteMenu((v) => !v);
              }}
              className="p-1 rounded hover:bg-gray-200 text-gray-500 transition-colors"
              title="Quote options"
            >
              <MoreVertical size={14} />
            </button>
            {showQuoteMenu && (
              <div
                className="absolute right-0 top-full mt-1 z-[60] bg-white border border-gray-200 rounded-lg shadow-xl w-40"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowQuoteMenu(false);
                    onChangeQuote?.(id);
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Change Quote
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowQuoteMenu(false);
                    onDelete(id);
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    // ── Custom Variable — chip when idle; empty cursor while editing ────────
    if (type === "custom_variable") {
      const varFontStyle: React.CSSProperties = {
        fontSize: styles.fontSize,
        fontFamily: styles.fontFamily,
        color: styles.color,
      };
      const fieldNameLabel = element.variableName
        ? `[${element.variableName}]`
        : null;
      const hasValue = Boolean((element.content || "").trim());
      const chipOnlyLayout = Boolean(fieldNameLabel) && !hasValue && !varIsEditing;

      const fieldNameBadge = fieldNameLabel ? (
        <span
          className="relative z-[1] flex-shrink-0 px-2 py-0.5 rounded-sm bg-[#fef08a] text-black leading-tight select-none pointer-events-none"
          style={{ fontSize: styles.fontSize ?? 14, fontFamily: styles.fontFamily }}
          aria-hidden
        >
          {fieldNameLabel}
        </span>
      ) : null;

      const varBoxClass =
        "relative w-full h-full box-border rounded-md border border-gray-300 bg-white flex items-center overflow-hidden px-2 py-1 min-w-0";

      const editingInput = (
        <input
          ref={varValueRef}
          type="text"
          value={varDraft}
          onChange={(e) => setVarDraft(e.target.value)}
          onBlur={(e) => endVarEdit(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder=""
          className="relative z-[1] w-full min-w-0 border-0 outline-none bg-transparent p-0 m-0 h-auto caret-black"
          style={varFontStyle}
        />
      );

      // Read-only / export — chip when empty, saved value only when filled
      if (isReadOnly) {
        return (
          <div
            className={`${varBoxClass} ${chipOnlyLayout ? "justify-center" : "justify-start"}`}
            style={varFontStyle}
          >
            {!hasValue && fieldNameBadge}
            {hasValue && <span className="truncate min-w-0">{element.content}</span>}
          </div>
        );
      }

      if (varIsEditing) {
        return (
          <div
            className={`${varBoxClass} justify-start`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {editingInput}
          </div>
        );
      }

      // Idle: chip when empty; saved value only after blur (replaces chip)
      return (
        <div
          className={`${varBoxClass} ${
            chipOnlyLayout ? "justify-center" : "justify-start"
          }`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {!hasValue && fieldNameBadge}
          {hasValue && (
            <span className="relative z-[1] truncate min-w-0" style={varFontStyle}>
              {element.content}
            </span>
          )}
        </div>
      );
    }

    const label = ELEMENT_LABELS[type];
    const icon = ELEMENT_ICONS[type];
    const bgColors: Record<string, string> = {
      signature: "bg-blue-50 border-blue-200 text-blue-600",
      date: "bg-yellow-50 border-yellow-200 text-yellow-700",
      initial: "bg-purple-50 border-purple-200 text-purple-600",
      attachment: "bg-gray-50 border-gray-200 text-gray-600",
    };
    const colorClass = bgColors[type] ?? "bg-gray-50 border-gray-200 text-gray-600";

    // ── Assignable elements: signature, initial, date, checkbox ─────────────
    if (isAssignable) {
      const assignedColor = assignedRecipient ? signerColor(assignedRecipientIndex) : null;
      const boxStyle: React.CSSProperties = assignedColor
        ? {
            backgroundColor: `${assignedColor}18`,
            borderColor: `${assignedColor}66`,
            color: assignedColor,
          }
        : {};

      // ── READ-ONLY / EXPORT rendering ──────────────────────────────────────
      // Use position:absolute + inset:0 so the box fills the outer element div
      // directly, bypassing the h-full chain through a border-box container.
      // html2canvas mis-measures height when h-full passes through a border:1px
      // border-box element, causing content to mis-align or be clipped in PDFs.
      // The editor path below keeps the original structure and click handlers.
      if (isReadOnly) {
        // Default theme colors (mirrors the colorClass strings)
        const themeColors: Record<string, { border: string; bg: string; text: string }> = {
          signature:  { border: "#bfdbfe", bg: "#eff6ff",  text: "#2563eb" },
          date:       { border: "#fde68a", bg: "#fefce8",  text: "#92400e" },
          initial:    { border: "#ddd6fe", bg: "#f5f3ff",  text: "#7c3aed" },
          attachment: { border: "#e5e7eb", bg: "#f9fafb",  text: "#4b5563" },
        };
        const theme = themeColors[type] ?? { border: "#e5e7eb", bg: "#f9fafb", text: "#4b5563" };

        const baseStyle: React.CSSProperties = {
          position: "absolute",
          top: 0, bottom: 0, left: 0, right: 0,
          borderRadius: "4px",
          border: "1px solid",
          fontSize: "12px",
          fontWeight: 500,
          boxSizing: "border-box",
          // Use the recipient's color when assigned, otherwise the theme color.
          borderColor:     assignedColor ? `${assignedColor}66` : theme.border,
          backgroundColor: assignedColor ? `${assignedColor}18` : theme.bg,
          color:           assignedColor ?? theme.text,
        };

        // ── Checkbox ──────────────────────────────────────────────────────
        if (type === "checkbox") {
          return (
            <div style={{ ...baseStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {element.content === "checked" ? (
                <svg viewBox="0 0 24 24" fill="none" style={{ width: "50%", height: "50%", color: assignedColor ?? "#374151" }}>
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <div style={{ width: 20, height: 20, border: `2px solid ${assignedColor ?? "#6b7280"}`, borderRadius: 4 }} />
              )}
            </div>
          );
        }

        // ── Drawn signature / initial (data: URI) ─────────────────────────
        if ((type === "signature" || type === "initial") && element.content?.startsWith("data:")) {
          return (
            <div style={baseStyle}>
              <img
                src={element.content}
                alt={label}
                style={{ width: "100%", height: "100%", objectFit: "contain", padding: "4px", display: "block" }}
                draggable={false}
              />
            </div>
          );
        }

        // ── Typed (cursive) signature / initial ───────────────────────────
        if ((type === "signature" || type === "initial") && element.content?.startsWith("type:")) {
          const text = element.content.slice(5);
          return (
            <div style={{ ...baseStyle, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 12px" }}>
              <span
                style={{
                  fontFamily: "'Dancing Script', 'Brush Script MT', cursive",
                  fontSize: Math.min(h * 0.40, 28),
                  color: assignedColor ?? "#111",
                  lineHeight: "normal",
                  whiteSpace: "nowrap",
                  overflow: "visible",
                  display: "block",
                  textAlign: "center",
                  width: "100%",
                }}
              >
                {text}
              </span>
            </div>
          );
        }

        // ── Date (with content) ───────────────────────────────────────────
        if (type === "date" && element.content) {
          let dateStr = label;
          try {
            const d = new Date(element.content + "T12:00:00");
            dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          } catch { /* use label as fallback */ }
          return (
            <div style={{ ...baseStyle, display: "flex", alignItems: "center", gap: "6px", paddingLeft: "12px", paddingRight: "12px" }}>
              {icon}
              <span style={{ fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap" }}>{dateStr}</span>
            </div>
          );
        }

        // ── Unassigned / empty placeholder (signature, initial, date, attachment) ──
        return (
          <div style={{ ...baseStyle, display: "flex", alignItems: "center", gap: "6px", paddingLeft: "12px", paddingRight: "12px" }}>
            {icon}
            <span style={{ fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap" }}>{label}</span>
          </div>
        );
      }

      // ── EDITOR / INTERACTIVE rendering ────────────────────────────────────
      let innerContent: React.ReactNode;

      if (type === "checkbox") {
        if (element.content === "checked") {
          innerContent = (
            <div className="w-full h-full flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-1/2 h-1/2" style={{ color: assignedColor ?? "#374151" }}>
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          );
        } else {
          innerContent = (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-5 h-5 border-2 rounded" style={{ borderColor: assignedColor ?? "#6b7280" }} />
            </div>
          );
        }
      } else if (type === "date" && element.content) {
        try {
          const d = new Date(element.content + "T12:00:00");
          innerContent = (
            <div className="flex items-center gap-1.5 px-3 w-full h-full">
              {icon}
              <span className="text-xs font-medium whitespace-nowrap">
                {d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
          );
        } catch {
          innerContent = <div className="flex items-center gap-1.5 px-3">{icon}<span className="truncate text-xs">{label}</span></div>;
        }
      } else if ((type === "signature" || type === "initial") && element.content) {
        if (element.content.startsWith("data:")) {
          innerContent = (
            <img
              src={element.content}
              alt={label}
              className="w-full h-full object-contain p-1"
              draggable={false}
            />
          );
        } else if (element.content.startsWith("type:")) {
          const text = element.content.slice(5);
          innerContent = (
            <div className="w-full h-full flex items-center justify-center px-3" style={{ overflow: "visible" }}>
              <span
                style={{
                  fontFamily: "'Dancing Script', 'Brush Script MT', cursive",
                  fontSize: Math.min(h * 0.40, 28),
                  color: assignedColor ?? "#111",
                  lineHeight: "normal",
                  whiteSpace: "nowrap",
                  overflow: "visible",
                  display: "block",
                  textAlign: "center",
                  width: "100%",
                }}
              >
                {text}
              </span>
            </div>
          );
        } else {
          innerContent = <div className="flex items-center gap-1.5 px-3">{icon}<span className="truncate text-xs">{label}</span></div>;
        }
      } else {
        innerContent = (
          <div className="flex items-center gap-1.5 px-3 w-full h-full">
            {icon}
            <span className="truncate text-xs">{label}</span>
          </div>
        );
      }

      return (
        <div
          className={`rounded border text-xs font-medium w-full h-full overflow-hidden cursor-pointer select-none ${assignedColor ? "" : colorClass}`}
          style={boxStyle}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(id);
            if (assignedRecipient) {
              if (type === "checkbox") {
                onContentChange(id, element.content === "checked" ? "" : "checked");
              } else if (type === "date") {
                setShowAssignDropdown(false);
                setShowDatePicker((v) => !v);
              } else {
                setShowAssignDropdown(false);
                setShowSignatureModal(true);
              }
            } else {
              setShowDatePicker(false);
              setShowSignatureModal(false);
              setShowAssignDropdown((v) => !v);
            }
          }}
        >
          {innerContent}
        </div>
      );
    }

    return (
      <div
        className={`flex items-center gap-1.5 px-3 py-1 rounded border ${colorClass} text-xs font-medium w-full h-full ${!isReadOnly ? "overflow-hidden" : ""}`}
      >
        {icon}
        <span className="truncate">
          {element.variableName ? `{{${element.variableName}}}` : label}
        </span>
      </div>
    );
  };

  return (
    <div
      style={
        // Quote in read-only/PDF mode: override absolute position to fill the
        // entire page (left:0 top:0 full-width auto-height). The stored x/y/w/h
        // is only used in editor mode to show the compact placeholder row.
        type === "quote" && isReadOnly
          ? {
              position: "absolute",
              left: 0,
              top: 0,
              width: PAGE_WIDTH,
              height: "auto",
              minHeight: PAGE_HEIGHT,
            }
          : {
              position: "absolute",
              left: x,
              top: y,
              width: w,
              // Edit mode: text grows with content.
              // Read-only: clip to stored height so PDF matches preview.
              // Non-text elements use fixed stored height.
              ...(type === "text"
                ? (isReadOnly
                    ? { height: Math.max(h, 40), overflow: "hidden" }
                    : { minHeight: 40 })
                : { height: h }),
            }
      }
      data-element-id={id}
      className="group/el"
      onMouseEnter={() => !isReadOnly && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      <div
        className={`w-full h-full ${
          isSelected && !isReadOnly
            ? "outline outline-2 outline-blue-500 outline-offset-1"
            : isHovered && !isReadOnly
            ? "outline outline-1 outline-gray-300 outline-offset-1"
            : ""
        }`}
      >
        {renderContent()}
      </div>

      {/* Image toolbar — replaces label bar for image elements */}
      {isSelected && !isReadOnly && type === "image" && (
        <div
          className="absolute -top-9 left-0 flex items-center gap-0.5 bg-gray-800 rounded px-1.5 py-1 text-white select-none z-20 shadow-lg"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <GripVertical size={12} className="cursor-move text-gray-400 mr-0.5" />
          {/* Upload / replace */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              // setTimeout lets the browser settle React's event batch before opening the
              // file picker — without it, programmatic .click() is sometimes silently ignored.
              setTimeout(() => fileInputRef.current?.click(), 0);
            }}
            className="flex items-center gap-1 px-1.5 p-1 hover:bg-gray-600 rounded transition-colors text-xs"
            title="Upload / replace image"
          >
            <Upload size={13} />
            <span>Upload</span>
          </button>
          <div className="w-px h-4 bg-gray-600 mx-0.5" />
          {/* Duplicate */}
          <button
            onClick={(e) => { e.stopPropagation(); onDuplicate(id); }}
            className="p-1 hover:bg-gray-600 rounded transition-colors"
            title="Duplicate"
          ><Copy size={13} /></button>
          {/* Delete */}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(id); }}
            className="p-1 hover:bg-red-500 rounded transition-colors"
            title="Delete"
          ><Trash2 size={13} /></button>
        </div>
      )}

      {/* Standard selection label bar for non-image elements */}
      {isSelected && !isReadOnly && type !== "image" && (
        <div
          className={`absolute left-0 flex items-center gap-0.5 bg-blue-500 rounded-t px-1.5 py-0.5 text-white select-none z-20 shadow-sm ${
            type === "custom_variable" ? "-top-7" : "-top-6"
          }`}
        >
          <GripVertical size={11} className="cursor-move" />
          <span
            className={`text-[10px] font-medium font-mono ${isAssignable ? "cursor-pointer hover:text-blue-200" : ""}`}
            onClick={isAssignable ? (e) => { e.stopPropagation(); setShowAssignDropdown((v) => !v); } : undefined}
          >
            {isAssignable && assignedRecipient
              ? `${assignedRecipient.first_name} ${assignedRecipient.last_name}`
              : type === "custom_variable" && element.variableName
              ? `{{${element.variableName}}}`
              : ELEMENT_LABELS[type]}
          </span>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDuplicate(id); }}
            className="ml-1 hover:text-blue-200 transition-colors"
            title="Duplicate"
          >
            <Copy size={11} />
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete(id); }}
            className="hover:text-red-300 transition-colors"
            title="Delete"
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}

      {/* Corner resize handles — image (aspect-ratio locked), custom_variable and all assignable types (free-form) */}
      {isSelected && !isReadOnly && (type === "image" || type === "custom_variable" || isAssignable) && (
        [
          { handle: "nw" as ResizeHandle, style: { top: -6, left: -6 },     cursor: "cursor-nw-resize" },
          { handle: "ne" as ResizeHandle, style: { top: -6, right: -6 },    cursor: "cursor-ne-resize" },
          { handle: "se" as ResizeHandle, style: { bottom: -6, right: -6 }, cursor: "cursor-se-resize" },
          { handle: "sw" as ResizeHandle, style: { bottom: -6, left: -6 },  cursor: "cursor-sw-resize" },
        ].map(({ handle, style, cursor }) => (
          <div
            key={handle}
            style={{ position: "absolute", width: 12, height: 12, zIndex: 50, pointerEvents: "all", ...style }}
            className={`bg-white border-2 border-blue-500 rounded-sm ${cursor}`}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onResizeStart(id, handle, e.clientX, e.clientY, { x, y, w, h, elementType: type });
            }}
          />
        ))
      )}

      {/* Signature recipient assignment dropdown */}
      {showAssignDropdown && !isReadOnly && isAssignable && (
        <div
          ref={assignDropdownRef}
          className="absolute left-0 top-full mt-1 z-[60] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl w-64"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <p className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-700">
            Who needs to fill this out?
          </p>
          <div className="max-h-56 overflow-y-auto">
            {!recipients.some((r) => r.role === "signer") ? (
              <p className="px-4 py-3 text-sm text-gray-400">No signers added yet. Go to the Recipients tab to add signers.</p>
            ) : (
              recipients.map((r, rIdx) => {
                // Only signers can be assigned to signing fields; skip CC recipients.
                // rIdx is preserved from the full list so colors stay consistent.
                if (r.role !== "signer") return null;

                const fullName = `${r.first_name} ${r.last_name}`.trim();
                const rInitials = `${r.first_name[0] ?? ""}${r.last_name[0] ?? ""}`.toUpperCase();
                const isAssigned = r.email.toLowerCase() === (element.variableName ?? "").toLowerCase();
                const color = signerColor(rIdx);
                return (
                  <button
                    key={r.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onVariableNameChange?.(id, r.email);
                      setShowAssignDropdown(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-left transition-colors ${isAssigned ? "bg-blue-50 dark:bg-blue-900/20" : ""}`}
                  >
                    <div
                      className="w-8 h-8 rounded-full text-white flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ backgroundColor: color }}
                    >
                      {rInitials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {fullName} <span className="font-normal text-xs" style={{ color }}>Signer</span>
                      </p>
                      <p className="text-xs text-gray-500 truncate">{r.email}</p>
                    </div>
                    {isAssigned && (
                      <div className="ml-auto w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    )}
                  </button>
                );
              })
            )}
          </div>
          {recipients.length > 0 && (
            <div className="border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (element.variableName) {
                    onVariableNameChange?.(id, "");
                  }
                  setShowAssignDropdown(false);
                }}
                className="w-full px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 text-left transition-colors"
              >
                {element.variableName ? "Remove assignment" : "No recipient"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Hover "+" insert-below button */}
      {isHovered && !isSelected && !isReadOnly && (
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            onInsertAfter(id, rect.left + rect.width / 2, rect.top);
          }}
          title="Insert element below"
          className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 z-20
            w-6 h-6 rounded-full bg-white border border-gray-300 shadow
            flex items-center justify-center text-gray-500
            hover:border-blue-400 hover:text-blue-500 hover:shadow-md transition-all"
        >
          <Plus size={13} />
        </button>
      )}

      {/* Date picker popup (anchored below the element) */}
      {showDatePicker && !isReadOnly && type === "date" && (
        <DatePickerPopup
          value={element.content || undefined}
          onSelect={(iso) => { onContentChange(id, iso); setShowDatePicker(false); }}
          onClear={() => { onContentChange(id, ""); }}
          onClose={() => setShowDatePicker(false)}
        />
      )}

      {/* Signature / initial modal (fixed overlay, rendered via portal-like fixed positioning) */}
      {showSignatureModal && !isReadOnly && (type === "signature" || type === "initial") && (
        <SignatureModal
          mode={type}
          defaultText={
            type === "initial" && assignedRecipient
              ? `${assignedRecipient.first_name[0] ?? ""}${assignedRecipient.last_name[0] ?? ""}.`
              : assignedRecipient
              ? `${assignedRecipient.first_name} ${assignedRecipient.last_name}`
              : ""
          }
          onAccept={(content) => { onContentChange(id, content); setShowSignatureModal(false); }}
          onCancel={() => setShowSignatureModal(false)}
        />
      )}
    </div>
  );
}
