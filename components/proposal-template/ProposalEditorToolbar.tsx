"use client";

import { useEffect, useRef, useState } from "react";
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

const TEXT_SWATCHES = ["#000000", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#9ca3af", "#ffffff"];
const HIGHLIGHT_SWATCHES = [
  "#fef08a", "#fde68a", "#bbf7d0", "#bfdbfe", "#fecdd3", "#e9d5ff", "none",
];

// ── Color math ────────────────────────────────────────────────────────────────

function hexToHsv(hex: string): [number, number, number] {
  const clean = (hex.startsWith("#") ? hex.slice(1) : hex).slice(0, 6);
  if (clean.length !== 6) return [0, 0, 0];
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const toHex = (x: number) =>
    Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0");
  return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}`;
}

function isValidHex(v: string) {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}

// ── Color picker popup ────────────────────────────────────────────────────────

interface ColorPickerPopupProps {
  tab: "text" | "highlight";
  textColor: string;
  highlightColor: string;
  onTabChange: (tab: "text" | "highlight") => void;
  onApply: (color: string, tab: "text" | "highlight") => void;
  onClose: () => void;
}

function ColorPickerPopup({
  tab,
  textColor,
  highlightColor,
  onTabChange,
  onApply,
  onClose,
}: ColorPickerPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef(0);

  const initHex = isValidHex(tab === "text" ? textColor : highlightColor)
    ? (tab === "text" ? textColor : highlightColor)
    : "#000000";
  const [h0, s0, v0] = hexToHsv(initHex);

  const [hue, setHueState] = useState(h0);
  const [sat, setSat] = useState(s0);
  const [val, setVal] = useState(v0);
  const [hex, setHex] = useState(initHex);
  const [dragging, setDragging] = useState(false);

  hueRef.current = hue;

  const setHue = (h: number) => { setHueState(h); hueRef.current = h; };

  // Re-init when tab changes
  useEffect(() => {
    const src = tab === "text" ? textColor : highlightColor;
    const safe = isValidHex(src) ? src : "#000000";
    const [h, s, v] = hexToHsv(safe);
    setHue(h); setSat(s); setVal(v); setHex(safe);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const updateFromHsv = (h: number, s: number, v: number) => {
    setHue(h); setSat(s); setVal(v);
    setHex(hsvToHex(h, s, v));
  };

  // 2D box drag
  const pickFromBox = (clientX: number, clientY: number) => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    setSat(s); setVal(v);
    setHex(hsvToHex(hueRef.current, s, v));
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => { e.preventDefault(); pickFromBox(e.clientX, e.clientY); };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [onClose]);

  const pureHue = hsvToHex(hue, 1, 1);
  const swatches = tab === "text" ? TEXT_SWATCHES : HIGHLIGHT_SWATCHES;

  return (
    <div
      ref={popupRef}
      style={{ width: 256, zIndex: 9999 }}
      className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl p-3"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-3">
        {(["text", "highlight"] as const).map((t) => (
          <button
            key={t}
            onMouseDown={(e) => { e.preventDefault(); onTabChange(t); }}
            className={`flex-1 pb-2 text-sm font-medium transition-colors capitalize ${
              tab === t
                ? "text-gray-900 border-b-2 border-green-600 -mb-px"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {t === "text" ? "Text" : "Highlight"}
          </button>
        ))}
      </div>

      {/* Swatches */}
      <div className="flex items-center gap-1.5 mb-3">
        {swatches.map((sw) => (
          <button
            key={sw}
            title={sw === "none" ? "Remove highlight" : sw}
            onMouseDown={(e) => {
              e.preventDefault();
              onApply(sw === "none" ? "rgba(0,0,0,0)" : sw, tab);
            }}
            className={`w-7 h-7 rounded-full flex-shrink-0 transition-transform hover:scale-110 border-2 ${
              sw === "none"
                ? "border-dashed border-gray-300 bg-white"
                : sw === "#ffffff"
                ? "border-gray-300"
                : "border-transparent hover:border-gray-300"
            }`}
            style={{ backgroundColor: sw === "none" ? undefined : sw }}
          >
            {sw === "none" && (
              <span className="block w-full h-0.5 bg-red-400 rotate-45 translate-y-[11px] -translate-x-[1px] rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Hex preview + input */}
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-7 h-7 rounded border border-gray-200 flex-shrink-0"
          style={{ backgroundColor: isValidHex(hex) ? hex : "#000" }}
        />
        <input
          type="text"
          value={hex}
          onChange={(e) => {
            const v = e.target.value;
            setHex(v);
            if (isValidHex(v)) {
              const [h, s, vv] = hexToHsv(v);
              setHue(h); setSat(s); setVal(vv);
            }
          }}
          onKeyDown={(e) => { if (e.key === "Enter" && isValidHex(hex)) onApply(hex, tab); }}
          placeholder="#000000"
          className="flex-1 text-sm font-mono border-b border-gray-300 focus:outline-none focus:border-green-500 text-gray-700 py-0.5"
        />
      </div>

      {/* Hue slider */}
      <div className="mb-2.5">
        <input
          type="range"
          min={0}
          max={360}
          value={hue}
          onChange={(e) => updateFromHsv(Number(e.target.value), sat, val)}
          className="w-full cursor-pointer rounded-full appearance-none h-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-gray-300 [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-gray-300"
          style={{
            background:
              "linear-gradient(to right,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)",
          }}
        />
      </div>

      {/* 2D saturation/brightness picker */}
      <div
        ref={boxRef}
        className="relative w-full rounded-lg overflow-hidden cursor-crosshair mb-3 select-none"
        style={{
          height: 116,
          background: `linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, ${pureHue})`,
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          setDragging(true);
          pickFromBox(e.clientX, e.clientY);
        }}
      >
        <div
          className="absolute w-4 h-4 rounded-full border-2 border-white shadow-md pointer-events-none"
          style={{
            left: `${sat * 100}%`,
            top: `${(1 - val) * 100}%`,
            transform: "translate(-50%, -50%)",
            backgroundColor: isValidHex(hex) ? hex : "#000",
          }}
        />
      </div>

      {/* Apply */}
      <button
        className="w-full py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
        onMouseDown={(e) => {
          e.preventDefault();
          if (isValidHex(hex)) onApply(hex, tab);
        }}
      >
        Apply {tab === "highlight" ? "Highlight" : "Color"}
      </button>
    </div>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

interface ProposalEditorToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  selectedStyles: ElementStyles | null;
  onStyleChange: (styles: Partial<ElementStyles>) => void;
  commandStates?: {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    justifyLeft: boolean;
    justifyCenter: boolean;
    justifyRight: boolean;
    fontSize?: number;
  };
  onFontSizeChange?: (size: number) => void;
  disabled?: boolean;
}

const exec = (e: React.MouseEvent, command: string, value?: string) => {
  e.preventDefault();
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

  // ── Color picker state ──────────────────────────────────────────────────
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [colorPickerTab, setColorPickerTab] = useState<"text" | "highlight">("text");
  const [currentTextColor, setCurrentTextColor] = useState(styles?.color ?? "#000000");
  const [currentHighlightColor, setCurrentHighlightColor] = useState("#fef08a");
  const savedRangeRef = useRef<Range | null>(null);

  // Keep text color in sync with element styles
  useEffect(() => {
    if (styles?.color) setCurrentTextColor(styles.color);
  }, [styles?.color]);

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    const sel = window.getSelection();
    if (savedRangeRef.current && sel) {
      try {
        sel.removeAllRanges();
        sel.addRange(savedRangeRef.current);
      } catch {
        // Range may be invalid if DOM changed
      }
    }
  };

  const handleApplyColor = (color: string, tab: "text" | "highlight") => {
    restoreSelection();
    if (tab === "text") {
      document.execCommand("foreColor", false, color);
      setCurrentTextColor(color);
      onStyleChange({ color });
    } else {
      // hiliteColor applies background to selection; rgba(0,0,0,0) clears it
      document.execCommand("hiliteColor", false, color);
      if (color !== "rgba(0,0,0,0)") setCurrentHighlightColor(color);
    }
    setShowColorPicker(false);
  };

  // ── Generic toolbar button ──────────────────────────────────────────────
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

      {/* Font size */}
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

      {/* Bold / Italic / Underline */}
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

      {/* Text & Highlight color picker */}
      <div className="relative">
        <button
          title="Text color / Highlight"
          disabled={disabled || !hasElement}
          onMouseDown={(e) => {
            e.preventDefault();
            saveSelection();
            setShowColorPicker((v) => !v);
          }}
          className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {/* "A" letter */}
          <span className="text-[13px] font-bold text-gray-700 leading-none">A</span>
          {/* Two-tone underline bar: text color on left half, highlight on right half */}
          <div className="flex w-5 mt-0.5 rounded-sm overflow-hidden h-1.5">
            <div className="flex-1" style={{ backgroundColor: currentTextColor }} />
            <div
              className="flex-1"
              style={{
                backgroundColor:
                  currentHighlightColor === "rgba(0,0,0,0)" ? "#e5e7eb" : currentHighlightColor,
              }}
            />
          </div>
        </button>

        {showColorPicker && (
          <ColorPickerPopup
            tab={colorPickerTab}
            textColor={currentTextColor}
            highlightColor={currentHighlightColor}
            onTabChange={setColorPickerTab}
            onApply={handleApplyColor}
            onClose={() => setShowColorPicker(false)}
          />
        )}
      </div>

      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* Alignment */}
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

      {/* Lists */}
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
