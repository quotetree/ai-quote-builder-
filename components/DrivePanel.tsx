"use client";

const DEFAULT_FONT_SIZE = "16px";

interface NoteSegment {
  id: string;
  text: string;
  fontSize: string;
}

const FONT_SIZE_COMMAND_MAP: Record<string, string> = {
  "12px": "1",
  "14px": "2",
  "16px": "3",
  "18px": "4",
  "20px": "5",
  "24px": "6",
  "32px": "7",
};

const resolveCommandFontSize = (commandValue: string) => {
  const entry = Object.entries(FONT_SIZE_COMMAND_MAP).find(
    ([, cmdValue]) => cmdValue === commandValue,
  );
  return entry ? entry[0] : null;
};

const getSelectionFontSize = (editor: HTMLDivElement | null): string | null => {
  if (!editor) return null;
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const focusNode = selection.focusNode || selection.anchorNode;
  if (!focusNode || !editor.contains(focusNode)) return null;
  const target =
    focusNode.nodeType === Node.TEXT_NODE
      ? (focusNode.parentElement as HTMLElement)
      : (focusNode as HTMLElement);
  if (!target) return null;
  const computed = window.getComputedStyle(target).fontSize;
  if (!computed) return null;
  const matched = Object.keys(FONT_SIZE_COMMAND_MAP).find((size) =>
    computed.startsWith(size),
  );
  if (matched) return matched;
  const parsed = parseFloat(computed);
  if (Number.isFinite(parsed)) {
    return `${Math.round(parsed)}px`;
  }
  return computed;
};

const ALIGN_COMMAND_MAP: Record<TextAlignValue, string> = {
  left: "justifyLeft",
  center: "justifyCenter",
  right: "justifyRight",
};

const ALIGN_ICON_MAP: Record<TextAlignValue, typeof AlignLeft> = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
};

const getSelectionAlignment = (editor: HTMLDivElement | null): TextAlignValue => {
  if (!editor) return "left";
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return "left";
  let focusNode = selection.focusNode || selection.anchorNode;
  if (!focusNode) return "left";
  if (focusNode.nodeType === Node.TEXT_NODE) {
    focusNode = focusNode.parentElement || focusNode;
  }
  while (focusNode && focusNode instanceof Node && focusNode !== editor && !(focusNode as HTMLElement).style) {
    focusNode = (focusNode as HTMLElement).parentElement;
  }
  if (!(focusNode instanceof HTMLElement)) return "left";
  const computed = window.getComputedStyle(focusNode).textAlign;
  if (!computed) return "left";
  if (computed.includes("center")) return "center";
  if (computed.includes("right") || computed.includes("end")) return "right";
  return "left";
};

const createSegmentId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function parseHtmlToSegments(html: string): NoteSegment[] {
  if (typeof window === "undefined") return [];
  const container = document.createElement("div");
  container.innerHTML = html || "";
  const segments: NoteSegment[] = [];

  const traverse = (node: ChildNode, currentFont: string) => {
    const nextFont =
      node.nodeType === Node.ELEMENT_NODE
        ? ((node as HTMLElement).style.fontSize || currentFont)
        : currentFont;

    if (node.nodeName === "BR") {
      segments.push({
        id: createSegmentId(),
        text: "\n",
        fontSize: nextFont || DEFAULT_FONT_SIZE,
      });
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text.length === 0) return;
      segments.push({
        id: createSegmentId(),
        text,
        fontSize: nextFont || DEFAULT_FONT_SIZE,
      });
      return;
    }

    node.childNodes.forEach((child) => traverse(child, nextFont));
  };

  container.childNodes.forEach((child) => traverse(child, DEFAULT_FONT_SIZE));
  return segments;
}

const segmentsToPlainText = (segments: NoteSegment[]) =>
  segments.map((segment) => segment.text).join("");

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import type { JSX } from "react";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import {
  Upload,
  File,
  Trash2,
  Download,
  FolderPlus,
  Loader2,
  X,
  MoreVertical,
  Image as ImageIcon,
  FileText,
  FileSpreadsheet,
  FileArchive,
  FileCode,
  FileAudio,
  FileVideo,
  Presentation,
  Pencil,
  Folder,
  StickyNote,
  BookmarkMinus,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Link as LinkIcon,
  Table,
  Plus,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ChevronDown,
  Copy,
} from "lucide-react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import {
  ProjectDocument,
  ProjectFolder,
  ProjectNote,
  ProjectSpreadsheet,
  SpreadsheetSection,
  SpreadsheetTemplateId,
  SpreadsheetTemplate,
} from "@/types/database";
import SpreadsheetEditor from "@/components/SpreadsheetEditor";
import toast from "react-hot-toast";

interface DrivePanelProps {
  projectId: string;
  /** Notifies parent when user opens/closes a spreadsheet (AI chat context). */
  onActiveSpreadsheetChange?: (spreadsheetId: string | null) => void;
}

type DirectoryFile = File & { webkitRelativePath?: string };
type ViewerMode = "image" | "pdf" | "office" | "text" | "other";
type DriveItemType = "file" | "folder" | "note" | "spreadsheet";
type TextAlignValue = "left" | "center" | "right";

interface UploadProgress {
  current: number;
  total: number;
  name?: string;
}

interface PreviewState {
  doc: ProjectDocument | null;
  signedUrl: string | null;
  viewerUrl: string | null;
  textContent: string | null;
  loading: boolean;
  error: string | null;
  mode: ViewerMode | null;
}

interface NoteEditorState {
  note: ProjectNote;
  html: string;
  title: string;
  saving: boolean;
}

interface DragItem {
  id: string;
  type: DriveItemType;
}

interface TableHoverState {
  cell: HTMLTableCellElement;
  rect: DOMRect;
}

const NOTE_AUTOSAVE_DELAY = 900;
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

// ── Spreadsheet template helpers ──────────────────────────────────────────────

const TEMPLATE_LABELS: Record<string, string> = {
  purchase_order: "Purchase Order",
  invoice: "Invoice",
  timesheet: "Weekly Time Sheet",
};

const makeRow = (): SpreadsheetSection["rows"][number] => ({
  id: crypto.randomUUID(),
  custom_label: "",
  product_id: null,
  product_name: "",
  product_code: "",
  list_price: 0,
  sales_price: 0,
  discount: 0,
  quantity: 1,
});

const makeSection = (label: string, rowCount = 3): SpreadsheetSection => ({
  id: crypto.randomUUID(),
  label,
  rows: Array.from({ length: rowCount }, makeRow),
});

function buildTemplatesections(templateId?: SpreadsheetTemplateId): SpreadsheetSection[] {
  if (!templateId) {
    return [makeSection("Untitled section")];
  }
  if (templateId === "purchase_order") {
    return [
      makeSection("Materials"),
      makeSection("Labor"),
      makeSection("Equipment"),
    ];
  }
  if (templateId === "invoice") {
    return [
      makeSection("Services"),
      makeSection("Products"),
      makeSection("Fees", 1),
    ];
  }
  // timesheet
  return [
    makeSection("Monday"),
    makeSection("Tuesday"),
    makeSection("Wednesday"),
    makeSection("Thursday"),
    makeSection("Friday"),
  ];
}

function templateToEditorSpreadsheet(template: SpreadsheetTemplate): ProjectSpreadsheet {
  return {
    id: template.id,
    project_id: "",
    user_id: template.user_id,
    folder_id: null,
    title: template.title,
    template_id: null,
    sections: template.sections,
    charges: template.charges,
    baked_markups: template.baked_markups,
    subtotal: 0,
    total: 0,
    created_at: template.created_at,
    updated_at: template.updated_at,
  };
}

const OFFICE_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.ms-word.document.macroenabled.12",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  "application/vnd.ms-powerpoint",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const OFFICE_EXTENSIONS = new Set([
  "doc",
  "docx",
  "dot",
  "dotx",
  "xls",
  "xlsx",
  "xlsm",
  "xlsb",
  "ppt",
  "pptx",
  "pps",
  "ppsx",
]);

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "csv",
  "tsv",
  "log",
  "yaml",
  "yml",
  "xml",
]);

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/csv",
  "text/csv",
  "text/markdown",
  "text/plain",
]);

const createInitialPreviewState = (): PreviewState => ({
  doc: null,
  signedUrl: null,
  viewerUrl: null,
  textContent: null,
  loading: false,
  error: null,
  mode: null,
});

const getFileExtension = (fileName: string) => {
  const parts = fileName.split(".");
  if (parts.length < 2) return "";
  return parts.pop()!.toLowerCase();
};

const sanitizePathSegment = (segment: string) =>
  segment
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-");

const normalizeRelativePath = (path: string, fallback: string) => {
  const sanitized = path
    .split("/")
    .map((segment) => sanitizePathSegment(segment))
    .filter((segment) => segment && segment !== "." && segment !== "..");

  if (sanitized.length === 0) {
    sanitized.push(sanitizePathSegment(fallback) || `file-${Date.now()}`);
  }

  return sanitized.join("/");
};

const getDisplayName = (file: DirectoryFile) =>
  file.webkitRelativePath && file.webkitRelativePath.length > 0
    ? file.webkitRelativePath
    : file.name;

const determineViewerMode = (doc: ProjectDocument): ViewerMode => {
  const mime = doc.file_type?.toLowerCase() || "";
  const extension = getFileExtension(doc.file_name);

  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (OFFICE_MIME_TYPES.has(mime) || OFFICE_EXTENSIONS.has(extension)) return "office";
  if (
    mime.startsWith("text/") ||
    TEXT_MIME_TYPES.has(mime) ||
    TEXT_EXTENSIONS.has(extension)
  ) {
    return "text";
  }
  return "other";
};

const buildOfficeViewerUrl = (url: string) =>
  `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;

interface DocumentCardMeta {
  label: string;
  icon: JSX.Element;
  accentBg: string;
  accentText: string;
}

type RenameTarget =
  | { type: "file"; record: ProjectDocument }
  | { type: "folder"; record: ProjectFolder }
  | { type: "note"; record: ProjectNote }
  | { type: "spreadsheet"; record: ProjectSpreadsheet };

const getDocumentMeta = (doc: ProjectDocument): DocumentCardMeta => {
  const mime = doc.file_type?.toLowerCase() || "";
  const extension = getFileExtension(doc.file_name);

  if (mime.startsWith("image/")) {
    return {
      label: "Image",
      icon: <ImageIcon size={20} />,
      accentBg: "bg-pink-100",
      accentText: "text-pink-600",
    };
  }

  if (mime === "application/pdf" || extension === "pdf") {
    return {
      label: "PDF",
      icon: <FileText size={20} />,
      accentBg: "bg-red-100",
      accentText: "text-red-600",
    };
  }

  if (OFFICE_MIME_TYPES.has(mime) || OFFICE_EXTENSIONS.has(extension)) {
    if (["xls", "xlsx", "xlsm", "xlsb"].includes(extension)) {
      return {
        label: "Sheet",
        icon: <FileSpreadsheet size={20} />,
        accentBg: "bg-green-100",
        accentText: "text-green-600",
      };
    }
    if (["ppt", "pptx", "pps", "ppsx"].includes(extension)) {
      return {
        label: "Slides",
        icon: <Presentation size={20} />,
        accentBg: "bg-orange-100",
        accentText: "text-orange-600",
      };
    }
    return {
      label: "Doc",
      icon: <FileText size={20} />,
      accentBg: "bg-green-100",
      accentText: "text-green-600",
    };
  }

  if (["zip", "rar"].includes(extension)) {
    return {
      label: "Archive",
      icon: <FileArchive size={20} />,
      accentBg: "bg-gray-100",
      accentText: "text-gray-600",
    };
  }

  if (mime.startsWith("audio/")) {
    return {
      label: "Audio",
      icon: <FileAudio size={20} />,
      accentBg: "bg-purple-100",
      accentText: "text-purple-600",
    };
  }

  if (mime.startsWith("video/")) {
    return {
      label: "Video",
      icon: <FileVideo size={20} />,
      accentBg: "bg-indigo-100",
      accentText: "text-indigo-600",
    };
  }

  if (mime.includes("json") || mime.includes("xml") || mime.includes("html")) {
    return {
      label: "Code",
      icon: <FileCode size={20} />,
      accentBg: "bg-slate-100",
      accentText: "text-slate-600",
    };
  }

  return {
    label: "File",
    icon: <File size={20} />,
    accentBg: "bg-gray-100",
    accentText: "text-gray-600",
  };
};

const stripHtml = (html: string) => {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
};

const truncate = (value: string, max = 120) =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const sanitizeFileName = (value: string | null | undefined, fallback: string) => {
  const target = value?.trim() ? value.trim() : fallback;
  return target.replace(/[\\/:*?"<>|]/g, "_");
};

const NOTE_HIGHLIGHT_COLOR = "#fff3b0";

export default function DrivePanel({ projectId, onActiveSpreadsheetChange }: DrivePanelProps) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(
    null,
  );
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [folderStack, setFolderStack] = useState<ProjectFolder[]>([]);
  const [previewState, setPreviewState] = useState<PreviewState>(() =>
    createInitialPreviewState(),
  );
  const [menuOpenDocId, setMenuOpenDocId] = useState<string | null>(null);
  const [menuOpenFolderId, setMenuOpenFolderId] = useState<string | null>(null);
  const [menuOpenNoteId, setMenuOpenNoteId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [activeNote, setActiveNote] = useState<NoteEditorState | null>(null);
  const [spreadsheets, setSpreadsheets] = useState<ProjectSpreadsheet[]>([]);
  const [userTemplates, setUserTemplates] = useState<SpreadsheetTemplate[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<string | null>(null);
  const [newSpreadsheetModal, setNewSpreadsheetModal] = useState<
    { mode: "blank" } | { mode: "template"; template: SpreadsheetTemplate }
  | null>(null);
  const [newSpreadsheetName, setNewSpreadsheetName] = useState("");
  const [menuOpenSpreadsheetId, setMenuOpenSpreadsheetId] = useState<string | null>(null);
  const [activeSpreadsheetId, setActiveSpreadsheetId] = useState<string | null>(null);
  const [activeEditingTemplate, setActiveEditingTemplate] = useState<SpreadsheetTemplate | null>(null);
  const spreadsheetEditorOpen = !!activeSpreadsheetId || !!activeEditingTemplate;
  useEffect(() => {
    onActiveSpreadsheetChange?.(activeSpreadsheetId);
  }, [activeSpreadsheetId, onActiveSpreadsheetChange]);

  const [spreadsheetEditContext, setSpreadsheetEditContext] = useState<{
    quoteId: string;
    quoteNumber: string;
    version: number;
  } | null>(null);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const currentFolderId =
    folderStack.length > 0 ? folderStack[folderStack.length - 1].id : null;
  const noteEditorRef = useRef<HTMLDivElement | null>(null);
  const [editorInitializedFor, setEditorInitializedFor] = useState<string | null>(null);
  const [noteFontSize, setNoteFontSize] = useState(DEFAULT_FONT_SIZE);
  const manualFontSizeRef = useRef(false);
  const [noteSegments, setNoteSegments] = useState<NoteSegment[]>([]);
  const selectionRef = useRef<Range | null>(null);
  const [tableHoverState, setTableHoverState] = useState<TableHoverState | null>(null);
  const tableHoverLockRef = useRef(false);
  const lastCaretPositionRef = useRef<{ node: Node | null; offset: number } | null>(null);
  const [isBulletListActive, setIsBulletListActive] = useState(false);
  const [textAlign, setTextAlign] = useState<TextAlignValue>("left");
  const manualAlignRef = useRef(false);
  const [showAlignMenu, setShowAlignMenu] = useState(false);
  const [alignMenuPosition, setAlignMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const alignMenuRef = useRef<HTMLDivElement | null>(null);
  const alignButtonRef = useRef<HTMLButtonElement | null>(null);

  const normalizeTableElement = (table: HTMLTableElement) => {
    table.classList.add("note-table");
    table.style.tableLayout = "fixed";
    table.style.width = "100%";
    table.style.maxWidth = "100%";
    table.style.borderCollapse = "collapse";
    table.querySelectorAll("td,th").forEach((cellNode) => {
      const cell = cellNode as HTMLTableCellElement;
      cell.style.wordBreak = "break-word";
      cell.style.overflowWrap = "anywhere";
      cell.style.verticalAlign = "top";
    });
  };

  const ensureTablesNormalized = () => {
    if (!noteEditorRef.current) return;
    const tables = noteEditorRef.current.querySelectorAll("table");
    tables.forEach((table) => normalizeTableElement(table as HTMLTableElement));
  };

  const normalizeFontElements = (preferredSize?: string) => {
    if (!noteEditorRef.current) return;
    const fonts = noteEditorRef.current.querySelectorAll("font[size]");
    fonts.forEach((fontEl) => {
      const sizeAttr = fontEl.getAttribute("size") || "";
      const resolved =
        resolveCommandFontSize(sizeAttr) ||
        preferredSize ||
        window.getComputedStyle(fontEl as HTMLElement).fontSize ||
        DEFAULT_FONT_SIZE;
      fontEl.removeAttribute("size");
      (fontEl as HTMLElement).style.fontSize = resolved;
    });
  };

  const applyFontSizeToCaretContainer = (size?: string) => {
    if (!noteEditorRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    let node: Node | null = selection.focusNode || selection.anchorNode;
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement;
    }
    const appliedSize = size || noteFontSize || DEFAULT_FONT_SIZE;
    while (node && node instanceof HTMLElement && node !== noteEditorRef.current) {
      if (node.style) {
        node.style.fontSize = appliedSize;
        return;
      }
      node = node.parentElement;
    }
  };

  const captureSelectionSnapshot = () => {
    const selection = window.getSelection();
    if (
      !selection ||
      selection.rangeCount === 0 ||
      !noteEditorRef.current ||
      !noteEditorRef.current.contains(selection.anchorNode)
    ) {
      return;
    }
    selectionRef.current = selection.getRangeAt(0).cloneRange();
    
    // Track caret position to detect when it actually moves
    const currentNode = selection.anchorNode;
    const currentOffset = selection.anchorOffset;
    const lastPos = lastCaretPositionRef.current;
    
    if (!lastPos || lastPos.node !== currentNode || lastPos.offset !== currentOffset) {
      // Caret has actually moved to a new position
      if (manualFontSizeRef.current) {
        manualFontSizeRef.current = false;
      }
      lastCaretPositionRef.current = { node: currentNode, offset: currentOffset };
    }
  };

  const restoreSelection = () => {
    const selection = window.getSelection();
    if (!selection || !selectionRef.current) return false;
    selection.removeAllRanges();
    selection.addRange(selectionRef.current);
    return true;
  };

  const ensureEditorSelection = () => {
    if (!noteEditorRef.current) return false;
    noteEditorRef.current.focus();
    if (!restoreSelection()) {
      const range = document.createRange();
      range.selectNodeContents(noteEditorRef.current);
      range.collapse(false);
      const selection = window.getSelection();
      if (!selection) return false;
      selection.removeAllRanges();
      selection.addRange(range);
      selectionRef.current = range.cloneRange();
    }
    return true;
  };

  const findAncestorElement = (
    node: Node | null,
    predicate: (element: HTMLElement) => boolean,
  ): HTMLElement | null => {
    while (node && node !== noteEditorRef.current) {
      if (node instanceof HTMLElement && predicate(node)) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  };

  const unwrapElement = (element: HTMLElement) => {
    const parent = element.parentNode;
    if (!parent) return;
    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }
    parent.removeChild(element);
  };

  const getActiveTableCell = () => {
    if (!noteEditorRef.current) return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    let node = selection.anchorNode as Node | null;
    return findAncestorElement(
      node,
      (el) => el.tagName === "TD" || el.tagName === "TH",
    ) as HTMLTableCellElement | null;
  };

  const isInBulletList = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const listItem = findAncestorElement(selection.anchorNode, (el) => el.tagName === "LI");
    if (!listItem) return false;
    const list = listItem.parentElement;
    return list?.tagName === "UL";
  };

  const toggleBulletList = () => {
    if (!ensureEditorSelection()) return;

    // Use the browser's native command which handles Enter key behavior automatically
    document.execCommand("insertUnorderedList", false);

    updateSegmentsFromEditor();
    captureSelectionSnapshot();

    // Update active state after toggling
    setIsBulletListActive(isInBulletList());
  };

  const applyEditorCommand = (command: string, value?: string) => {
    if (!noteEditorRef.current) return;
    ensureEditorSelection();
    document.execCommand(command, false, value);
    updateSegmentsFromEditor();
    captureSelectionSnapshot();
  };

  const insertTable = (rows = 2, cols = 2) => {
    if (!noteEditorRef.current) return;
    ensureEditorSelection();
    let html = '<table class="note-table w-full border-collapse border border-gray-300 text-left"><tbody>';
    for (let r = 0; r < rows; r += 1) {
      html += "<tr>";
      for (let c = 0; c < cols; c += 1) {
        html +=
          '<td class="border border-gray-200 px-3 py-2 align-top" contenteditable="true"><br></td>';
      }
      html += "</tr>";
    }
    html += "</tbody></table><p><br></p>";
    applyEditorCommand("insertHTML", html);
    ensureTablesNormalized();
  };

  const getActiveLink = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    return findAncestorElement(selection.anchorNode, (el) => el.tagName === "A");
  };

  const insertLink = () => {
    if (!ensureEditorSelection()) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      toast.error("Select text to apply a link.");
      return;
    }
    const existingLink = getActiveLink();
    const currentUrl = existingLink?.getAttribute("href") ?? "https://";
    const url = prompt("Enter URL", currentUrl);
    if (url === null) return;
    if (!url.trim()) {
      if (existingLink) {
        unwrapElement(existingLink);
        updateSegmentsFromEditor();
      }
      return;
    }
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
    if (existingLink) {
      existingLink.setAttribute("href", normalizedUrl);
      existingLink.setAttribute("target", "_blank");
      existingLink.setAttribute("rel", "noopener noreferrer");
      existingLink.classList.add("text-green-600", "underline");
      updateSegmentsFromEditor();
      captureSelectionSnapshot();
      return;
    }

    const anchor = document.createElement("a");
    anchor.setAttribute("href", normalizedUrl);
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
    anchor.classList.add("text-green-600", "underline");

    const range = selection.getRangeAt(0);
    anchor.appendChild(range.extractContents());
    range.insertNode(anchor);
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(anchor);
    newRange.collapse(false);
    selection.addRange(newRange);
    captureSelectionSnapshot();
    updateSegmentsFromEditor();
  };

  const toggleHighlight = () => {
    if (!ensureEditorSelection()) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      toast.error("Select text to highlight.");
      return;
    }

    const existingHighlight = findAncestorElement(
      selection.anchorNode,
      (el) => el.dataset.highlight === "true",
    );

    if (existingHighlight) {
      unwrapElement(existingHighlight);
      updateSegmentsFromEditor();
      captureSelectionSnapshot();
      return;
    }

    const range = selection.getRangeAt(0);
    const span = document.createElement("span");
    span.dataset.highlight = "true";
    span.style.backgroundColor = NOTE_HIGHLIGHT_COLOR;
    span.style.borderRadius = "2px";
    span.style.padding = "0 2px";
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    } catch (error) {
      const contents = range.cloneContents().textContent;
      span.textContent = contents ?? "";
      range.deleteContents();
      range.insertNode(span);
    }
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    newRange.collapse(false);
    selection.addRange(newRange);
    captureSelectionSnapshot();
    updateSegmentsFromEditor();
  };

  const addTableRowBelow = (targetCell?: HTMLTableCellElement) => {
    const cell = targetCell ?? getActiveTableCell();
    if (!cell) {
      toast.error("Place the cursor inside a table cell or hover a cell to add a row.");
      return;
    }
    const row = cell.parentElement as HTMLTableRowElement | null;
    if (!row || !row.parentElement) return;
    const clone = row.cloneNode(true) as HTMLTableRowElement;
    clone.querySelectorAll("td,th").forEach((cell) => {
      cell.innerHTML = "<br>";
    });
    row.parentElement.insertBefore(clone, row.nextSibling);
    ensureTablesNormalized();
    updateSegmentsFromEditor();
    captureSelectionSnapshot();
  };

  const addTableColumnRight = (targetCell?: HTMLTableCellElement) => {
    const cell = targetCell ?? getActiveTableCell();
    if (!cell) {
      toast.error("Place the cursor inside a table cell or hover a cell to add a column.");
      return;
    }
    const table = cell.closest("table");
    if (!table) return;
    const currentRow = cell.parentElement as HTMLTableRowElement | null;
    if (!currentRow) return;
    const cellIndex = Array.from(currentRow.children).indexOf(cell);
    Array.from(table.rows).forEach((row) => {
      const newCell = (row as HTMLTableRowElement).insertCell(cellIndex + 1);
      newCell.className = cell.className;
      newCell.innerHTML = "<br>";
    });
    ensureTablesNormalized();
    updateSegmentsFromEditor();
    captureSelectionSnapshot();
  };

  const folderInputRef = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      node.setAttribute("webkitdirectory", "true");
      node.setAttribute("directory", "true");
    }
  }, []);

  useEffect(() => {
    loadFolderContents(currentFolderId);
    loadUserTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, currentFolderId]);

  const anyMenuOpen =
    !!menuOpenDocId || !!menuOpenFolderId || !!menuOpenNoteId || !!menuOpenSpreadsheetId || showNewMenu;

  const closeAllMenus = () => {
    setMenuOpenDocId(null);
    setMenuOpenFolderId(null);
    setMenuOpenNoteId(null);
    setMenuOpenSpreadsheetId(null);
    setShowNewMenu(false);
  };

  // Open linked spreadsheet when editing a spreadsheet-sourced quote
  useEffect(() => {
    const handleEditSpreadsheetQuote = async (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        spreadsheetId?: string | null;
        quoteId: string;
        quoteNumber: string;
        version: number;
        projectId?: string;
      };
      const { quoteId, quoteNumber, version, projectId: eventProjectId } = detail;
      if (eventProjectId && eventProjectId !== projectId) return;

      setSpreadsheetEditContext({ quoteId, quoteNumber, version });

      try {
        const { ensureSpreadsheetForQuote } = await import("@/lib/spreadsheetFromQuote");
        const sheet = await ensureSpreadsheetForQuote(supabase, quoteId);

        setSpreadsheets((prev) =>
          prev.some((s) => s.id === sheet.id) ? prev : [sheet, ...prev],
        );
        setActiveSpreadsheetId(sheet.id);

        window.dispatchEvent(
          new CustomEvent("quoteSpreadsheetLinked", {
            detail: { quoteId, spreadsheetId: sheet.id, projectId },
          }),
        );
      } catch (error: any) {
        console.error("[DrivePanel] Failed to open quote spreadsheet:", error);
        toast.error(error?.message || "Could not open spreadsheet for this quote");
      }
    };
    window.addEventListener("editSpreadsheetQuoteStarted", handleEditSpreadsheetQuote as EventListener);
    return () => window.removeEventListener("editSpreadsheetQuoteStarted", handleEditSpreadsheetQuote as EventListener);
  }, [projectId, supabase]);

  // Log → Add New Quote: create spreadsheet and open editor
  useEffect(() => {
    const handleNewSpreadsheetQuote = (e: Event) => {
      const detail = (e as CustomEvent<{ quoteName?: string; projectId?: string }>).detail;
      if (!detail?.projectId || detail.projectId !== projectId) return;
      void createSpreadsheetWithTitle(detail.quoteName ?? "Untitled Spreadsheet");
    };
    window.addEventListener("newSpreadsheetQuoteStarted", handleNewSpreadsheetQuote as EventListener);
    return () =>
      window.removeEventListener("newSpreadsheetQuoteStarted", handleNewSpreadsheetQuote as EventListener);
  }, [projectId, currentFolderId]);

  // Build mode: open newly created spreadsheet from chat
  useEffect(() => {
    const handleBuildSpreadsheetOpened = (e: Event) => {
      const detail = (e as CustomEvent<{ spreadsheet?: ProjectSpreadsheet; projectId?: string }>).detail;
      if (!detail?.spreadsheet || (detail.projectId && detail.projectId !== projectId)) return;
      openCreatedSpreadsheet(detail.spreadsheet);
    };
    window.addEventListener("buildSpreadsheetOpened", handleBuildSpreadsheetOpened as EventListener);
    return () =>
      window.removeEventListener("buildSpreadsheetOpened", handleBuildSpreadsheetOpened as EventListener);
  }, [projectId]);


  useEffect(() => {
    if (!activeNote) return;
    const handler = setTimeout(() => {
      saveNoteDraft(activeNote);
    }, NOTE_AUTOSAVE_DELAY);
    return () => clearTimeout(handler);
  }, [activeNote?.html, activeNote?.title]);

  useEffect(() => {
    if (!activeNote || !noteEditorRef.current) {
      setEditorInitializedFor(null);
      setNoteSegments([]);
      setIsBulletListActive(false);
      return;
    }
    if (editorInitializedFor === activeNote.note.id) return;
      const html =
        activeNote.html && activeNote.html.trim().length > 0
          ? activeNote.html
          : "<p><br></p>";
    noteEditorRef.current.innerHTML = html;
    ensureTablesNormalized();
    noteEditorRef.current.focus();
    setNoteSegments(parseHtmlToSegments(html));
    captureSelectionSnapshot();
    setEditorInitializedFor(activeNote.note.id);
  }, [activeNote?.note.id, activeNote?.html, editorInitializedFor]);

  useEffect(() => {
    if (!activeNote) return;
    setNoteFontSize(DEFAULT_FONT_SIZE);
    setIsBulletListActive(false);
    setTableHoverState(null);
    setTextAlign("left");
    manualAlignRef.current = false;
  }, [activeNote?.note.id]);


  const breadcrumb = useMemo(() => folderStack, [folderStack]);

  const loadUserTemplates = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("spreadsheet_templates")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      setUserTemplates((data as SpreadsheetTemplate[]) || []);
    } catch {
      // non-blocking — templates are optional
    }
  }, [supabase]);

  async function loadFolderContents(folderId: string | null) {
    try {
      setLoading(true);
      const folderQuery = supabase
        .from("project_folders")
        .select("*")
        .eq("project_id", projectId)
        .order("name", { ascending: true });
      folderId
        ? folderQuery.eq("parent_folder_id", folderId)
        : folderQuery.is("parent_folder_id", null);

      const docQuery = supabase
        .from("project_documents")
        .select("*")
        .eq("project_id", projectId)
        .neq("doc_source", "plan_upload")
        .order("created_at", { ascending: false });
      folderId
        ? docQuery.eq("folder_id", folderId)
        : docQuery.is("folder_id", null);

      const noteQuery = supabase
        .from("project_notes")
        .select("*")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });
      folderId
        ? noteQuery.eq("folder_id", folderId)
        : noteQuery.is("folder_id", null);

      const sheetQuery = supabase
        .from("project_spreadsheets")
        .select("*")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });
      folderId
        ? sheetQuery.eq("folder_id", folderId)
        : sheetQuery.is("folder_id", null);

      const [
        { data: folderData, error: folderError },
        { data: docData, error: docError },
        { data: noteData, error: noteError },
        { data: sheetData, error: sheetError },
      ] = await Promise.all([folderQuery, docQuery, noteQuery, sheetQuery]);

      if (folderError) throw folderError;
      if (docError) throw docError;
      if (noteError) throw noteError;
      if (sheetError) throw sheetError;

      setFolders(folderData || []);
      setDocuments(docData || []);
      setNotes(noteData || []);
      setSpreadsheets((sheetData as ProjectSpreadsheet[]) || []);
    } catch (error: any) {
      console.error(error);
      toast.error("Failed to load folder contents");
    } finally {
      setLoading(false);
    }
  }

  function closeNewSpreadsheetModal() {
    setNewSpreadsheetModal(null);
    setNewSpreadsheetName("");
  }

  function openCreatedSpreadsheet(data: ProjectSpreadsheet) {
    setSpreadsheets((prev) => {
      if (prev.some((s) => s.id === data.id)) return prev;
      return [data, ...prev];
    });
    setActiveSpreadsheetId(data.id);
    setActiveEditingTemplate(null);
    void loadFolderContents(currentFolderId);
  }

  const breadcrumbsUi = (
    <div className="flex flex-wrap items-center gap-1 text-sm text-gray-500">
      <button
        type="button"
        onClick={() => setFolderStack([])}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          handleBreadcrumbDrop(null);
        }}
        className={`${!currentFolderId ? "text-gray-900 font-medium" : "hover:text-gray-800"}`}
      >
        Drive
      </button>
      {breadcrumb.map((folder, index) => (
        <div key={folder.id} className="flex items-center gap-1">
          <span>/</span>
          <button
            type="button"
            onClick={() => setFolderStack(breadcrumb.slice(0, index + 1))}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              handleBreadcrumbDrop(folder.id);
            }}
            className={`${index === breadcrumb.length - 1 ? "text-gray-900 font-medium" : "hover:text-gray-800"}`}
          >
            {folder.name}
          </button>
        </div>
      ))}
    </div>
  );

  function enterFolder(folder: ProjectFolder) {
    setFolderStack((prev) => [...prev, folder]);
  }

  async function ensureFolderMoveAllowed(folderId: string, targetFolderId: string) {
    if (folderId === targetFolderId) return false;
    let cursor: string | null = targetFolderId;
    while (cursor) {
      if (cursor === folderId) return false;
      const { data }: PostgrestSingleResponse<{
        parent_folder_id: string | null;
      } | null> = await supabase
        .from("project_folders")
        .select("parent_folder_id")
        .eq("id", cursor)
        .maybeSingle<{ parent_folder_id: string | null }>();
      cursor = data?.parent_folder_id ?? null;
    }
    return true;
  }

  async function handleDropOnFolder(target: ProjectFolder) {
    if (!dragItem) return;
    try {
      if (dragItem.type === "file") {
        await supabase
          .from("project_documents")
          .update({ folder_id: target.id })
          .eq("id", dragItem.id);
      } else if (dragItem.type === "note") {
        await supabase
          .from("project_notes")
          .update({ folder_id: target.id })
          .eq("id", dragItem.id);
      } else if (dragItem.type === "spreadsheet") {
        await supabase
          .from("project_spreadsheets")
          .update({ folder_id: target.id })
          .eq("id", dragItem.id);
      } else if (dragItem.type === "folder") {
        const allowed = await ensureFolderMoveAllowed(dragItem.id, target.id);
        if (!allowed) {
          toast.error("Cannot move a folder inside itself");
          return;
        }
        await supabase
          .from("project_folders")
          .update({ parent_folder_id: target.id })
          .eq("id", dragItem.id);
      }
      await loadFolderContents(currentFolderId);
    } catch (error: any) {
      toast.error(error.message || "Failed to move item");
    } finally {
      setDragItem(null);
    }
  }

  function handleBreadcrumbDrop(targetFolderId: string | null) {
    if (!dragItem) return;
    const run = async () => {
      try {
        if (dragItem.type === "file") {
          await supabase
            .from("project_documents")
            .update({ folder_id: targetFolderId })
            .eq("id", dragItem.id);
        } else if (dragItem.type === "note") {
          await supabase
            .from("project_notes")
            .update({ folder_id: targetFolderId })
            .eq("id", dragItem.id);
        } else if (dragItem.type === "spreadsheet") {
          await supabase
            .from("project_spreadsheets")
            .update({ folder_id: targetFolderId })
            .eq("id", dragItem.id);
        } else if (dragItem.type === "folder") {
          if (targetFolderId) {
            const allowed = await ensureFolderMoveAllowed(dragItem.id, targetFolderId);
            if (!allowed) {
              toast.error("Cannot move a folder inside itself");
              return;
            }
          }
          await supabase
            .from("project_folders")
            .update({ parent_folder_id: targetFolderId })
            .eq("id", dragItem.id);
        }
        await loadFolderContents(currentFolderId);
      } catch (error: any) {
        toast.error(error.message || "Failed to move item");
      } finally {
        setDragItem(null);
      }
    };
    run();
  }

  async function createFolder() {
    if (!newFolderName.trim()) {
      toast.error("Folder name required");
      return;
    }
    try {
      const { data, error } = await supabase
        .from("project_folders")
        .insert({
          project_id: projectId,
          parent_folder_id: currentFolderId,
          name: newFolderName.trim(),
        })
        .select()
        .single();
      if (error) throw error;
      if (data) {
        if (!currentFolderId) {
          setFolders((prev) => [...prev, data]);
        } else {
          await loadFolderContents(currentFolderId);
        }
      }
      setShowFolderModal(false);
      setNewFolderName("");
    } catch (error: any) {
      toast.error(error.message || "Failed to create folder");
    }
  }

  async function createNote() {
    try {
      const { data, error }: PostgrestSingleResponse<ProjectNote> = await supabase
        .from("project_notes")
        .insert({
          project_id: projectId,
          folder_id: currentFolderId,
          title: "Untitled Note",
          content: { html: "<p><br></p>" },
          plain_text: "",
        })
        .select()
        .single();
      if (error) throw error;
      if (data) {
        await loadFolderContents(currentFolderId);
        setEditorInitializedFor(null);
        setActiveNote({
          note: data,
          html: data.content?.html || "",
          title: data.title,
          saving: false,
        });
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to create note");
    }
  }

  async function createSpreadsheet(templateId?: SpreadsheetTemplateId) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const initialSections = buildTemplatesections(templateId);
      const { data, error } = await supabase
        .from("project_spreadsheets")
        .insert({
          project_id: projectId,
          user_id: user.id,
          folder_id: currentFolderId,
          title: templateId ? TEMPLATE_LABELS[templateId] : "Untitled Spreadsheet",
          template_id: templateId ?? null,
          sections: initialSections,
          charges: [],
          baked_markups: [],
          subtotal: 0,
          total: 0,
        })
        .select()
        .single();
      if (error) throw error;
      if (data) {
        openCreatedSpreadsheet(data as ProjectSpreadsheet);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to create spreadsheet");
    }
  }


  async function createSpreadsheetWithTitle(title: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const initialSections = buildTemplatesections(undefined);
      const sheetTitle = title.trim() || "Untitled Spreadsheet";
      const { data, error } = await supabase
        .from("project_spreadsheets")
        .insert({
          project_id: projectId,
          user_id: user.id,
          folder_id: currentFolderId,
          title: sheetTitle,
          template_id: null,
          sections: initialSections,
          charges: [],
          baked_markups: [],
          subtotal: 0,
          total: 0,
        })
        .select()
        .single();
      if (error) throw error;
      if (data) {
        openCreatedSpreadsheet(data as ProjectSpreadsheet);
        toast.success(`Opened "${sheetTitle}"`);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to create spreadsheet");
    }
  }

  async function deleteSpreadsheet(id: string) {
    try {
      const { error } = await supabase
        .from("project_spreadsheets")
        .delete()
        .eq("id", id);
      if (error) throw error;
      if (activeSpreadsheetId === id) setActiveSpreadsheetId(null);
      setSpreadsheets((prev) => prev.filter((s) => s.id !== id));
      toast.success("Spreadsheet deleted");
    } catch (error: any) {
      toast.error(error.message || "Failed to delete spreadsheet");
    }
  }

  async function saveAsTemplate(sheet: ProjectSpreadsheet) {
    if (savingTemplate) return;
    const name = window.prompt("Template name:", sheet.title);
    if (name === null) return; // cancelled
    const trimmed = name.trim() || sheet.title;
    setSavingTemplate(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("spreadsheet_templates")
        .insert({
          user_id: user.id,
          title: trimmed,
          sections: sheet.sections,
          charges: sheet.charges,
          baked_markups: sheet.baked_markups,
        })
        .select()
        .single();
      if (error) throw error;
      if (data) setUserTemplates((prev) => [...prev, data as SpreadsheetTemplate]);
      toast.success(`Template "${trimmed}" saved`);
    } catch (error: any) {
      toast.error(error.message || "Failed to save template");
    } finally {
      setSavingTemplate(false);
    }
  }

  async function deleteUserTemplate(templateId: string) {
    try {
      const { error } = await supabase
        .from("spreadsheet_templates")
        .delete()
        .eq("id", templateId);
      if (error) throw error;
      setUserTemplates((prev) => prev.filter((t) => t.id !== templateId));
      toast.success("Template removed");
    } catch (error: any) {
      toast.error(error.message || "Failed to delete template");
    }
  }

  async function createFromUserTemplate(template: SpreadsheetTemplate, customTitle?: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("project_spreadsheets")
        .insert({
          project_id: projectId,
          user_id: user.id,
          folder_id: currentFolderId,
          title: (customTitle || "").trim() || template.title,
          template_id: null,
          sections: template.sections,
          charges: template.charges,
          baked_markups: template.baked_markups,
          subtotal: 0,
          total: 0,
        })
        .select()
        .single();
      if (error) throw error;
      if (data) {
        openCreatedSpreadsheet(data as ProjectSpreadsheet);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to create spreadsheet");
    }
  }

  async function duplicateSpreadsheet(sheet: ProjectSpreadsheet) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("project_spreadsheets")
        .insert({
          project_id: sheet.project_id,
          user_id: user.id,
          folder_id: sheet.folder_id,
          title: `${sheet.title} - Copy`,
          template_id: sheet.template_id,
          sections: sheet.sections,
          charges: sheet.charges,
          baked_markups: sheet.baked_markups,
          subtotal: sheet.subtotal,
          total: sheet.total,
        })
        .select()
        .single();

      if (error) throw error;
      if (data) setSpreadsheets((prev) => [...prev, data as ProjectSpreadsheet]);
      toast.success("Spreadsheet duplicated");
    } catch (error: any) {
      toast.error(error.message || "Failed to duplicate spreadsheet");
    }
  }

  function openNote(note: ProjectNote) {
    setEditorInitializedFor(null);
    setActiveNote({
      note,
      html: note.content?.html || "",
      title: note.title,
      saving: false,
    });
  }

  const closeActiveNote = () => {
    setActiveNote(null);
    setEditorInitializedFor(null);
    manualFontSizeRef.current = false;
  };

  const handleFontSizeChange = (value: string) => {
    manualFontSizeRef.current = true;
    setNoteFontSize(value);
    if (!noteEditorRef.current) return;
    ensureEditorSelection();
    const commandValue = FONT_SIZE_COMMAND_MAP[value] || "3";
    document.execCommand("styleWithCSS", true);
    document.execCommand("fontSize", false, commandValue);
    document.execCommand("styleWithCSS", false);
    normalizeFontElements(value);
    applyFontSizeToCaretContainer(value);
    ensureTablesNormalized();
    updateSegmentsFromEditor();
    captureSelectionSnapshot();
  };

  const handleAlignChange = (value: TextAlignValue) => {
    manualAlignRef.current = true;
    setTextAlign(value);
    if (!ensureEditorSelection()) return;
    const command = ALIGN_COMMAND_MAP[value];
    document.execCommand(command, false);
    updateSegmentsFromEditor();
    captureSelectionSnapshot();
  };

  const updateSegmentsFromEditor = () => {
    if (!noteEditorRef.current) return;
    const html = noteEditorRef.current.innerHTML;
    setNoteSegments(parseHtmlToSegments(html));
    setActiveNote((prev) => (prev ? { ...prev, html } : prev));
  };

  const handleEditorInput = () => {
    normalizeFontElements();
    applyFontSizeToCaretContainer(noteFontSize);
    ensureTablesNormalized();
    updateSegmentsFromEditor();
    captureSelectionSnapshot();
  };

  useEffect(() => {
    if (!activeNote || !noteEditorRef.current) return undefined;
    const handleSelectionChange = () => {
      if (!noteEditorRef.current) return;
      const selection = window.getSelection();
      if (
        !selection ||
        selection.rangeCount === 0 ||
        !noteEditorRef.current.contains(selection.anchorNode)
      ) {
        return;
      }
      captureSelectionSnapshot();

      // Update bullet list active state when caret moves
      setIsBulletListActive(isInBulletList());

      if (manualAlignRef.current) {
        manualAlignRef.current = false;
      } else {
        const selectionAlignment = getSelectionAlignment(noteEditorRef.current);
        if (selectionAlignment && selectionAlignment !== textAlign) {
          setTextAlign(selectionAlignment);
        }
      }

      if (manualFontSizeRef.current) {
        manualFontSizeRef.current = false;
        return;
      }
      const selectionFont = getSelectionFontSize(noteEditorRef.current);
      if (selectionFont && selectionFont !== noteFontSize) {
        setNoteFontSize(selectionFont);
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    handleSelectionChange();
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [activeNote, noteFontSize, textAlign]);

  useEffect(() => {
    if (!showAlignMenu) return undefined;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        alignButtonRef.current?.contains(target) ||
        alignMenuRef.current?.contains(target)
      ) {
        return;
      }
      setShowAlignMenu(false);
      setAlignMenuPosition(null);
    };
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, [showAlignMenu]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!noteEditorRef.current) return;
      const target = event.target as HTMLElement | null;
      if (!target) {
        if (!tableHoverLockRef.current) {
          setTableHoverState(null);
        }
        return;
      }
      const cell = target.closest("td,th") as HTMLTableCellElement | null;
      if (cell && noteEditorRef.current.contains(cell)) {
        const rect = cell.getBoundingClientRect();
        setTableHoverState((prev) => {
          if (
            prev &&
            prev.cell === cell &&
            prev.rect.top === rect.top &&
            prev.rect.left === rect.left &&
            prev.rect.width === rect.width &&
            prev.rect.height === rect.height
          ) {
            return prev;
          }
          return { cell, rect };
        });
        return;
      }
      if (!tableHoverLockRef.current) {
        const table = target.closest("table");
        if (!table || !noteEditorRef.current.contains(table)) {
          setTableHoverState(null);
        }
      }
    };

    const handleScroll = () => {
      setTableHoverState((prev) => {
        if (!prev) return null;
        const rect = prev.cell.getBoundingClientRect();
        return { cell: prev.cell, rect };
      });
    };

    document.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, []);

  async function saveNoteDraft(editor: NoteEditorState) {
    try {
      setActiveNote((prev) => (prev ? { ...prev, saving: true } : prev));
      const plain =
        noteSegments.length > 0
          ? segmentsToPlainText(noteSegments)
          : stripHtml(editor.html);
      const { data, error }: PostgrestSingleResponse<ProjectNote> = await supabase
        .from("project_notes")
        .update({
          title: editor.title || "Untitled Note",
          content: { html: editor.html },
          plain_text: plain,
        })
        .eq("id", editor.note.id)
        .select()
        .single();
      if (error) throw error;
      if (data) {
        setNotes((prev) => prev.map((note) => (note.id === data.id ? data : note)));
        setActiveNote((prev) => (prev ? { ...prev, saving: false, note: data } : prev));
      }
    } catch (error: any) {
      console.error(error);
      toast.error("Failed to save note");
      setActiveNote((prev) => (prev ? { ...prev, saving: false } : prev));
    }
  }

  async function deleteNote(noteId: string) {
    try {
      await supabase.from("project_notes").delete().eq("id", noteId);
      setNotes((prev) => prev.filter((note) => note.id !== noteId));
      if (activeNote?.note.id === noteId) {
        closeActiveNote();
      }
    } catch (error: any) {
      toast.error("Failed to delete note");
    }
  }

  async function deleteFolder(folder: ProjectFolder) {
    if (!confirm(`Delete folder "${folder.name}"?`)) return;
    try {
      await supabase.from("project_folders").delete().eq("id", folder.id);
      setFolders((prev) => prev.filter((f) => f.id !== folder.id));
      setFolderStack((prev) => prev.filter((f) => f.id !== folder.id));
      toast.success("Folder deleted");
    } catch (error: any) {
      toast.error(error.message || "Failed to delete folder");
    }
  }

  function handleDownloadNote(note: ProjectNote) {
    const fileName = `${sanitizeFileName(note.title || "untitled-note", "untitled-note")}.html`;
    const html = note.content?.html || note.plain_text || "";
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function downloadFolderContents(folderId: string) {
    const { data: docs, error: docsError } = await supabase
      .from("project_documents")
      .select("*")
      .eq("project_id", projectId)
      .eq("folder_id", folderId);
    if (docsError) throw docsError;
    for (const doc of docs || []) {
      await handleDownload(doc);
    }

    const { data: folderNotes, error: notesError } = await supabase
      .from("project_notes")
      .select("*")
      .eq("project_id", projectId)
      .eq("folder_id", folderId);
    if (notesError) throw notesError;
    folderNotes?.forEach((note) => handleDownloadNote(note));

    const { data: childFolders, error: childError } = await supabase
      .from("project_folders")
      .select("*")
      .eq("project_id", projectId)
      .eq("parent_folder_id", folderId);
    if (childError) throw childError;
    for (const child of childFolders || []) {
      await downloadFolderContents(child.id);
    }
  }

  async function handleDownloadFolder(folder: ProjectFolder) {
    try {
      await downloadFolderContents(folder.id);
      toast.success("Folder downloads started");
    } catch (error: any) {
      toast.error(error.message || "Failed to download folder");
    }
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList) as DirectoryFile[];
    const totalFiles = files.length;
    const batchKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setUploading(true);
    setUploadProgress({ current: 0, total: totalFiles });

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be signed in to upload files");

      let successCount = 0;
      const failures: string[] = [];

      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const displayName = getDisplayName(file);
        setUploadProgress({
          current: index + 1,
          total: totalFiles,
          name: displayName,
        });

        const normalizedPath = normalizeRelativePath(displayName, file.name);
        const storagePath = `${projectId}/${batchKey}/${normalizedPath}`.replace(
          /\/+/g,
          "/",
        );

        try {
          const { error: uploadError } = await supabase.storage
            .from("project-files")
            .upload(storagePath, file, {
              cacheControl: "3600",
              upsert: false,
            });

          if (uploadError) throw uploadError;

          const isPdf =
            file.type === "application/pdf" ||
            displayName.toLowerCase().endsWith(".pdf");

          const { data, error: dbError } = await supabase
            .from("project_documents")
            .insert({
              project_id: projectId,
              file_name: displayName,
              file_type: file.type || "application/octet-stream",
              mime_type: file.type || "application/octet-stream",
              file_size: file.size,
              storage_path: storagePath,
              uploaded_by: user.id,
              folder_id: currentFolderId,
              doc_source: "drive",
              ...(isPdf
                ? {
                    processing_status: "pending",
                    parse_status: "pending",
                  }
                : { parse_status: "pending" }),
            })
            .select()
            .single();

          if (dbError) throw dbError;
          if (data) {
            successCount += 1;
            setDocuments((prev) => [data, ...prev]);
            void fetch("/api/ai/drive-index", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId,
                documentIds: [data.id],
                maxDocs: 4,
              }),
            }).catch(() => {});
          }
        } catch (fileError: any) {
          failures.push(
            `${displayName}: ${fileError?.message || "Unable to upload"}`,
          );
          console.error(`Failed to upload ${displayName}`, fileError);
        }
      }

      if (successCount > 0) {
        toast.success(
          `Uploaded ${successCount} file${successCount === 1 ? "" : "s"}`,
        );
      }

      if (failures.length > 0) {
        toast.error(
          `Failed to upload ${failures.length} file${
            failures.length === 1 ? "" : "s"
          }`,
        );
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to upload files");
    } finally {
      setUploading(false);
      setUploadProgress(null);
      event.target.value = "";
    }
  }

  async function handleDelete(doc: ProjectDocument) {
    if (!confirm(`Delete ${doc.file_name}?`)) return;

    try {
      const { error: storageError } = await supabase.storage
        .from("project-files")
        .remove([doc.storage_path]);

      if (storageError) throw storageError;

      const { error: dbError } = await supabase
        .from("project_documents")
        .delete()
        .eq("id", doc.id);

      if (dbError) throw dbError;

      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      toast.success("File deleted");
    } catch (error: any) {
      toast.error("Failed to delete file");
    }
  }

  async function handleDownload(doc: ProjectDocument) {
    try {
      const { data, error } = await supabase.storage
        .from("project-files")
        .download(doc.storage_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = doc.file_name.split("/").pop() || doc.file_name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast.error("Failed to download file");
    }
  }

  async function handlePreview(doc: ProjectDocument) {
    const mode = determineViewerMode(doc);
    const inlineText = mode === "text" && doc.file_size <= MAX_TEXT_PREVIEW_BYTES;
    const effectiveMode: ViewerMode = inlineText
      ? "text"
      : mode === "text"
        ? "other"
        : mode;

    setPreviewState({
      doc,
      signedUrl: null,
      viewerUrl: null,
      textContent: null,
      loading: true,
      error: null,
      mode: effectiveMode,
    });

    try {
      const { data, error } = await supabase.storage
        .from("project-files")
        .createSignedUrl(doc.storage_path, 60 * 30);

      if (error || !data?.signedUrl) {
        throw error || new Error("Unable to generate preview link");
      }

      const signedUrl = data.signedUrl;

      if (inlineText) {
        const response = await fetch(signedUrl);
        if (!response.ok) {
          throw new Error("Unable to load text preview");
        }
        const text = await response.text();
        setPreviewState((prev) => ({
          ...prev,
          signedUrl,
          textContent: text,
          loading: false,
        }));
        return;
      }

      const viewerUrl =
        effectiveMode === "office"
          ? buildOfficeViewerUrl(signedUrl)
          : signedUrl;

      setPreviewState((prev) => ({
        ...prev,
        signedUrl,
        viewerUrl,
        loading: false,
      }));
    } catch (error: any) {
      console.error("Preview failed", error);
      setPreviewState((prev) => ({
        ...prev,
        loading: false,
        error: error.message || "Unable to open preview",
      }));
    }
  }

  const closePreview = () => {
    setPreviewState(createInitialPreviewState());
  };

  const openPreviewExternally = () => {
    const url = previewState.viewerUrl || previewState.signedUrl;
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
  };

  const getRenameTargetName = (target: RenameTarget | null) => {
    if (!target) return "";
    if (target.type === "file") return target.record.file_name;
    if (target.type === "folder") return target.record.name;
    if (target.type === "spreadsheet") return target.record.title || "Untitled Spreadsheet";
    return target.record.title || "Untitled Note";
  };

  function openRename(target: RenameTarget) {
    setMenuOpenDocId(null);
    setMenuOpenFolderId(null);
    setMenuOpenNoteId(null);
    setMenuOpenSpreadsheetId(null);
    setRenameTarget(target);
    setRenameValue(getRenameTargetName(target));
  }

  const closeRename = () => {
    if (renameLoading) return;
    setRenameTarget(null);
    setRenameValue("");
  };

  const handleRenameSubmit = async () => {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast.error("Name cannot be empty");
      return;
    }

    setRenameLoading(true);
    try {
      if (renameTarget.type === "file") {
        const { data, error } = await supabase
          .from("project_documents")
          .update({ file_name: trimmed })
          .eq("id", renameTarget.record.id)
          .select()
          .maybeSingle();

        if (error) throw error;
        if (!data) throw new Error("Document not found or you no longer have access.");
        setDocuments((prev) => prev.map((doc) => (doc.id === data.id ? data : doc)));
      } else if (renameTarget.type === "folder") {
        const { data, error } = await supabase
          .from("project_folders")
          .update({ name: trimmed })
          .eq("id", renameTarget.record.id)
          .select()
          .single();
        if (error) throw error;
        setFolders((prev) => prev.map((folder) => (folder.id === data.id ? data : folder)));
        setFolderStack((prev) =>
          prev.map((folder) => (folder.id === data.id ? data : folder)),
        );
      } else if (renameTarget.type === "spreadsheet") {
        const { data, error } = await supabase
          .from("project_spreadsheets")
          .update({ title: trimmed })
          .eq("id", renameTarget.record.id)
          .select()
          .single();
        if (error) throw error;
        setSpreadsheets((prev) =>
          prev.map((s) => (s.id === data.id ? (data as ProjectSpreadsheet) : s)),
        );
      } else {
        const { data, error } = await supabase
          .from("project_notes")
          .update({ title: trimmed })
          .eq("id", renameTarget.record.id)
          .select()
          .single();
        if (error) throw error;
        setNotes((prev) => prev.map((note) => (note.id === data.id ? data : note)));
        setActiveNote((prev) =>
          prev && prev.note.id === data.id ? { ...prev, title: data.title, note: data } : prev,
        );
      }
      toast.success("Item renamed");
      closeRename();
    } catch (error: any) {
      toast.error(error.message || "Failed to rename item");
    } finally {
      setRenameLoading(false);
    }
  };

  const renderPreviewContent = () => {
    if (!previewState.doc) {
      return null;
    }

    if (previewState.loading) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-500">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p>Preparing preview...</p>
        </div>
      );
    }

    if (previewState.error) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-6">
          <p className="text-sm text-red-500 mb-4">{previewState.error}</p>
          {previewState.signedUrl && (
            <button
              type="button"
              onClick={openPreviewExternally}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              Open in new tab
            </button>
          )}
        </div>
      );
    }

    if (previewState.mode === "text" && previewState.textContent) {
      return (
        <div className="h-full overflow-auto bg-gray-50 dark:bg-gray-900 p-4 rounded-lg">
          <pre className="text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-100">
            {previewState.textContent}
          </pre>
        </div>
      );
    }

    if (
      previewState.mode === "pdf" ||
      previewState.mode === "office" ||
      previewState.mode === "other"
    ) {
      if (!previewState.viewerUrl) {
        return (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">
            Preview unavailable for this file type.
          </div>
        );
      }

      return (
        <iframe
          src={previewState.viewerUrl}
          className="w-full h-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white"
          title={`${previewState.doc.file_name} preview`}
          referrerPolicy="no-referrer"
        />
      );
    }

    if (previewState.mode === "image") {
      return (
        <div className="h-full flex items-center justify-center bg-gray-100 dark:bg-gray-900 rounded-lg">
          <img
            src={previewState.viewerUrl || undefined}
            alt={previewState.doc.file_name}
            className="max-h-full max-w-full object-contain rounded-lg"
          />
        </div>
      );
    }

    return (
      <div className="h-full flex items-center justify-center text-gray-500 text-sm">
        Preview unavailable for this file type.
      </div>
    );
  };

  const renderNoteCard = (note: ProjectNote) => (
    <div
      key={`note-${note.id}`}
      draggable
      onDragStart={() => setDragItem({ id: note.id, type: "note" })}
      onDragEnd={() => setDragItem(null)}
      onClick={() => openNote(note)}
      onDoubleClick={() => openNote(note)}
      className="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 hover:shadow-2xl transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-4 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-yellow-100 text-yellow-600 flex items-center justify-center">
            <StickyNote size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {note.title || "Untitled Note"}
            </p>
            <p className="text-xs text-gray-500">
              {new Date(note.updated_at).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-right">
          <span className="text-xs text-green-600 dark:text-green-400">Click to open</span>
          <button
            type="button"
            aria-label="Note actions"
            className="p-2 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpenDocId(null);
              setMenuOpenFolderId(null);
              setMenuOpenNoteId((prev) => (prev === note.id ? null : note.id));
            }}
          >
            <MoreVertical size={18} />
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-3">
        {truncate(note.plain_text || "") || "Start typing to add content"}
      </p>
      {menuOpenNoteId === note.id && (
        <div className="absolute top-3 right-3 z-30 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-44 py-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openRename({ type: "note", record: note });
            }}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
          >
            <Pencil size={16} />
            Rename
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpenNoteId(null);
              handleDownloadNote(note);
            }}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
          >
            <Download size={16} />
            Download
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpenNoteId(null);
              deleteNote(note.id);
            }}
            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      )}
    </div>
  );

  const renderSpreadsheetCard = (sheet: ProjectSpreadsheet) => (
    <div
      key={`sheet-${sheet.id}`}
      draggable
      onDragStart={() => setDragItem({ id: sheet.id, type: "spreadsheet" })}
      onDragEnd={() => setDragItem(null)}
      onClick={() => setActiveSpreadsheetId(sheet.id)}
      onDoubleClick={() => setActiveSpreadsheetId(sheet.id)}
      className="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 hover:shadow-2xl transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-4 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 text-green-700 flex items-center justify-center">
            <FileSpreadsheet size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {sheet.title || "Untitled Spreadsheet"}
            </p>
            <p className="text-xs text-gray-500">
              {sheet.template_id ? TEMPLATE_LABELS[sheet.template_id] : "Blank spreadsheet"} •{" "}
              {new Date(sheet.updated_at).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-right">
          <span className="text-xs text-green-600 dark:text-green-400">Click to open</span>
          <button
            type="button"
            aria-label="Spreadsheet actions"
            className="p-2 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpenDocId(null);
              setMenuOpenFolderId(null);
              setMenuOpenNoteId(null);
              setMenuOpenSpreadsheetId((prev) => (prev === sheet.id ? null : sheet.id));
            }}
          >
            <MoreVertical size={18} />
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {sheet.sections.length === 0
          ? "No sections yet"
          : `${sheet.sections.length} section${sheet.sections.length !== 1 ? "s" : ""}`}
      </p>
      {menuOpenSpreadsheetId === sheet.id && (
        <div className="absolute top-3 right-3 z-30 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-44 py-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openRename({ type: "spreadsheet", record: sheet });
            }}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
          >
            <Pencil size={16} />
            Rename
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpenSpreadsheetId(null);
              duplicateSpreadsheet(sheet);
            }}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
          >
            <Copy size={16} />
            Duplicate
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpenSpreadsheetId(null);
              deleteSpreadsheet(sheet.id);
            }}
            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      )}
    </div>
  );

  const renderFolderCard = (folder: ProjectFolder) => (
    <div
      key={`folder-${folder.id}`}
      draggable
      onDragStart={() => setDragItem({ id: folder.id, type: "folder" })}
      onDragEnd={() => setDragItem(null)}
      onDoubleClick={() => enterFolder(folder)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        handleDropOnFolder(folder);
      }}
      className="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 hover:shadow-2xl transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 text-green-600 flex items-center justify-center">
            <Folder size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {folder.name}
            </p>
            <p className="text-xs text-gray-500">
              Updated {new Date(folder.updated_at).toLocaleDateString()}
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Folder actions"
          className="p-2 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpenDocId(null);
            setMenuOpenNoteId(null);
            setMenuOpenFolderId((prev) => (prev === folder.id ? null : folder.id));
          }}
        >
          <MoreVertical size={18} />
        </button>
      </div>
      {menuOpenFolderId === folder.id && (
        <div className="absolute top-3 right-3 z-30 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-44 py-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openRename({ type: "folder", record: folder });
            }}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
          >
            <Pencil size={16} />
            Rename
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpenFolderId(null);
              handleDownloadFolder(folder);
            }}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
          >
            <Download size={16} />
            Download
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpenFolderId(null);
              deleteFolder(folder);
            }}
            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      )}
    </div>
  );

  const renderFileCard = (doc: ProjectDocument) => {
    const meta = getDocumentMeta(doc);
    const pathParts = doc.file_name.split("/");
    const simpleName = pathParts.pop() || doc.file_name;
    return (
      <div
        key={`file-${doc.id}`}
        role="button"
        tabIndex={0}
        draggable
        onDragStart={() => setDragItem({ id: doc.id, type: "file" })}
        onDragEnd={() => setDragItem(null)}
        onClick={() => handlePreview(doc)}
        className="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 hover:shadow-2xl transition-all cursor-pointer group"
      >
        <div className="flex items-start justify-between gap-3">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center text-base font-semibold ${meta.accentBg} ${meta.accentText}`}
          >
            {meta.icon}
          </div>
          <button
            type="button"
            aria-label="File actions"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpenFolderId(null);
              setMenuOpenNoteId(null);
              setMenuOpenDocId((prev) => (prev === doc.id ? null : doc.id));
            }}
            className="p-2 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <MoreVertical size={18} />
          </button>
          {menuOpenDocId === doc.id && (
            <div className="absolute top-3 right-3 z-30 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-44 py-2">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openRename({ type: "file", record: doc });
                }}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
              >
                <Pencil size={16} />
                Rename
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpenDocId(null);
                  handleDownload(doc);
                }}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
              >
                <Download size={16} />
                Download
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpenDocId(null);
                  handleDelete(doc);
                }}
                className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          )}
        </div>
        <div className="mt-6">
          <p className="text-xs uppercase tracking-wide text-gray-500">
            {meta.label}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100 truncate" title={doc.file_name}>
            {simpleName}
          </h3>
        </div>
        <div className="mt-4 text-xs text-gray-500">
          {doc.file_type || "Unknown type"}
        </div>
        <div className="mt-6 flex items-center justify-between text-xs text-gray-500">
          <span>{formatFileSize(doc.file_size)}</span>
          <span>{new Date(doc.created_at).toLocaleDateString()}</span>
        </div>
        <div className="mt-4 text-sm text-green-600 dark:text-green-400 opacity-0 group-hover:opacity-100 transition-opacity">
          Click to preview
        </div>
      </div>
    );
  };

  type DriveItem =
    | { type: "folder"; record: ProjectFolder; timestamp: number }
    | { type: "note"; record: ProjectNote; timestamp: number }
    | { type: "file"; record: ProjectDocument; timestamp: number }
    | { type: "spreadsheet"; record: ProjectSpreadsheet; timestamp: number };

  const driveItems = useMemo(() => {
    const items: DriveItem[] = [];
    folders.forEach((folder) => {
      const timestamp = folder.updated_at
        ? new Date(folder.updated_at).getTime()
        : Date.now();
      items.push({ type: "folder", record: folder, timestamp });
    });
    notes.forEach((note) => {
      const timestamp = note.updated_at ? new Date(note.updated_at).getTime() : Date.now();
      items.push({ type: "note", record: note, timestamp });
    });
    spreadsheets.forEach((sheet) => {
      const timestamp = sheet.updated_at ? new Date(sheet.updated_at).getTime() : Date.now();
      items.push({ type: "spreadsheet", record: sheet, timestamp });
    });
    documents.forEach((doc) => {
      const timestamp = doc.created_at ? new Date(doc.created_at).getTime() : Date.now();
      items.push({ type: "file", record: doc, timestamp });
    });
    return items.sort((a, b) => b.timestamp - a.timestamp);
  }, [folders, notes, spreadsheets, documents]);

  const renderDriveCard = (item: DriveItem) => {
    if (item.type === "folder") return renderFolderCard(item.record);
    if (item.type === "note") return renderNoteCard(item.record);
    if (item.type === "spreadsheet") return renderSpreadsheetCard(item.record);
    return renderFileCard(item.record);
  };

  const hasItems = driveItems.length > 0;

  return (
    <div className="h-full bg-gray-50 dark:bg-gray-950 p-6">
      {/* Transparent backdrop — closes any open card menu when clicking outside */}
      {anyMenuOpen && (
        <div className="fixed inset-0 z-20" onClick={closeAllMenus} />
      )}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-6">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold">Project Documents</h2>
          {breadcrumbsUi}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center relative">
          <label
            className={`px-4 py-2 rounded-lg border border-transparent bg-brand-green text-white inline-flex items-center justify-center gap-2 cursor-pointer transition-colors ${
              uploading ? "opacity-60 cursor-not-allowed" : "hover:bg-brand-green-dark"
            }`}
          >
            {uploading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Upload size={18} />
            )}
            <span>
              {uploading && uploadProgress
                ? `Uploading ${uploadProgress.current}/${uploadProgress.total}`
                : "Upload Files"}
            </span>
            <input
              type="file"
              multiple
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
          <label
            className={`px-4 py-2 rounded-lg border border-dashed border-gray-400 text-gray-700 dark:text-gray-200 inline-flex items-center justify-center gap-2 cursor-pointer transition-colors ${
              uploading ? "opacity-60 cursor-not-allowed" : "hover:border-gray-600"
            }`}
          >
            {uploading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <FolderPlus size={18} />
            )}
            <span>Upload Folder</span>
            <input
              type="file"
              multiple
              onChange={handleFileUpload}
              disabled={uploading}
              ref={folderInputRef}
              className="hidden"
            />
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNewMenu((prev) => !prev)}
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 inline-flex items-center gap-2 hover:bg-gray-100 transition-colors"
            >
              <Plus size={16} />
              New
            </button>
            {showNewMenu && (
              <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-2xl border border-gray-200 py-2 z-20">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewMenu(false);
                    setShowFolderModal(true);
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                >
                  <Folder size={16} />
                  New Folder
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewMenu(false);
                    createNote();
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                >
                  <StickyNote size={16} />
                  New Note
                </button>

              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Spreadsheet template strip ────────────────────────── */}
      {!spreadsheetEditorOpen && (
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-3">
            New Spreadsheet
          </p>
          {/* pt-3 gives room so the delete badge on user cards isn't clipped */}
          <div className="flex gap-3 overflow-x-auto pb-2 pt-3 -mx-1 px-1">
            {/* Blank */}
            <button
              type="button"
              onClick={() => {
                setNewSpreadsheetName("");
                setNewSpreadsheetModal({ mode: "blank" });
              }}
              className="flex-shrink-0 flex flex-col items-center gap-2 p-3 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-green-500 dark:hover:border-green-600 hover:bg-green-50 dark:hover:bg-green-950/30 transition-all group w-[112px]"
            >
              <div className="w-full h-[72px] rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center group-hover:bg-green-100 dark:group-hover:bg-green-900/40 transition-colors">
                <FileSpreadsheet size={28} className="text-green-600" />
              </div>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 text-center leading-tight">Blank spreadsheet</span>
            </button>

            {/* User-saved templates */}
            {userTemplates.map((tmpl) => (
              <div key={tmpl.id} className="relative flex-shrink-0 group/tmpl w-[112px]">
                {/* Card */}
                <button
                  type="button"
                  onClick={() => {
                    if (confirmDeleteTemplateId === tmpl.id) {
                      setConfirmDeleteTemplateId(null);
                      return;
                    }
                    setNewSpreadsheetName(tmpl.title);
                    setNewSpreadsheetModal({ mode: "template", template: tmpl });
                  }}
                  className="w-full flex flex-col items-center gap-2 p-3 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-green-500 dark:hover:border-green-600 hover:bg-green-50 dark:hover:bg-green-950/30 transition-all group"
                >
                  <div className="w-full h-[72px] rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex flex-col p-2.5 gap-1 overflow-hidden">
                    {(tmpl.sections || []).slice(0, 4).map((sec, i) => (
                      <div key={i} className="flex flex-col gap-0.5">
                        <div className="h-1 bg-amber-400 rounded w-3/4" />
                        <div className="h-0.5 bg-amber-200 rounded w-full" />
                      </div>
                    ))}
                    {(tmpl.sections || []).length === 0 && (
                      <div className="h-1 bg-amber-300 rounded w-1/2" />
                    )}
                  </div>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 text-center leading-tight line-clamp-2">{tmpl.title}</span>
                </button>

                {/* Delete badge — positioned inside card bounds, top-right */}
                {confirmDeleteTemplateId !== tmpl.id && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteTemplateId(tmpl.id);
                    }}
                    className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-400 hover:text-red-500 hover:border-red-400 hidden group-hover/tmpl:flex items-center justify-center shadow-sm transition-all"
                    aria-label="Delete template"
                  >
                    <BookmarkMinus size={11} />
                  </button>
                )}

                {/* Inline confirm overlay */}
                {confirmDeleteTemplateId === tmpl.id && (
                  <div className="absolute inset-0 rounded-xl bg-white/95 dark:bg-gray-900/95 border-2 border-red-300 dark:border-red-700 flex flex-col items-center justify-center gap-2 p-2 z-10">
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 text-center leading-tight">
                      Delete this template?
                    </p>
                    <div className="flex gap-1.5 w-full">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteUserTemplate(tmpl.id);
                          setConfirmDeleteTemplateId(null);
                        }}
                        className="flex-1 py-1 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-medium transition-colors"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteTemplateId(null);
                        }}
                        className="flex-1 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs font-medium transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!spreadsheetEditorOpen && uploading && uploadProgress?.name && (
        <p className="text-sm text-gray-500 mb-4">
          Uploading <span className="font-medium">{uploadProgress.name}</span>
        </p>
      )}

      {!spreadsheetEditorOpen && (loading ? (
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
            <p className="text-gray-500">Loading documents...</p>
          </div>
        </div>
      ) : !hasItems ? (
        <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
          <File size={48} className="mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600 dark:text-gray-400 mb-2">
            No items in this folder yet
          </p>
          <p className="text-sm text-gray-500">
            Use the Upload or New buttons to add files, notes, or folders.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {driveItems.map((item) => renderDriveCard(item))}
        </div>
      ))}

      {previewState.doc && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4 py-8"
          onClick={closePreview}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-lg font-semibold truncate">
                  {previewState.doc.file_name}
                </p>
                <p className="text-sm text-gray-500">
                  {previewState.doc.file_type || "Unknown type"} • {formatFileSize(previewState.doc.file_size)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {(previewState.viewerUrl || previewState.signedUrl) && (
                  <button
                    type="button"
                    onClick={openPreviewExternally}
                    className="px-3 py-2 text-sm font-medium text-green-600 hover:text-green-800 transition-colors rounded-lg"
                  >
                    Open in new tab
                  </button>
                )}
                <button
                  type="button"
                  onClick={closePreview}
                  className="p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  aria-label="Close preview"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 p-4">{renderPreviewContent()}</div>
          </div>
        </div>
      )}

      {showFolderModal && (
        <div
          className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center px-4"
          onClick={() => setShowFolderModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2">New folder</h3>
            <p className="text-sm text-gray-500 mb-4">
              {currentFolderId ? "Folder will be created inside the current folder." : "Folder will live at the root of this project."}
            </p>
            <input
              type="text"
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="Folder name"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") createFolder();
              }}
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowFolderModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={createFolder}
                className="px-4 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {renameTarget && (
        <div
          className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center px-4"
          onClick={closeRename}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2">
              {renameTarget.type === "file"
                ? "Rename file"
                : renameTarget.type === "folder"
                  ? "Rename folder"
                  : renameTarget.type === "spreadsheet"
                    ? "Rename spreadsheet"
                    : "Rename note"}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Enter a new name for “{getRenameTargetName(renameTarget)}”.
            </p>
            <input
              type="text"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleRenameSubmit();
              }}
              autoFocus
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="Enter new file name"
              disabled={renameLoading}
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeRename}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100"
                disabled={renameLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRenameSubmit}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-60"
                disabled={renameLoading}
              >
                {renameLoading ? "Saving..." : "Rename"}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeNote && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4 py-10"
          onClick={closeActiveNote}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-4 border-b border-gray-200 px-6 py-3">
              <div className="flex-1">
                <input
                  type="text"
                  value={activeNote.title}
                  onChange={(event) =>
                    setActiveNote((prev) =>
                      prev ? { ...prev, title: event.target.value } : prev,
                    )
                  }
                  className="w-full text-lg font-semibold bg-transparent outline-none"
                />
                <p className="text-xs text-gray-500">
                  {activeNote.saving ? "Saving…" : "Saved"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => deleteNote(activeNote.note.id)}
                className="p-2 text-red-500 hover:text-red-600"
              >
                <Trash2 size={18} />
              </button>
              <button
                type="button"
                onClick={closeActiveNote}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Close
              </button>
            </div>
            <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-2 overflow-x-auto overflow-y-visible text-gray-600">
              <div className="flex items-center">
                <label htmlFor="note-font-size" className="sr-only">
                  Font size
                </label>
                <select
                  id="note-font-size"
                  value={noteFontSize}
                  onChange={(event) => handleFontSizeChange(event.target.value)}
                  className="px-3 py-1.5 rounded-full border border-gray-300 text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  {["12px", "14px", "16px", "18px", "20px", "24px", "32px"].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => applyEditorCommand("bold")}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <Bold size={16} />
              </button>
              <button
                type="button"
                onClick={() => applyEditorCommand("italic")}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <Italic size={16} />
              </button>
              <button
                type="button"
                onClick={() => applyEditorCommand("underline")}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <Underline size={16} />
              </button>
              <button
                type="button"
                onClick={toggleHighlight}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <Highlighter size={16} />
              </button>
              <button
                type="button"
                onClick={() => applyEditorCommand("strikeThrough")}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <Strikethrough size={16} />
              </button>
              <div className="relative">
                <button
                  type="button"
                  ref={alignButtonRef}
                  onClick={() =>
                    setShowAlignMenu((prev) => {
                      const next = !prev;
                      if (next && alignButtonRef.current) {
                        const rect = alignButtonRef.current.getBoundingClientRect();
                        setAlignMenuPosition({
                          top: rect.bottom + window.scrollY + 8,
                          left: rect.left + window.scrollX,
                        });
                      } else {
                        setAlignMenuPosition(null);
                      }
                      return next;
                    })
                  }
                  className="p-2 rounded-lg hover:bg-gray-100 flex items-center gap-1"
                  title="Text alignment"
                >
                  {(() => {
                    const Icon = ALIGN_ICON_MAP[textAlign];
                    return <Icon size={16} />;
                  })()}
                  <ChevronDown size={14} />
                </button>
                {showAlignMenu &&
                  alignMenuPosition &&
                  createPortal(
                    <div
                      ref={alignMenuRef}
                      className="fixed bg-white border border-gray-200 rounded-xl shadow-xl w-36 py-1 z-[9999]"
                      style={{ top: alignMenuPosition.top, left: alignMenuPosition.left }}
                    >
                      {(["left", "center", "right"] as TextAlignValue[]).map((value) => {
                        const Icon = ALIGN_ICON_MAP[value];
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => {
                              handleAlignChange(value);
                              setShowAlignMenu(false);
                              setAlignMenuPosition(null);
                            }}
                            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-100 ${
                              textAlign === value ? "text-green-600 font-semibold" : "text-gray-700"
                            }`}
                          >
                            <Icon size={16} />
                            <span className="capitalize">{value}</span>
                          </button>
                        );
                      })}
                    </div>,
                    document.body,
                  )}
              </div>
              <button
                type="button"
                onClick={toggleBulletList}
                className={`p-2 rounded-lg hover:bg-gray-100 ${isBulletListActive ? "bg-green-100 text-green-600" : ""}`}
                title="Bullet list (toggle)"
              >
                <List size={16} />
              </button>
              <button
                type="button"
                onClick={() => applyEditorCommand("insertOrderedList")}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <ListOrdered size={16} />
              </button>
              <button
                type="button"
                onClick={insertLink}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <LinkIcon size={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  insertTable();
                }}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <Table size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-gray-100">
              <div className="max-w-3xl w-full bg-white shadow-lg rounded-2xl mx-auto my-6 px-10 py-10 min-h-[calc(100%-3rem)]">
                <div
                  ref={noteEditorRef}
                  contentEditable
                  suppressContentEditableWarning
                  className="w-full min-h-[600px] focus:outline-none leading-relaxed [&_a]:cursor-pointer [&_a]:text-green-600 [&_a]:underline [&_a:hover]:text-green-800 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2 [&_li]:leading-relaxed"
                  onInput={handleEditorInput}
                  onClick={(event) => {
                    const target = event.target as HTMLElement;
                    if (target.tagName !== "A") return;

                    const href = target.getAttribute("href");
                    if (!href) return;

                    // Hold Shift to keep the editor caret inside the link for editing
                    if (event.shiftKey) {
                      return;
                    }

                    event.preventDefault();
                    window.open(href, "_blank", "noopener,noreferrer");
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}


            {/* ── New spreadsheet naming modal (blank or from template) ── */}
      {newSpreadsheetModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4"
          onClick={closeNewSpreadsheetModal}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl border-2 border-green-700 shadow-2xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Create New Spreadsheet
              </h3>
              <button
                type="button"
                onClick={closeNewSpreadsheetModal}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Spreadsheet Name
            </label>
            <input
              type="text"
              autoFocus
              value={newSpreadsheetName}
              onChange={(e) => setNewSpreadsheetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newSpreadsheetName.trim()) {
                  const modal = newSpreadsheetModal;
                  const title = newSpreadsheetName;
                  closeNewSpreadsheetModal();
                  if (modal.mode === "blank") {
                    void createSpreadsheetWithTitle(title);
                  } else {
                    void createFromUserTemplate(modal.template, title);
                  }
                }
                if (e.key === "Escape") closeNewSpreadsheetModal();
              }}
              placeholder={
                newSpreadsheetModal.mode === "blank"
                  ? "e.g., Kitchen remodel estimate"
                  : `e.g., ${newSpreadsheetModal.template.title} — Project A`
              }
              className="w-full px-4 py-3 rounded-xl border-2 border-green-600 focus:outline-none focus:ring-2 focus:ring-green-300 dark:bg-gray-800 dark:border-green-700 dark:text-gray-100 text-gray-900 text-sm mb-5"
            />
            <div className="flex items-center justify-end gap-2">
              {newSpreadsheetModal.mode === "template" && (
                <button
                  type="button"
                  onClick={() => {
                    const modal = newSpreadsheetModal;
                    closeNewSpreadsheetModal();
                    setActiveEditingTemplate(modal.template);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-green-700 text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30 dark:text-green-400 dark:border-green-600 text-sm font-medium whitespace-nowrap transition-colors"
                >
                  <Pencil size={14} />
                  Edit Template
                </button>
              )}
              <button
                type="button"
                disabled={!newSpreadsheetName.trim()}
                onClick={() => {
                  const modal = newSpreadsheetModal;
                  const title = newSpreadsheetName;
                  closeNewSpreadsheetModal();
                  if (modal.mode === "blank") {
                    void createSpreadsheetWithTitle(title);
                  } else {
                    void createFromUserTemplate(modal.template, title);
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium whitespace-nowrap transition-colors"
              >
                Start Spreadsheet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Active spreadsheet editor ─────────────────────────────────── */}
      {activeEditingTemplate && (
        <SpreadsheetEditor
          spreadsheet={templateToEditorSpreadsheet(activeEditingTemplate)}
          templateMode
          onClose={() => setActiveEditingTemplate(null)}
          onTemplateUpdate={(updated) => {
            setActiveEditingTemplate(updated);
            setUserTemplates((prev) =>
              prev.map((t) => (t.id === updated.id ? updated : t)),
            );
          }}
        />
      )}

      {activeSpreadsheetId && (() => {
        const sheet = spreadsheets.find((s) => s.id === activeSpreadsheetId);
        if (!sheet) return null;
        return (
          <SpreadsheetEditor
            spreadsheet={sheet}
            onClose={() => {
              setActiveSpreadsheetId(null);
              setSpreadsheetEditContext(null);
            }}
            onDelete={(id) => {
              setActiveSpreadsheetId(null);
              setSpreadsheetEditContext(null);
              deleteSpreadsheet(id);
            }}
            editQuoteId={spreadsheetEditContext?.quoteId}
            editVersion={spreadsheetEditContext?.version}
            editQuoteNumber={spreadsheetEditContext?.quoteNumber}
            onUpdate={(updated) =>
              setSpreadsheets((prev) =>
                prev.map((s) => (s.id === updated.id ? updated : s)),
              )
            }
            onSaveAsTemplate={() => saveAsTemplate(sheet)}
          />
        );
      })()}

      {tableHoverState &&
        createPortal(
          <>
            <button
              type="button"
              onMouseEnter={() => {
                tableHoverLockRef.current = true;
              }}
              onMouseLeave={() => {
                tableHoverLockRef.current = false;
              }}
              onClick={(event) => {
                event.preventDefault();
                addTableRowBelow(tableHoverState.cell);
              }}
              className="fixed z-[9999] -translate-y-1/2 bg-white border border-gray-300 rounded-full shadow-lg p-1 text-gray-700 hover:bg-gray-100 flex items-center justify-center"
              style={{
                top: tableHoverState.rect.top + tableHoverState.rect.height / 2,
                left: tableHoverState.rect.left - 18,
              }}
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              onMouseEnter={() => {
                tableHoverLockRef.current = true;
              }}
              onMouseLeave={() => {
                tableHoverLockRef.current = false;
              }}
              onClick={(event) => {
                event.preventDefault();
                addTableColumnRight(tableHoverState.cell);
              }}
              className="fixed z-[9999] -translate-x-1/2 bg-white border border-gray-300 rounded-full shadow-lg p-1 text-gray-700 hover:bg-gray-100 flex items-center justify-center"
              style={{
                top: tableHoverState.rect.top - 18,
                left: tableHoverState.rect.left + tableHoverState.rect.width / 2,
              }}
            >
              <Plus size={16} />
            </button>
          </>,
          document.body,
        )}
    </div>
  );
}
