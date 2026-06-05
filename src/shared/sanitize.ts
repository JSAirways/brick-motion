const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;

const sanitizeFileNamePart = (value: string): string =>
  value.replace(INVALID_FILE_NAME_CHARS, "_").replace(/[. ]+$/g, "").trim();

export const sanitizeExportPrefix = (value: string): string => sanitizeFileNamePart(value);
