export const PRODUCT_NAME = "Funil Metrics";

export const initialRoles = [
  "owner",
  "administrator",
  "editor",
  "analyst",
  "viewer",
] as const;

export type InitialRole = (typeof initialRoles)[number];

export const creativeStatuses = [
  "new",
  "imported",
  "analyzing",
  "awaiting_approval",
  "approved",
  "ready_to_publish",
  "published",
  "paused",
  "winner",
  "fatigued",
  "archived",
] as const;

export type CreativeStatus = (typeof creativeStatuses)[number];

export const driveImportJobStatuses = [
  "pending",
  "inventorying",
  "importing",
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled",
] as const;

export type DriveImportJobStatus = (typeof driveImportJobStatuses)[number];

export const malwareScanStatuses = [
  "pending",
  "scanning",
  "clean",
  "infected",
  "unsupported",
  "failed_retryable",
  "failed_terminal",
] as const;

export type MalwareScanStatus = (typeof malwareScanStatuses)[number];

export const CREATIVE_MEDIA_POLICY_V1={
  version:"creative_media_import_v1",
  execution:{
    maxFiles:1_000,
    maxBytes:20*1024**3,
  },
  formats:{
    "image/jpeg":{outputMime:"image/jpeg",maxBytes:50*1024**2},
    "image/png":{outputMime:"image/png",maxBytes:50*1024**2},
    "image/webp":{outputMime:"image/webp",maxBytes:50*1024**2},
    "image/gif":{outputMime:"image/gif",maxBytes:50*1024**2},
    "video/mp4":{outputMime:"video/mp4",maxBytes:2*1024**3},
    "video/quicktime":{outputMime:"video/quicktime",maxBytes:2*1024**3},
    "video/webm":{outputMime:"video/webm",maxBytes:2*1024**3},
    "text/plain":{outputMime:"text/plain",maxBytes:10*1024**2},
    "application/pdf":{outputMime:"application/pdf",maxBytes:50*1024**2},
    "application/vnd.google-apps.document":{
      outputMime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      maxBytes:10*1024**2,
      export:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  },
} as const;

export type CreativeMediaMime=keyof typeof CREATIVE_MEDIA_POLICY_V1.formats;
