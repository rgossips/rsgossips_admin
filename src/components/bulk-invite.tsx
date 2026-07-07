"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { ButtonSpinner, FullPageLoader } from "@/components/spinner";

type Row = Record<string, string>;
type BulkResult = { success: number; failed: Array<{ row: number; reason: string; data: Record<string, unknown> }>; error?: string };

interface BulkInviteProps {
  type: "influencer" | "brand";
  templateColumns: { key: string; label: string; required?: boolean; example?: string; helper?: string }[];
  // Processes one chunk. `startRow` is the spreadsheet row number of
  // rows[0] so failure messages can point at the right line.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSubmit: (rows: any[], startRow: number) => Promise<any>;
}

// Rows per server call. Keeps each invocation well under the serverless
// timeout regardless of how large the uploaded file is; the client loops
// chunks and aggregates. Tuned so a chunk's bulk existence check + batch
// insert stays fast.
const CHUNK_SIZE = 200;
// Upper bound on a single file. Parsing is synchronous on the main thread,
// so a huge sheet would freeze the tab before chunking ever helps — cap it
// and tell the admin to split the file.
const MAX_ROWS = 5000;

export function BulkInvite({ type, templateColumns, onSubmit }: BulkInviteProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [parsedRows, setParsedRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);

  const downloadTemplate = () => {
    // Build template rows: headers + 1 example row
    const headers = templateColumns.map((c) => c.label);
    const exampleRow = templateColumns.map((c) => c.example || "");
    const helperRow = templateColumns.map((c) => c.helper || (c.required ? "Required" : "Optional"));

    const ws = XLSX.utils.aoa_to_sheet([headers, helperRow, exampleRow]);
    // Column widths
    ws["!cols"] = templateColumns.map(() => ({ wch: 25 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, type === "influencer" ? "Influencers" : "Brands");
    XLSX.writeFile(wb, `${type}_bulk_invite_template.xlsx`);
  };

  const parseFile = (file: File) => {
    setParseError("");
    setResult(null);
    if (!file.name.endsWith(".xlsx")) {
      setParseError("Only .xlsx files are allowed.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

        if (rawRows.length === 0) {
          setParseError("Sheet is empty. Use the template and add at least one row.");
          return;
        }

        // Map header labels to column keys
        const labelToKey: Record<string, string> = {};
        for (const col of templateColumns) labelToKey[col.label] = col.key;

        // Build a set of known helper strings from the template columns to detect & skip the helper row
        const knownHelpers = new Set(templateColumns.map((c) => c.helper).filter(Boolean) as string[]);

        const isHelperRow = (obj: Row) => {
          const values = Object.values(obj).filter((v) => v !== "");
          if (values.length === 0) return false;
          // Helper row: every non-empty value either matches a known helper string,
          // or starts with "Required" / "Optional"
          return values.every((v) => knownHelpers.has(v) || /^(Required|Optional)\b/i.test(v));
        };

        // Filter out helper row(s) and empty rows
        const mapped: Row[] = [];
        for (const raw of rawRows) {
          const obj: Row = {};
          for (const [label, val] of Object.entries(raw)) {
            const key = labelToKey[label];
            if (key) obj[key] = String(val ?? "").trim();
          }
          if (isHelperRow(obj)) continue;
          if (Object.values(obj).every((v) => !v)) continue;
          mapped.push(obj);
        }

        if (mapped.length === 0) {
          setParseError("No data rows found. Make sure you've added rows below the header.");
          return;
        }
        if (mapped.length > MAX_ROWS) {
          setParseError(`Too many rows (${mapped.length.toLocaleString()}). Split the file into batches of ${MAX_ROWS.toLocaleString()} or fewer and upload them separately.`);
          return;
        }

        setParsedRows(mapped);
        setFileName(file.name);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Failed to parse file");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSubmit = async () => {
    if (parsedRows.length === 0) return;
    setLoading(true);
    const noun = type === "influencer" ? "influencers" : "brands";
    // Hoisted out of try so the catch can still report/keep partial progress
    // if a chunk call rejects mid-run (network/timeout).
    const aggregate: BulkResult = { success: 0, failed: [] };
    try {
      // Send the file in chunks so a large upload never trips the
      // serverless timeout. Results are aggregated across chunks; a
      // chunk that fails outright (network/auth) stops the run and
      // surfaces the error, but per-row failures inside a chunk are just
      // collected and shown at the end.
      const total = parsedRows.length;
      for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
        const chunk = parsedRows.slice(offset, offset + CHUNK_SIZE);
        // +2: row 1 is the header in the spreadsheet, so data starts at 2.
        const startRow = offset + 2;
        setLoadingMsg(`Importing ${Math.min(offset + chunk.length, total)} of ${total} ${noun}...`);
        const res = await onSubmit(chunk, startRow);
        if (res && "error" in res && res.error) {
          setParseError(`${res.error} (stopped after ${aggregate.success} imported)`);
          setLoading(false);
          if (aggregate.success > 0) router.refresh();
          return;
        }
        aggregate.success += (res as BulkResult).success || 0;
        if (Array.isArray((res as BulkResult).failed)) {
          aggregate.failed.push(...(res as BulkResult).failed);
        }
      }
      setResult(aggregate);
      if (aggregate.success > 0) router.refresh();
    } catch (e) {
      // A chunk threw (network/timeout). Don't lose what already imported.
      const base = e instanceof Error ? e.message : "Bulk import failed";
      setParseError(
        aggregate.success > 0
          ? `${base}. ${aggregate.success} row(s) imported before the error — re-upload only the remaining rows.`
          : base,
      );
      if (aggregate.success > 0) router.refresh();
    }
    setLoading(false);
  };

  const reset = () => {
    setOpen(false);
    setParsedRows([]);
    setFileName("");
    setParseError("");
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <>
      {loading && <FullPageLoader message={loadingMsg} />}

      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors cursor-pointer"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Bulk Invite
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" onClick={reset} />
          <div className="fixed z-50 inset-2 lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-2xl lg:max-h-[90vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Bulk Invite {type === "influencer" ? "Influencers" : "Brands"}</h2>
                <p className="text-xs text-gray-400 mt-0.5">Upload an .xlsx file to invite multiple {type === "influencer" ? "influencers" : "brands"} at once</p>
              </div>
              <button onClick={reset} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 cursor-pointer">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Step 1: Download template */}
              <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/30">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300 mb-1">Step 1 — Download the template</p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400">Use this template to make sure your data is in the right format.</p>
                  </div>
                  <button onClick={downloadTemplate} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    Download Template
                  </button>
                </div>
              </div>

              {/* Step 2: Upload */}
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Step 2 — Upload filled file</p>
                <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); }} />
                <div onClick={() => fileRef.current?.click()} className="border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500 rounded-xl p-6 text-center cursor-pointer transition-colors">
                  <svg className="w-8 h-8 mx-auto text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                  {fileName ? (
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{fileName}</p>
                      <p className="text-xs text-gray-400 mt-1">{parsedRows.length} rows parsed — click to choose another file</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Click to upload .xlsx file</p>
                      <p className="text-xs text-gray-400 mt-1">Only .xlsx files supported</p>
                    </div>
                  )}
                </div>
                {parseError && (
                  <div className="mt-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">{parseError}</div>
                )}
              </div>

              {/* Preview */}
              {parsedRows.length > 0 && !result && (
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Preview ({parsedRows.length} {parsedRows.length === 1 ? "row" : "rows"})</p>
                  <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                        <tr>
                          {templateColumns.map((c) => (
                            <th key={c.key} className="text-left px-3 py-2 font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">{c.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {parsedRows.slice(0, 10).map((row, i) => (
                          <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                            {templateColumns.map((c) => (
                              <td key={c.key} className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{row[c.key] || "—"}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parsedRows.length > 10 && <p className="text-[11px] text-gray-400 mt-1.5">Showing first 10 rows. {parsedRows.length - 10} more not shown.</p>}
                </div>
              )}

              {/* Result */}
              {result && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                      <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{result.success}</p>
                      <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider mt-1">Imported</p>
                    </div>
                    <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                      <p className="text-2xl font-bold text-red-600 dark:text-red-400">{result.failed.length}</p>
                      <p className="text-xs font-semibold text-red-700 dark:text-red-300 uppercase tracking-wider mt-1">Failed</p>
                    </div>
                  </div>
                  {result.failed.length > 0 && (
                    <div className="rounded-xl border border-red-200 dark:border-red-800 overflow-hidden max-h-40 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-red-50 dark:bg-red-900/20 sticky top-0">
                          <tr>
                            <th className="text-left px-3 py-2 font-semibold text-red-700 dark:text-red-300">Row</th>
                            <th className="text-left px-3 py-2 font-semibold text-red-700 dark:text-red-300">Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-red-100 dark:divide-red-900/40">
                          {result.failed.map((f, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2 text-red-600 dark:text-red-400 font-semibold">{f.row}</td>
                              <td className="px-3 py-2 text-red-600 dark:text-red-400">{f.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex gap-3 shrink-0">
              {result ? (
                <button onClick={reset} className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold cursor-pointer">Done</button>
              ) : (
                <>
                  <button
                    onClick={handleSubmit}
                    disabled={loading || parsedRows.length === 0}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer"
                  >
                    {loading && <ButtonSpinner />}
                    {loading ? "Importing..." : `Import ${parsedRows.length || ""} ${parsedRows.length === 1 ? "row" : "rows"}`}
                  </button>
                  <button onClick={reset} className="px-5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium cursor-pointer">
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
