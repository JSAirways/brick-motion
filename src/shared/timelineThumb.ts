/**
 * On-disk timeline strip JPEG max long edge. Keep in sync with UI: `.bm-thumb` is 140px wide
 * in `main.scss`; 160px gives modest headroom for HiDPI without decoding full preview-jpeg per cell.
 */
export const TIMELINE_THUMB_MAX_LONG_EDGE_PX = 160;

/** JPEG quality for on-disk timeline strip files (WIC / Electron nativeImage). */
export const TIMELINE_THUMB_JPEG_QUALITY = 78;
