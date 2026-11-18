export type ImportError = { row: number; message: string; data?: Record<string, unknown> };

export function readImportErrors(value: unknown): ImportError[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || typeof entry.row !== 'number' || typeof entry.message !== 'string') return [];
    return [{ row: entry.row, message: entry.message, ...(entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data) ? { data: entry.data } : {}) }];
  });
}

export function rejectedRowsCsv(errors: ImportError[]) {
  const metadata = ['linha_original', 'motivo_erro'];
  const keys = [...new Set(errors.flatMap(error => Object.keys(error.data || {})))].filter(key => !metadata.includes(key));
  const columns = [...keys, ...metadata];
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    // User-supplied cells and headers must not execute formulas in Excel.
    if (typeof value !== 'number' && /^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [columns.map(cell).join(';'), ...errors.map(error => [...keys.map(key => error.data?.[key]), error.row, error.message].map(cell).join(';'))].join('\r\n') + '\r\n';
}
