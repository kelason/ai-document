"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import {
  Bold,
  Italic,
  Underline,
  Heading1,
  Heading2,
  Heading3,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Calendar,
  Minus,
  Table as TableIcon,
  Undo2,
  Redo2,
  Sparkles,
  Link,
  ChevronDown
} from "lucide-react";

interface ActiveUser {
  userId: string;
  name: string;
  avatar: string;
  color: string;
  cursorOffset?: number; // relative cursor coordinate x
  cursorY?: number;      // relative cursor coordinate y
}

interface EditorProps {
  documentId: string;
  initialContent: string;
  activeUser: { id: string; name: string; avatar: string; color: string };
  onContentChange: (newContent: string) => void;
  remoteUsers: ActiveUser[];
  onCursorChange: (coords: { x: number; y: number } | null) => void;
  isSimulating: boolean;
  onSimulationType?: (text: string) => void;
  readOnly?: boolean;  // if true, editor is view-only — toolbar hidden, editing disabled
  contentRevision?: number; // increments when external content (like file import) is applied
}


export default function Editor({
  documentId,
  initialContent,
  activeUser,
  onContentChange,
  remoteUsers,
  onCursorChange,
  isSimulating,
  readOnly = false,
  contentRevision,
}: EditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    h1: false,
    h2: false,
    h3: false,
    justifyLeft: false,
    justifyCenter: false,
    justifyRight: false,
    justifyFull: false,
  });

  const [selectionRange, setSelectionRange] = useState<Range | null>(null);
  const [bubbleMenuPosition, setBubbleMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [isFormatDropdownOpen, setIsFormatDropdownOpen] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);
  const prevRevisionRef = useRef(contentRevision || 0);

  // Reset initialization when document changes
  useEffect(() => {
    setHasInitialized(false);
  }, [documentId]);

  // Sync content with editor once when document details finish loading
  // or when an external change (like a file import) bumps contentRevision.
  useEffect(() => {
    const isNewRevision = contentRevision !== undefined && contentRevision !== prevRevisionRef.current;
    
    if (editorRef.current && (!hasInitialized || isNewRevision)) {
      if (!hasInitialized && !initialContent && initialContent !== "") return;
      
      editorRef.current.innerHTML = initialContent;
      setHasInitialized(true);
      
      if (isNewRevision && contentRevision !== undefined) {
        prevRevisionRef.current = contentRevision;
      }
    }
  }, [initialContent, hasInitialized, contentRevision]);

  // Execute formatting commands (toolbar buttons, keyboard shortcuts).
  // Update button active states in toolbar
  const updateToolbarState = useCallback(() => {
    if (typeof document === "undefined") return;
    
    let h1 = false, h2 = false, h3 = false;
    try {
      const blockType = document.queryCommandValue("formatBlock");
      h1 = blockType === "h1" || blockType === "H1";
      h2 = blockType === "h2" || blockType === "H2";
      h3 = blockType === "h3" || blockType === "H3";
    } catch (e) {}

    setActiveFormats({
      bold:          document.queryCommandState("bold"),
      italic:        document.queryCommandState("italic"),
      underline:     document.queryCommandState("underline"),
      h1, h2, h3,
      justifyLeft:   document.queryCommandState("justifyLeft"),
      justifyCenter: document.queryCommandState("justifyCenter"),
      justifyRight:  document.queryCommandState("justifyRight"),
      justifyFull:   document.queryCommandState("justifyFull"),
    });
  }, []);

  // Fire when content is edited — called ONLY from the native onInput event.
  // Do NOT call from keyUp; onInput already fires on every DOM mutation and
  // calling it a second time on keyUp causes a double state-flush that races
  // with the native cursor position, resetting it to offset 0.
  const handleEditorInput = useCallback(() => {
    if (editorRef.current) {
      onContentChange(editorRef.current.innerHTML);
    }
  }, [onContentChange]);

  // Execute formatting commands (toolbar buttons).
  // It IS correct to call handleEditorInput here — toolbar actions are explicit
  // user mutations, not rapid keystrokes.
  const executeCommand = useCallback((command: string, value: string = "") => {
    document.execCommand(command, false, value);
    updateToolbarState();
    handleEditorInput();
  }, [updateToolbarState, handleEditorInput]);

  // Check selection to position floating bubble menu
  const handleSelectionChange = useCallback(() => {
    if (typeof window === "undefined" || !editorRef.current || !containerRef.current) return;
    const selection = window.getSelection();

    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      setBubbleMenuPosition(null);
      setSelectionRange(null);
      onCursorChange(null);
      return;
    }

    const range = selection.getRangeAt(0);
    setSelectionRange(range.cloneRange());

    const rangeRect     = range.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    const caretX = rangeRect.right - containerRect.left;
    const caretY = rangeRect.top   - containerRect.top + editorRef.current.scrollTop;

    onCursorChange({ x: caretX, y: caretY });

    const bubbleTop  = rangeRect.top  - containerRect.top - 48 + editorRef.current.scrollTop;
    const bubbleLeft = rangeRect.left - containerRect.left + rangeRect.width / 2;

    setBubbleMenuPosition({
      top:  bubbleTop > 0 ? bubbleTop : 10,
      left: Math.max(100, Math.min(bubbleLeft, containerRect.width - 150)),
    });

    updateToolbarState();
  }, [onCursorChange, updateToolbarState]);

  // Handle caret positioning when editor is clicked or cursor moves.
  // Deliberately does NOT call handleEditorInput — that's onInput's job.
  const handleEditorClickOrKeyUp = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    handleSelectionChange();
    if (e.type === "keyup") {
      updateToolbarState();
      // Do NOT call handleEditorInput here — double flush resets cursor to 0.
    }
  }, [handleSelectionChange, updateToolbarState]);

  // Intercept Paste events to only paste plain text or format cleanly
  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    handleEditorInput();
  };

  // Broadcast local edits using BroadcastChannel for immediate multi-tab sync
  useEffect(() => {
    const channel = new BroadcastChannel(`doc-sync-${documentId}`);
    
    const handleChannelMessage = (event: MessageEvent) => {
      const { type, content, sender } = event.data;
      if (sender !== activeUser.id) {
        if (type === "content-update" && editorRef.current && editorRef.current.innerHTML !== content) {
          // Store selection before update
          const selection = window.getSelection();
          let range: Range | null = null;
          if (selection && selection.rangeCount > 0) {
            range = selection.getRangeAt(0).cloneRange();
          }

          editorRef.current.innerHTML = content;

          // Restore selection if possible
          if (range && selection) {
            try {
              selection.removeAllRanges();
              selection.addRange(range);
            } catch (e) {}
          }
        }
      }
    };

    channel.addEventListener("message", handleChannelMessage);

    return () => {
      channel.removeEventListener("message", handleChannelMessage);
      channel.close();
    };
  }, [documentId, activeUser.id]);

  // Insert helper widgets
  const insertDivider = () => {
    executeCommand("insertHorizontalRule");
  };

  const insertCurrentDate = () => {
    const formatted = new Date().toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    executeCommand("insertText", formatted);
  };

  const insertTable = () => {
    const tableHTML = `
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <thead>
          <tr>
            <th style="border: 1px solid var(--border-color); padding: 8px; background: rgba(0,0,0,0.02);">Header 1</th>
            <th style="border: 1px solid var(--border-color); padding: 8px; background: rgba(0,0,0,0.02);">Header 2</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border: 1px solid var(--border-color); padding: 8px;">Cell 1</td>
            <td style="border: 1px solid var(--border-color); padding: 8px;">Cell 2</td>
          </tr>
          <tr>
            <td style="border: 1px solid var(--border-color); padding: 8px;">Cell 3</td>
            <td style="border: 1px solid var(--border-color); padding: 8px;">Cell 4</td>
          </tr>
        </tbody>
      </table>
      <p></p>
    `;
    
    // Insert HTML cleanly
    if (editorRef.current) {
      editorRef.current.focus();
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const el = document.createElement("div");
        el.innerHTML = tableHTML.trim();
        const frag = document.createDocumentFragment();
        let node;
        while ((node = el.firstChild)) {
          frag.appendChild(node);
        }
        range.insertNode(frag);
        // Move selection cursor right after the table
        range.collapse(false);
      } else {
        editorRef.current.innerHTML += tableHTML;
      }
      handleEditorInput();
    }
  };

  return (
    <div ref={containerRef} className="relative flex flex-col w-full h-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
      

      {/* Rich Editor Toolbar — hidden for view-only users */}
      {!readOnly && (
      <div className="flex flex-wrap items-center gap-1 p-2 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 select-none">
        
        {/* Undo/Redo */}
        <button
          onClick={() => executeCommand("undo")}
          title="Undo"
          className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-600 dark:text-zinc-300 transition-colors"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={() => executeCommand("redo")}
          title="Redo"
          className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-600 dark:text-zinc-300 transition-colors"
        >
          <Redo2 size={16} />
        </button>

        <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-800 mx-1" />

        {/* Headings / Style Select Dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsFormatDropdownOpen(!isFormatDropdownOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-sm font-medium text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            <span>
              {activeFormats.h1
                ? "Heading 1"
                : activeFormats.h2
                ? "Heading 2"
                : activeFormats.h3
                ? "Heading 3"
                : "Normal Text"}
            </span>
            <ChevronDown size={14} />
          </button>
          
          {isFormatDropdownOpen && (
            <div className="absolute left-0 mt-1.5 w-40 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg z-50 py-1 font-sans">
              <button
                onClick={() => {
                  executeCommand("formatBlock", "<p>");
                  setIsFormatDropdownOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
              >
                Normal Text
              </button>
              <button
                onClick={() => {
                  executeCommand("formatBlock", "<h1>");
                  setIsFormatDropdownOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-lg font-bold hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              >
                Heading 1
              </button>
              <button
                onClick={() => {
                  executeCommand("formatBlock", "<h2>");
                  setIsFormatDropdownOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-md font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              >
                Heading 2
              </button>
              <button
                onClick={() => {
                  executeCommand("formatBlock", "<h3>");
                  setIsFormatDropdownOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              >
                Heading 3
              </button>
            </div>
          )}
        </div>

        <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-800 mx-1" />

        {/* Formatting actions */}
        <button
          onClick={() => executeCommand("bold")}
          title="Bold"
          className={`p-2 rounded-lg transition-colors ${
            activeFormats.bold
              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
          }`}
        >
          <Bold size={16} />
        </button>
        <button
          onClick={() => executeCommand("italic")}
          title="Italic"
          className={`p-2 rounded-lg transition-colors ${
            activeFormats.italic
              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
          }`}
        >
          <Italic size={16} />
        </button>
        <button
          onClick={() => executeCommand("underline")}
          title="Underline"
          className={`p-2 rounded-lg transition-colors ${
            activeFormats.underline
              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
          }`}
        >
          <Underline size={16} />
        </button>

        <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-800 mx-1" />

        {/* Alignments */}
        <button
          onClick={() => executeCommand("justifyLeft")}
          title="Align Left"
          className={`p-2 rounded-lg transition-colors ${
            activeFormats.justifyLeft
              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
          }`}
        >
          <AlignLeft size={16} />
        </button>
        <button
          onClick={() => executeCommand("justifyCenter")}
          title="Align Center"
          className={`p-2 rounded-lg transition-colors ${
            activeFormats.justifyCenter
              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
          }`}
        >
          <AlignCenter size={16} />
        </button>
        <button
          onClick={() => executeCommand("justifyRight")}
          title="Align Right"
          className={`p-2 rounded-lg transition-colors ${
            activeFormats.justifyRight
              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
          }`}
        >
          <AlignRight size={16} />
        </button>
        <button
          onClick={() => executeCommand("justifyFull")}
          title="Justify"
          className={`p-2 rounded-lg transition-colors ${
            activeFormats.justifyFull
              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
          }`}
        >
          <AlignJustify size={16} />
        </button>

        <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-800 mx-1" />

        {/* Lists */}
        <button
          onClick={() => executeCommand("insertUnorderedList")}
          title="Bulleted List"
          className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-600 dark:text-zinc-300 transition-colors"
        >
          <List size={16} />
        </button>
        <button
          onClick={() => executeCommand("insertOrderedList")}
          title="Numbered List"
          className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-600 dark:text-zinc-300 transition-colors"
        >
          <ListOrdered size={16} />
        </button>

        <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-800 mx-1" />

        {/* Inserts */}
        <button
          onClick={insertCurrentDate}
          title="Insert Date"
          className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-600 dark:text-zinc-300 transition-colors"
        >
          <Calendar size={16} />
        </button>
        <button
          onClick={insertDivider}
          title="Insert Divider"
          className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-600 dark:text-zinc-300 transition-colors"
        >
          <Minus size={16} />
        </button>
        <button
          onClick={insertTable}
          title="Insert Table"
          className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-600 dark:text-zinc-300 transition-colors"
        >
          <TableIcon size={16} />
        </button>

        {isSimulating && (
          <>
            <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-800 mx-1" />
            <div className="flex items-center gap-1 px-2.5 py-1 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg text-amber-700 dark:text-amber-300 text-xs font-semibold animate-pulse select-none">
              <Sparkles size={12} className="shrink-0" />
              <span>Bob typing...</span>
            </div>
          </>
        )}
      </div>
      )}{/* end toolbar conditional */}

      {/* Editor Body */}
      <div className="flex-1 overflow-y-auto px-4 py-8 md:px-12 flex justify-center">
        <div className="relative w-full max-w-3xl">
          
          {/* Presence Carets Overlay */}
          {remoteUsers.map((user) => {
            if (user.cursorOffset === undefined || user.cursorY === undefined) return null;
            return (
              <div
                key={user.userId}
                className="remote-cursor transition-all duration-300 ease-out"
                style={{
                  left: `${user.cursorOffset}px`,
                  top: `${user.cursorY}px`,
                  backgroundColor: user.color,
                }}
              >
                <div
                  className="remote-cursor-flag"
                  style={{
                    position: "absolute",
                    top: "-1.5rem",
                    left: "-2px",
                    backgroundColor: user.color,
                    color: "#ffffff",
                    fontSize: "10px",
                    fontWeight: "bold",
                    padding: "1px 6px",
                    borderRadius: "3px",
                    whiteSpace: "nowrap",
                    zIndex: 20,
                    boxShadow: "0 2px 4px rgba(0,0,0,0.15)"
                  }}
                >
                  {user.name}
                </div>
              </div>
            );
          })}

          {/* Editable Document Page (styled as a paper layout) */}
          <div
            ref={editorRef}
            contentEditable={!readOnly}
            suppressContentEditableWarning
            onInput={readOnly ? undefined : handleEditorInput}
            onPaste={readOnly ? undefined : handlePaste}
            onSelect={handleSelectionChange}
            onKeyUp={readOnly ? undefined : handleEditorClickOrKeyUp}
            onMouseDown={readOnly ? undefined : handleEditorClickOrKeyUp}
            className={`prose-editor doc-page-container w-full px-12 py-16 shadow-lg rounded-lg border border-zinc-200/80 bg-white text-zinc-900 focus:outline-none dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-800 ${
              readOnly
                ? "cursor-default select-text opacity-90 bg-zinc-50/80 dark:bg-zinc-900/60"
                : ""
            }`}
            role={readOnly ? "document" : "textbox"}
            aria-multiline={readOnly ? undefined : true}
            aria-readonly={readOnly}
          />

          {/* Selection Bubble Menu */}
          {bubbleMenuPosition && selectionRange && (
            <div
              className="absolute flex items-center gap-0.5 p-1 bg-zinc-900/90 dark:bg-zinc-800/95 backdrop-blur border border-zinc-800 rounded-lg shadow-xl z-50"
              style={{
                top: `${bubbleMenuPosition.top}px`,
                left: `${bubbleMenuPosition.left}px`,
                transform: "translateX(-50%)",
              }}
            >
              <button
                onClick={() => executeCommand("bold")}
                className="p-1.5 hover:bg-zinc-800 dark:hover:bg-zinc-700 rounded text-white transition-colors"
                title="Bold"
              >
                <Bold size={14} />
              </button>
              <button
                onClick={() => executeCommand("italic")}
                className="p-1.5 hover:bg-zinc-800 dark:hover:bg-zinc-700 rounded text-white transition-colors"
                title="Italic"
              >
                <Italic size={14} />
              </button>
              <button
                onClick={() => executeCommand("underline")}
                className="p-1.5 hover:bg-zinc-800 dark:hover:bg-zinc-700 rounded text-white transition-colors"
                title="Underline"
              >
                <Underline size={14} />
              </button>
              <div className="w-px h-4 bg-zinc-800 dark:bg-zinc-700 mx-1" />
              <button
                onClick={() => executeCommand("formatBlock", "<h1>")}
                className="px-1.5 py-0.5 text-xs hover:bg-zinc-800 dark:hover:bg-zinc-700 rounded text-white font-bold"
              >
                H1
              </button>
              <button
                onClick={() => executeCommand("formatBlock", "<h2>")}
                className="px-1.5 py-0.5 text-xs hover:bg-zinc-800 dark:hover:bg-zinc-700 rounded text-white font-bold"
              >
                H2
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
