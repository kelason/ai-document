// =============================================================================
// User Profiles (simulated authentication — no real login required)
// =============================================================================
export const USER_PROFILES = [
  { id: "user-1", name: "Alice Cooper",  avatar: "AC", color: "#ec4899", bg: "bg-pink-500"    },
  { id: "user-2", name: "Bob Miller",    avatar: "BM", color: "#3b82f6", bg: "bg-blue-500"    },
  { id: "user-3", name: "Charlie Davis", avatar: "CD", color: "#10b981", bg: "bg-emerald-500" },
] as const;

export type UserProfile = (typeof USER_PROFILES)[number];

// =============================================================================
// File Upload
// =============================================================================
/** Maximum allowed upload size */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_FILE_SIZE_LABEL = "5 MB";

/** Extensions the upload endpoint will accept */
export const SUPPORTED_EXTENSIONS = [".txt", ".md", ".docx"] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

/** Human-readable label for the upload accept string shown in UI */
export const SUPPORTED_EXTENSIONS_LABEL = SUPPORTED_EXTENSIONS.join(", ");

/** MIME types mapped from extension — used for server-side validation */
export const SUPPORTED_MIME_TYPES: Record<SupportedExtension, string> = {
  ".txt":  "text/plain",
  ".md":   "text/markdown",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

// =============================================================================
// Document History
// =============================================================================
/** Maximum number of stored revisions per document */
export const MAX_HISTORY_VERSIONS = 50;

/** Edits within this window (same user) are merged into one revision */
export const HISTORY_WINDOW_MS = 15_000;

// =============================================================================
// Presence / Collaboration
// =============================================================================
/** How often the client sends a heartbeat to the presence endpoint */
export const PRESENCE_HEARTBEAT_MS = 1_200;

/** Users who haven't pinged within this window are considered offline */
export const PRESENCE_EXPIRE_MS = 4_000;

// =============================================================================
// Auto-save debounce
// =============================================================================
/** Delay after last keystroke before content is persisted */
export const CONTENT_SAVE_DEBOUNCE_MS = 1_200;

/** Delay after last title keystroke before title is persisted */
export const TITLE_SAVE_DEBOUNCE_MS = 1_000;

// =============================================================================
// Co-editor simulation
// =============================================================================
/** Characters per tick when Bob types in the simulation */
export const SIM_TYPING_INTERVAL_MS = 90;

// =============================================================================
// Sharing permissions
// =============================================================================
export const SHARE_PERMISSIONS = {
  VIEW: "view",
  EDIT: "edit",
} as const;

export type SharePermission = (typeof SHARE_PERMISSIONS)[keyof typeof SHARE_PERMISSIONS];

// =============================================================================
// Document templates
// =============================================================================
export const DOCUMENT_TEMPLATES = [
  {
    id:         "blank",
    name:       "Blank Document",
    icon:       "Plus",
    colorClass: "text-zinc-500 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-400",
  },
  {
    id:         "meeting-notes",
    name:       "Meeting Notes",
    icon:       "Users",
    colorClass: "text-blue-600 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-400",
  },
  {
    id:         "project-proposal",
    name:       "Project Proposal",
    icon:       "Briefcase",
    colorClass: "text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400",
  },
  {
    id:         "software-spec",
    name:       "Software Spec",
    icon:       "Laptop",
    colorClass: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400",
  },
] as const;

// =============================================================================
// Toast display durations (ms)
// =============================================================================
export const TOAST_DURATION_SUCCESS = 3_000;
export const TOAST_DURATION_ERROR   = 5_000;
export const TOAST_DURATION_INFO    = 3_000;
export const TOAST_DURATION_WARNING = 4_000;

// =============================================================================
// API error codes
// =============================================================================
export const API_ERROR_CODES = {
  NOT_FOUND:          "NOT_FOUND",
  VALIDATION_ERROR:   "VALIDATION_ERROR",
  ALREADY_SHARED:     "ALREADY_SHARED",
  SHARE_WITH_SELF:    "SHARE_WITH_SELF",
  FILE_TOO_LARGE:     "FILE_TOO_LARGE",
  UNSUPPORTED_TYPE:   "UNSUPPORTED_TYPE",
  PARSE_FAILED:       "PARSE_FAILED",
  FORBIDDEN:          "FORBIDDEN",
  SERVER_ERROR:       "SERVER_ERROR",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];
