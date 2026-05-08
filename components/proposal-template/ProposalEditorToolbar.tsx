"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Underline,
  Undo2,
} from "lucide-react";
import { ElementStyles } from "./proposalTemplateTypes";

const FONT_FAMILIES = ["Arial", "Georgia", "Times New Roman", "Courier New", "Verdana", "Helvetica"];
const FONT_SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64];

interface ProposalEditorToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Element-level styles (font, size, color, list) — applied to the whole element */
  selectedStyles: ElementStyles | null;
  onStyleChange: (styles: Partial<ElementStyles>) => void;
  /** Per-selection / per-paragraph states (detected via queryCommandState + computed style) */
  commandStates?: {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    justifyLeft: boolean;
    justifyCenter: boolean;
    justifyRight: boolean;
    /** Font size at the current cursor / selection (px). When present, overrides element-level display. */
    fontSize?: number;
  };
  /** Apply font size to the current selection only (not the whole element). */
  onFontSizeChange?: (size: number) => void;
  disabled?: boolean;
}

/** Execute a document.execCommand without blurring the contentEditable */
const exec = (e: React.MouseEvent, command: string, value?: string) => {
  e.preventDefault(); // keep focus in contentEditable
  document.execCommand(command, false, value);
};

export default function ProposalEditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  selectedStyles,
  onStyleChange,
  onFontSizeChange,
  commandStates,
  disabled = false,
}: ProposalEditorToolbarProps) {
  const styles = selectedStyles;
  const hasElement = !!styles;

  /** Generic toolbar button */
  const Btn = ({
    active,
    onMouseDown,
    children,
    title,
  }: {
    active: boolean;
    onMouseDown: (e: React.MouseEvent) => void;
    children: React.ReactNode;
    title: string;
  }) => (
    <button
      onMouseDown={onMouseDown}
      disabled={disabled || !hasElement}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active ? "bg-gray-200 text-gray-900" : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      } disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-200 bg-white flex-wrap">
      {/* Undo / Redo */}
      <button
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo"
        className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <Undo2 size={15} />
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo"
        className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <Redo2 size={15} />
      </button>

      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* Font family */}
      <select
        value={styles?.fontFamily ?? "Arial"}
        onChange={(e) => onStyleChange({ fontFamily: e.target.value })}
        disabled={disabled || !hasElement}
        className="text-sm border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none"
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>

      {/* Font size — shows computed size at cursor; changes apply to selection only */}
      {(() => {
        const currentSize = commandStates?.fontSize ?? styles?.fontSize ?? 14;
        const sizeList = FONT_SIZES.includes(currentSize)
          ? FONT_SIZES
          : [...FONT_SIZES, currentSize].sort((a, b) => a - b);
        return (
          <select
            value={currentSize}
            onChange={(e) => {
              const size = Number(e.target.value);
              if (onFontSizeChange) {
                onFontSizeChange(size);
              } else {
                onStyleChange({ fontSize: size });
              }
            }}
            disabled={disabled || !hasElement}
            className="text-sm border border-gray-200 rounded px-2 py-1 w-16 bg-white text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none"
          >
            {sizeList.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        );
      })()}

      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* Bold / Italic / Underline — use execCommand via onMouseDown to preserve focus */}
      <Btn
        active={commandStates?.bold ?? false}
        onMouseDown={(e) => exec(e, "bold")}
        title="Bold"
      >
        <Bold size={15} />
      </Btn>
      <Btn
        active={commandStates?.italic ?? false}
        onMouseDown={(e) => exec(e, "italic")}
        title="Italic"
      >
        <Italic size={15} />
      </Btn>
      <Btn
        active={commandStates?.underline ?? false}
        onMouseDown={(e) => exec(e, "underline")}
        title="Underline"
      >
        <Underline size={15} />
      </Btn>

      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* Color (element-level) */}
      <label title="Text color" className="relative cursor-pointer">
        <span
          className="inline-block w-5 h-5 rounded border border-gray-300"
          style={{ background: styles?.color ?? "#000000" }}
        />
        <input
          type="color"
          value={styles?.color ?? "#000000"}
          disabled={disabled || !hasElement}
          onChange={(e) => onStyleChange({ color: e.target.value })}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer disabled:cursor-not-allowed"
        />
      </label>

      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* Alignment — per-paragraph via execCommand */}
      <Btn
        active={commandStates?.justifyLeft ?? false}
        onMouseDown={(e) => exec(e, "justifyLeft")}
        title="Align left"
      >
        <AlignLeft size={15} />
      </Btn>
      <Btn
        active={commandStates?.justifyCenter ?? false}
        onMouseDown={(e) => exec(e, "justifyCenter")}
        title="Align center"
      >
        <AlignCenter size={15} />
      </Btn>
      <Btn
        active={commandStates?.justifyRight ?? false}
        onMouseDown={(e) => exec(e, "justifyRight")}
        title="Align right"
      >
        <AlignRight size={15} />
      </Btn>

      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* List types — execCommand scopes to the cursor's paragraph / current selection */}
      <Btn
        active={styles?.listType === "bullet"}
        onMouseDown={(e) => {
          e.preventDefault();
          onStyleChange({ listType: styles?.listType === "bullet" ? "none" : "bullet" });
          document.execCommand("insertUnorderedList");
        }}
        title="Bullet list"
      >
        <List size={15} />
      </Btn>
      <Btn
        active={styles?.listType === "numbered"}
        onMouseDown={(e) => {
          e.preventDefault();
          onStyleChange({ listType: styles?.listType === "numbered" ? "none" : "numbered" });
          document.execCommand("insertOrderedList");
        }}
        title="Numbered list"
      >
        <ListOrdered size={15} />
      </Btn>
    </div>
  );
}
