/**
 * Fixed max long edge (px) for native live preview JPEG frames (`camera:preview`).
 * Not stored in project files — avoids extra UI and keeps encode cost predictable.
 */
export const LIVE_PREVIEW_MAX_LONG_EDGE_PX = 960;

/**
 * Fixed max long edge (px) for on-disk captured preview JPEG frames (`frames/preview-jpeg`).
 * Kept separate from the live preview cap to avoid hidden coupling if tuned later.
 */
/**
 * On-disk capture preview (`frames/preview-jpeg`). Source JPEG/PNG uses the native
 * stream resolution negotiated at open (not capped here).
 */
export const CAPTURE_PREVIEW_MAX_LONG_EDGE_PX = 960;
