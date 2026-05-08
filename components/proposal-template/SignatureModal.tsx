"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface SignatureModalProps {
  mode: "signature" | "initial";
  /** Pre-fill the Type tab with the signer's name/initials */
  defaultText?: string;
  onAccept: (content: string) => void;
  onCancel: () => void;
}

export default function SignatureModal({
  mode,
  defaultText = "",
  onAccept,
  onCancel,
}: SignatureModalProps) {
  const [tab, setTab] = useState<"draw" | "type">("draw");
  const [typedText, setTypedText] = useState(defaultText);
  const [hasDrawn, setHasDrawn] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const title = mode === "signature" ? "Signature" : "Initials";

  // Load Dancing Script font once
  useEffect(() => {
    if (!document.getElementById("dancing-script-font")) {
      const link = document.createElement("link");
      link.id = "dancing-script-font";
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap";
      document.head.appendChild(link);
    }
  }, []);

  // Canvas drawing setup
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || tab !== "draw") return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const getPoint = (e: MouseEvent | TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      if ("touches" in e) {
        return {
          x: (e.touches[0].clientX - rect.left) * scaleX,
          y: (e.touches[0].clientY - rect.top) * scaleY,
        };
      }
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    const onDown = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      isDrawing.current = true;
      lastPoint.current = getPoint(e);
    };
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!isDrawing.current || !lastPoint.current) return;
      e.preventDefault();
      const pt = getPoint(e);
      ctx.beginPath();
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      lastPoint.current = pt;
      setHasDrawn(true);
    };
    const onUp = () => {
      isDrawing.current = false;
      lastPoint.current = null;
    };

    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("touchstart", onDown, { passive: false });
    canvas.addEventListener("touchmove", onMove, { passive: false });
    canvas.addEventListener("touchend", onUp);
    return () => {
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("touchstart", onDown);
      canvas.removeEventListener("touchmove", onMove);
      canvas.removeEventListener("touchend", onUp);
    };
  }, [tab]);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleAccept = () => {
    if (tab === "draw") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      onAccept(canvas.toDataURL("image/png"));
    } else {
      if (!typedText.trim()) return;
      onAccept(`type:${typedText.trim()}`);
    }
  };

  const canAccept = tab === "draw" ? hasDrawn : typedText.trim().length >= 1;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-5">
          {(["draw", "type"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-3 px-4 text-sm font-medium capitalize border-b-2 transition-colors -mb-px ${
                tab === t
                  ? "border-green-600 text-green-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "draw" ? "Draw" : "Type"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-5 pt-4 pb-3">
          {tab === "draw" ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={clearCanvas}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  Clear
                </button>
                <div className="flex gap-2">
                  <div className="w-7 h-7 rounded-full bg-gray-900 ring-2 ring-gray-900 ring-offset-1 flex items-center justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-white" />
                  </div>
                  <div className="w-7 h-7 rounded-full bg-blue-500" />
                  <div className="w-7 h-7 rounded-full bg-red-500" />
                </div>
              </div>
              <div
                className="bg-gray-50 rounded-lg border border-gray-200 relative select-none"
                style={{ height: 200 }}
              >
                <canvas
                  ref={canvasRef}
                  width={640}
                  height={200}
                  className="w-full h-full cursor-crosshair touch-none"
                />
                {/* Signature baseline */}
                <div className="absolute bottom-10 left-6 right-6 border-b border-gray-300 pointer-events-none" />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-500">Choose font</span>
                <div className="flex gap-2">
                  <div className="w-7 h-7 rounded-full bg-gray-900 ring-2 ring-gray-900 ring-offset-1 flex items-center justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-white" />
                  </div>
                  <div className="w-7 h-7 rounded-full bg-blue-500" />
                  <div className="w-7 h-7 rounded-full bg-red-500" />
                </div>
              </div>
              {/* Preview */}
              <div
                className="bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-center relative"
                style={{ height: 160 }}
              >
                <span
                  className="px-6 text-center"
                  style={{
                    fontFamily: "'Dancing Script', 'Brush Script MT', cursive",
                    fontSize: 44,
                    color: "#111",
                    lineHeight: 1.2,
                  }}
                >
                  {typedText || (
                    <span style={{ fontSize: 18, color: "#ccc", fontFamily: "inherit" }}>
                      Type your {mode}…
                    </span>
                  )}
                </span>
                <div className="absolute bottom-8 left-6 right-6 border-b border-gray-300 pointer-events-none" />
              </div>
              <input
                type="text"
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                placeholder={`Type your ${mode}…`}
                className="mt-3 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                autoFocus
              />
            </>
          )}
        </div>

        {/* Legal text */}
        <p className="px-5 pb-3 text-xs text-gray-500 leading-relaxed">
          By electronically signing this document, I agree that my signature and initials are the
          equivalent of my handwritten signature and are considered originals on all documents,
          including legally binding contracts.
        </p>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAccept}
            disabled={!canAccept}
            className="px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Accept and sign
          </button>
        </div>
      </div>
    </div>
  );
}
