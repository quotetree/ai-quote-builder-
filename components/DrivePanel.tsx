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
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Link as LinkIcon,
  Table,
  Plus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ProjectDocument,
  ProjectFolder,
  ProjectNote,
} from "@/types/database";
import toast from "react-hot-toast";

interface DrivePanelProps {
  projectId: string;
}

type DirectoryFile = File & { webkitRelativePath?: string };
type ViewerMode = "image" | "pdf" | "office" | "text" | "other";
type DriveItemType = "file" | "folder" | "note";

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

const NOTE_AUTOSAVE_DELAY = 900;
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

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
      accentBg: "bg-blue-100",
      accentText: "text-blue-600",
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

export default function DrivePanel({ projectId }: DrivePanelProps) {
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
  const [renamingDoc, setRenamingDoc] = useState<ProjectDocument | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [activeNote, setActiveNote] = useState<NoteEditorState | null>(null);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const currentFolderId =
    folderStack.length > 0 ? folderStack[folderStack.length - 1].id : null;
  const noteEditorRef = useRef<HTMLDivElement | null>(null);
  const [editorInitializedFor, setEditorInitializedFor] = useState<string | null>(null);
  const [noteFontSize, setNoteFontSize] = useState(DEFAULT_FONT_SIZE);
  const [noteSegments, setNoteSegments] = useState<NoteSegment[]>([]);

  const applyEditorCommand = (command: string, value?: string) => {
    if (!noteEditorRef.current) return;
    noteEditorRef.current.focus();
    document.execCommand(command, false, value);
  };

  const insertTable = () => {
    if (!noteEditorRef.current) return;
    const tableHtml =
      '<table class="border border-gray-300 w-full text-left">' +
      '<tr><th class="border border-gray-200 px-3 py-2">Header 1</th><th class="border border-gray-200 px-3 py-2">Header 2</th></tr>' +
      '<tr><td class="border border-gray-200 px-3 py-2"><br></td><td class="border border-gray-200 px-3 py-2"><br></td></tr>' +
      "</table><p><br></p>";
    applyEditorCommand("insertHTML", tableHtml);
  };

  const insertLink = () => {
    const url = prompt("Enter URL");
    if (!url) return;
    applyEditorCommand("createLink", url);
  };

  const folderInputRef = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      node.setAttribute("webkitdirectory", "true");
      node.setAttribute("directory", "true");
    }
  }, []);

  useEffect(() => {
    loadFolderContents(currentFolderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, currentFolderId]);

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
      return;
    }
    if (editorInitializedFor === activeNote.note.id) return;
      const html =
        activeNote.html && activeNote.html.trim().length > 0
          ? activeNote.html
          : "<p><br></p>";
    noteEditorRef.current.innerHTML = html;
    noteEditorRef.current.focus();
    setNoteSegments(parseHtmlToSegments(html));
    setEditorInitializedFor(activeNote.note.id);
  }, [activeNote?.note.id, activeNote?.html, editorInitializedFor]);

  useEffect(() => {
    if (!activeNote) return;
    setNoteFontSize(DEFAULT_FONT_SIZE);
  }, [activeNote?.note.id]);


  const breadcrumb = useMemo(() => folderStack, [folderStack]);

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

      const [{ data: folderData, error: folderError }, { data: docData, error: docError }, { data: noteData, error: noteError }] =
        await Promise.all([folderQuery, docQuery, noteQuery]);

      if (folderError) throw folderError;
      if (docError) throw docError;
      if (noteError) throw noteError;

      setFolders(folderData || []);
      setDocuments(docData || []);
      setNotes(noteData || []);
    } catch (error: any) {
      console.error(error);
      toast.error("Failed to load folder contents");
    } finally {
      setLoading(false);
    }
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
  };

  const handleFontSizeChange = (value: string) => {
    setNoteFontSize(value);
    if (!noteEditorRef.current) return;
    noteEditorRef.current.focus();
    const commandValue = FONT_SIZE_COMMAND_MAP[value] || "3";
    document.execCommand("styleWithCSS", false);
    document.execCommand("fontSize", false, commandValue);
    const fonts = noteEditorRef.current.querySelectorAll("font[size]");
    fonts.forEach((fontEl) => {
      const size = fontEl.getAttribute("size");
      if (!size) return;
      const resolved = Object.entries(FONT_SIZE_COMMAND_MAP).find(
        ([, cmd]) => cmd === size,
      )?.[0];
      fontEl.removeAttribute("size");
      (fontEl as HTMLElement).style.fontSize = resolved || value;
    });
    updateSegmentsFromEditor();
  };

  const updateSegmentsFromEditor = () => {
    if (!noteEditorRef.current) return;
    const html = noteEditorRef.current.innerHTML;
    setNoteSegments(parseHtmlToSegments(html));
    setActiveNote((prev) => (prev ? { ...prev, html } : prev));
  };

  const handleEditorInput = () => {
    updateSegmentsFromEditor();
  };

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

          const { data, error: dbError } = await supabase
            .from("project_documents")
            .insert({
              project_id: projectId,
              file_name: displayName,
              file_type: file.type || "application/octet-stream",
              file_size: file.size,
              storage_path: storagePath,
              uploaded_by: user.id,
              folder_id: currentFolderId,
            })
            .select()
            .single();

          if (dbError) throw dbError;
          if (data) {
            successCount += 1;
            setDocuments((prev) => [data, ...prev]);
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

  function startRename(doc: ProjectDocument) {
    setMenuOpenDocId(null);
    setRenamingDoc(doc);
    setRenameValue(doc.file_name);
  }

  const closeRename = () => {
    if (renameLoading) return;
    setRenamingDoc(null);
    setRenameValue("");
  };

  const handleRenameSubmit = async () => {
    if (!renamingDoc) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast.error("File name cannot be empty");
      return;
    }

    setRenameLoading(true);
    try {
      const { data, error } = await supabase
        .from("project_documents")
        .update({ file_name: trimmed })
        .eq("id", renamingDoc.id)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("Document not found or you no longer have access.");

      setDocuments((prev) => prev.map((doc) => (doc.id === data.id ? data : doc)));
      toast.success("File renamed");
      closeRename();
    } catch (error: any) {
      toast.error(error.message || "Failed to rename file");
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
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
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

  const renderNoteCards = () => (
    notes.map((note) => (
      <div
        key={note.id}
        draggable
        onDragStart={() => setDragItem({ id: note.id, type: "note" })}
        onDragEnd={() => setDragItem(null)}
        onDoubleClick={() => openNote(note)}
        className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 hover:shadow-2xl transition-all cursor-pointer group"
      >
        <div className="flex items-center justify-between mb-4">
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
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openNote(note);
            }}
            className="text-blue-600 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity"
          >
            Open
          </button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-3">
          {truncate(note.plain_text || "") || "Start typing to add content"}
        </p>
      </div>
    ))
  );

  const renderFolderCards = () => (
    folders.map((folder) => (
      <div
        key={folder.id}
        draggable
        onDragStart={() => setDragItem({ id: folder.id, type: "folder" })}
        onDragEnd={() => setDragItem(null)}
        onDoubleClick={() => enterFolder(folder)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          handleDropOnFolder(folder);
        }}
        className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 hover:shadow-2xl transition-all cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
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
      </div>
    ))
  );

  const renderFileCards = () => (
    documents.map((doc) => {
      const meta = getDocumentMeta(doc);
      const pathParts = doc.file_name.split("/");
      const simpleName = pathParts.pop() || doc.file_name;
      return (
        <div
          key={doc.id}
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
                    startRename(doc);
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
          <div className="mt-4 text-sm text-blue-600 dark:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
            Click to preview
          </div>
        </div>
      );
    })
  );

  const hasItems = folders.length + notes.length + documents.length > 0;

  return (
    <div className="h-full bg-gray-50 dark:bg-gray-950 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-6">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold">Project Documents</h2>
          {breadcrumbsUi}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center relative">
          <label
            className={`px-4 py-2 rounded-lg border border-transparent bg-blue-600 text-white inline-flex items-center justify-center gap-2 cursor-pointer transition-colors ${
              uploading ? "opacity-60 cursor-not-allowed" : "hover:bg-blue-700"
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
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-2xl border border-gray-200 py-2 z-20">
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

      {uploading && uploadProgress?.name && (
        <p className="text-sm text-gray-500 mb-4">
          Uploading <span className="font-medium">{uploadProgress.name}</span>
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
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
          {renderFolderCards()}
          {renderNoteCards()}
          {renderFileCards()}
        </div>
      )}

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
                    className="px-3 py-2 text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors rounded-lg"
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
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {renamingDoc && (
        <div
          className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center px-4"
          onClick={closeRename}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2">Rename file</h3>
            <p className="text-sm text-gray-500 mb-4">
              Enter a new name for “{renamingDoc.file_name}”.
            </p>
            <input
              type="text"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleRenameSubmit();
              }}
              autoFocus
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
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
            <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-2 overflow-x-auto text-gray-600">
              <div className="flex items-center">
                <label htmlFor="note-font-size" className="sr-only">
                  Font size
                </label>
                <select
                  id="note-font-size"
                  value={noteFontSize}
                  onChange={(event) => handleFontSizeChange(event.target.value)}
                  className="px-3 py-1.5 rounded-full border border-gray-300 text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                onClick={() => applyEditorCommand("strikeThrough")}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <Strikethrough size={16} />
              </button>
              <button
                type="button"
                onClick={() => applyEditorCommand("insertUnorderedList")}
                className="p-2 rounded-lg hover:bg-gray-100"
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
                onClick={insertTable}
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
                  className="w-full min-h-[600px] focus:outline-none leading-relaxed"
                  onInput={handleEditorInput}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
