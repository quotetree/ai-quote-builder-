"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, FilePlus, FileText, MoreHorizontal, Plus, Trash2, Upload } from "lucide-react";

const ACCEPTED = ".pdf,.png,.jpg,.jpeg,.gif,.webp";

interface ProposalPageSeparatorProps {
  insertAtIndex: number;
  managePageIndex: number;
  /** When true this is the trailing separator after the last page — hide the page label */
  isBottom?: boolean;
  onInsertBlankPage: (atIndex: number) => void;
  onDuplicatePage: (pageIndex: number) => void;
  onDeletePage: (pageIndex: number) => void;
  /** Called with the files chosen for upload — parent handles processing */
  onUploadFile?: (atIndex: number, files: FileList) => void;
  /** Called when the user wants to add a quote page — parent shows the quote picker */
  onAddQuotePage?: (atIndex: number) => void;
  /** When the managed page is a quote page, its quoteId is passed here */
  managedPageQuoteId?: string;
  /** Called when the user clicks "Change Quote" on a quote page */
  onChangeQuotePage?: (pageIndex: number, currentQuoteId: string) => void;
}

export default function ProposalPageSeparator({
  insertAtIndex,
  managePageIndex,
  isBottom = false,
  onInsertBlankPage,
  onDuplicatePage,
  onDeletePage,
  onUploadFile,
  onAddQuotePage,
  managedPageQuoteId,
  onChangeQuotePage,
}: ProposalPageSeparatorProps) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Positions for portalled dropdowns (recalculated when menu opens)
  const [addMenuPos, setAddMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [moreMenuPos, setMoreMenuPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        addRef.current && !addRef.current.contains(target) &&
        addMenuRef.current && !addMenuRef.current.contains(target)
      ) setAddMenuOpen(false);
      if (
        moreRef.current && !moreRef.current.contains(target) &&
        moreMenuRef.current && !moreMenuRef.current.contains(target)
      ) setMoreMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleUploadClick = () => {
    setAddMenuOpen(false);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && onUploadFile) {
      onUploadFile(insertAtIndex, files);
    }
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  return (
    <div className="w-full flex items-center justify-between bg-gray-100 border-y border-gray-200 px-4 h-9 select-none flex-shrink-0">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED}
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Left: page label */}
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
        {isBottom ? "" : `Page ${managePageIndex + 1}`}
      </span>

      {/* Center: add page button */}
      <div ref={addRef} className="relative">
        <button
          onClick={() => {
            if (addRef.current) {
              const rect = addRef.current.getBoundingClientRect();
              setAddMenuPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2 });
            }
            setAddMenuOpen((v) => !v);
            setMoreMenuOpen(false);
          }}
          className="flex items-center justify-center w-6 h-6 rounded text-blue-500 hover:bg-blue-50 transition-colors"
          title="Add page"
        >
          <Plus size={16} />
        </button>

        {addMenuOpen && addMenuPos && createPortal(
          <div
            ref={addMenuRef}
            className="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-xl w-44 py-1"
            style={{ top: addMenuPos.top, left: addMenuPos.left, transform: "translateX(-50%)" }}
          >
            <button
              onClick={() => { onInsertBlankPage(insertAtIndex); setAddMenuOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
            >
              <FilePlus size={14} className="text-gray-400" />
              Blank page
            </button>
            <button
              onClick={handleUploadClick}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
            >
              <Upload size={14} className="text-gray-400" />
              Upload file
            </button>
            {onAddQuotePage && (
              <button
                onClick={() => { onAddQuotePage(insertAtIndex); setAddMenuOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
              >
                <FileText size={14} className="text-gray-400" />
                Quote page
              </button>
            )}
          </div>,
          document.body
        )}
      </div>

      {/* Right: page actions */}
      <div ref={moreRef} className="relative">
        <button
          onClick={() => {
            if (moreRef.current) {
              const rect = moreRef.current.getBoundingClientRect();
              setMoreMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
            }
            setMoreMenuOpen((v) => !v);
            setAddMenuOpen(false);
          }}
          className="flex items-center justify-center w-6 h-6 rounded text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
          title="Page options"
        >
          <MoreHorizontal size={15} />
        </button>

        {moreMenuOpen && moreMenuPos && createPortal(
          <div
            ref={moreMenuRef}
            className="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-xl w-44 py-1"
            style={{ top: moreMenuPos.top, right: moreMenuPos.right }}
          >
            {managedPageQuoteId && onChangeQuotePage && (
              <button
                onClick={() => { onChangeQuotePage(managePageIndex, managedPageQuoteId); setMoreMenuOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
              >
                <FileText size={14} className="text-gray-400" />
                Change Quote
              </button>
            )}
            <button
              onClick={() => { onDuplicatePage(managePageIndex); setMoreMenuOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
            >
              <Copy size={14} className="text-gray-400" />
              Duplicate page
            </button>
            <button
              onClick={() => { onDeletePage(managePageIndex); setMoreMenuOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors text-left"
            >
              <Trash2 size={14} className="text-red-400" />
              Delete page
            </button>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
