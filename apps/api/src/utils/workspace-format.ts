/** Escapes a value for a single-quoted Drive `q` string literal. */
export function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

const PLAIN_NUMBER = /^[-+]?\d[\d,]*(\.\d+)?%?$/;

/**
 * Sheets evaluates USER_ENTERED cells starting with = + - @ as formulas. Cell text can
 * come from email bodies, so anything formula-like that is not a plain number is forced
 * to literal text with a leading apostrophe (e.g. =IMPORTXML(...) exfiltration).
 */
export function sanitizeSheetCell(value: string): string {
  if (value === "") return value;
  if (/^[=+\-@\t\r]/.test(value) && !PLAIN_NUMBER.test(value.trim())) {
    return `'${value}`;
  }
  return value;
}

export function sanitizeSheetRows(rows: string[][]): string[][] {
  return rows.map((row) => row.map((cell) => sanitizeSheetCell(cell)));
}

/** A1 sheet reference, quoted so names with spaces or apostrophes work. */
export function quoteSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

export function safeDriveFilename(name: string, fallback = "file"): string {
  const cleaned = name
    .replace(/[\\/]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return cleaned || fallback;
}
