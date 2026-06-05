export const getTrimmedString = (formData: FormData, key: string, fallback = ""): string =>
  String(formData.get(key) ?? fallback).trim();

export const getClampedNumber = (
  formData: FormData,
  key: string,
  options: { min: number; max: number; fallback: number }
): number => {
  const raw = Number(formData.get(key) ?? options.fallback);
  if (!Number.isFinite(raw)) {
    return options.fallback;
  }
  return Math.max(options.min, Math.min(options.max, raw));
};
