"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/components/spinner";
import { FULFILMENT_MODES, FULFILMENT_MODE_LABEL, type FulfilmentMode } from "@/lib/sourcing/stages";
import { IMPORT_CHUNK_SIZE, MAX_IMPORT_ROWS } from "@/lib/sourcing/import-constants";
import { dedupeRows, parseSheet, type SourcingImportRow } from "@/lib/sourcing/import-parse";
import { classifySourcingHandles, importSourcingRows, type ClassifiedHandle } from "./import-actions";

// Bulk create — a whole sheet of creators onto the sourcing list at once.
//
// The workbook is parsed in the BROWSER, every sheet of it, and only
// normalised rows cross to the server. That is what makes the preview
// instant and keeps a 300-row file off the wire.
//
// Then the one thing that matters: the preview splits the sheet three ways
// before anything is written.
//
//   on this campaign already — nothing to do
//   in our creator database  — a booking each, linked to the record we hold
//   new to us                — importing them CREATES an invitation, so the
//                              admin ticks a box for it; it is the only
//                              group whose import writes outside the campaign
//
// Subcomponents are at module scope, never nested: a component defined
// inside one that owns state gets a new identity every render, which
// remounts the children and loses focus (see CLAUDE.md).

type Group = "sourced" | "known" | "new";

const GROUP_META: Record<Group, { label: string; blurb: string; tone: string }> = {
  sourced: {
    label: "Already on this campaign",
    blurb: "Skipped — they're on the sourcing list already.",
    tone: "border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900",
  },
  known: {
    label: "In our creator database",
    blurb: "Imported and linked to the account or invitation we already hold.",
    tone: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30",
  },
  new: {
    label: "New to us",
    blurb: "We've never heard of them. Importing them adds them to the creator database.",
    tone: "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30",
  },
};

const STAGE_NOTE: Record<string, string> = {
  shortlisted: "shortlisted",
  price_agreed: "price agreed",
  confirmed: "confirmed",
  declined: "declined",
};

type Parsed = {
  fileName: string;
  rows: SourcingImportRow[];
  duplicates: SourcingImportRow[];
  sheets: { sheet: string; count: number; unmapped: string[] }[];
};

function GroupCard({
  group,
  rows,
  classified,
}: {
  group: Group;
  rows: SourcingImportRow[];
  classified: Map<string, ClassifiedHandle>;
}) {
  const meta = GROUP_META[group];
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, 6);
  return (
    <div className={`rounded-xl border p-3 ${meta.tone}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">
          {meta.label} <span className="font-black">({rows.length})</span>
        </h4>
      </div>
      <p className="mt-0.5 text-[11px] text-gray-600 dark:text-gray-400">{meta.blurb}</p>
      <ul className="mt-2 space-y-1">
        {shown.map((r) => (
          <li key={`${r.sheet}-${r.line}-${r.handle}`} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
            <span className="font-semibold text-gray-900 dark:text-gray-100">@{r.handle}</span>
            <span className="text-gray-500">{r.name || classified.get(r.handle)?.knownName || ""}</span>
            {r.followers ? <span className="text-gray-400">{r.followers.toLocaleString("en-IN")} followers</span> : null}
            {r.agreedFee ? <span className="text-gray-400">₹{r.agreedFee.toLocaleString("en-IN")}</span> : null}
            {r.stage !== "shortlisted" && (
              <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-black/30 dark:text-gray-300">
                {STAGE_NOTE[r.stage]}
              </span>
            )}
            <span className="text-[10px] text-gray-400">
              {r.sheet} · row {r.line}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > 6 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400 cursor-pointer"
        >
          {expanded ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

export function BulkCreateButton({
  campaignId,
  defaultMode = "reimburse",
}: {
  campaignId: string;
  defaultMode?: FulfilmentMode;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parseError, setParseError] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [classified, setClassified] = useState<Map<string, ClassifiedHandle> | null>(null);
  const [createNew, setCreateNew] = useState(true);
  const [mode, setMode] = useState<FulfilmentMode>(defaultMode);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{
    added: number;
    skippedSourced: number;
    skippedNew: number;
    invitationsCreated: number;
    failed: { handle: string; reason: string }[];
  } | null>(null);

  const reset = () => {
    setParsed(null);
    setClassified(null);
    setParseError("");
    setResult(null);
    setProgress("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const parseFile = async (file: File) => {
    reset();
    if (!/\.xlsx$/i.test(file.name)) {
      setParseError("Upload an .xlsx file.");
      return;
    }
    setClassifying(true);
    try {
      // Dynamic import: xlsx is large and nobody who never opens this panel
      // should pay for it.
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });

      // EVERY sheet, not just the first. The workbooks we get are split by
      // tier — Nano, Micro, Macro, Celebrity — with different columns on
      // each, and reading only sheet one silently drops most of the list.
      const all: SourcingImportRow[] = [];
      const sheets: Parsed["sheets"] = [];
      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        if (!ws) continue;
        const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        if (!records.length) continue;
        const headers = (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false })[0] || []).map((h) =>
          String(h ?? ""),
        );
        const { rows, unmapped } = parseSheet(name, records, headers);
        if (rows.length === 0) continue;
        all.push(...rows);
        sheets.push({ sheet: name, count: rows.length, unmapped });
      }

      if (all.length === 0) {
        setParseError("No rows with an Instagram handle in that file. Check the handle column's heading.");
        setClassifying(false);
        return;
      }
      if (all.length > MAX_IMPORT_ROWS) {
        setParseError(`That's ${all.length.toLocaleString()} rows — split the file into batches of ${MAX_IMPORT_ROWS.toLocaleString()}.`);
        setClassifying(false);
        return;
      }

      const { rows, duplicates } = dedupeRows(all);
      setParsed({ fileName: file.name, rows, duplicates, sheets });

      // Classify against the database. Chunked, because 300 handles is 6
      // OR-queries' worth and the URL has a length limit.
      const map = new Map<string, ClassifiedHandle>();
      for (let i = 0; i < rows.length; i += 300) {
        const slice = rows.slice(i, i + 300).map((r) => r.handle);
        const res = await classifySourcingHandles(campaignId, slice);
        if (res.error) {
          setParseError(res.error);
          setClassifying(false);
          return;
        }
        for (const c of res.classified || []) map.set(c.handle, c);
      }
      setClassified(map);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setClassifying(false);
    }
  };

  const grouped: Record<Group, SourcingImportRow[]> = { sourced: [], known: [], new: [] };
  if (parsed && classified) {
    for (const r of parsed.rows) {
      const kind = classified.get(r.handle)?.kind;
      if (kind === "sourced") grouped.sourced.push(r);
      else if (kind === "registered" || kind === "invited") grouped.known.push(r);
      else grouped.new.push(r);
    }
  }
  const willImport = grouped.known.length + (createNew ? grouped.new.length : 0);
  const warnings = (parsed?.rows || []).filter((r) => r.warnings.length);

  const runImport = async () => {
    if (!parsed || !classified) return;
    setBusy(true);
    setResult(null);
    const toSend = parsed.rows.filter((r) => {
      const kind = classified.get(r.handle)?.kind;
      if (kind === "sourced") return false;
      if (kind === "new") return createNew;
      return true;
    });

    const totals = { added: 0, skippedSourced: 0, skippedNew: 0, invitationsCreated: 0 };
    const failed: { handle: string; reason: string }[] = [];
    let fatal = "";

    for (let i = 0; i < toSend.length; i += IMPORT_CHUNK_SIZE) {
      const chunk = toSend.slice(i, i + IMPORT_CHUNK_SIZE);
      setProgress(`Importing ${Math.min(i + chunk.length, toSend.length)} of ${toSend.length}…`);
      try {
        const res = await importSourcingRows(
          campaignId,
          chunk.map((r) => ({
            handle: r.handle,
            name: r.name,
            email: r.email,
            phone: r.phone,
            address: r.address,
            tier: r.tier,
            category: r.category,
            followers: r.followers,
            quotedFee: r.quotedFee,
            agreedFee: r.agreedFee,
            productCost: r.productCost,
            notes: r.notes,
            stage: r.stage,
          })),
          { createNew, fulfilmentMode: mode },
        );
        if (res.error) {
          // Partial progress is kept and reported — losing the count of
          // what already landed would mean re-importing it.
          fatal = res.error;
          break;
        }
        totals.added += res.added || 0;
        totals.skippedSourced += res.skippedSourced || 0;
        totals.skippedNew += res.skippedNew || 0;
        totals.invitationsCreated += res.invitationsCreated || 0;
        if (res.failed?.length) failed.push(...res.failed);
      } catch (e) {
        fatal = e instanceof Error ? e.message : "The import stopped partway.";
        break;
      }
    }

    // Rows never sent, because the admin left the box unticked.
    if (!createNew) totals.skippedNew += grouped.new.length;
    totals.skippedSourced += grouped.sourced.length;

    setBusy(false);
    setProgress("");
    setResult({ ...totals, failed });
    if (fatal) setParseError(fatal);
    router.refresh();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 cursor-pointer"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5-5 5 5M12 5v10"
          />
        </svg>
        Bulk create
      </button>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Bulk create from a sheet</h2>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="text-[12px] font-semibold text-gray-500 hover:underline cursor-pointer"
        >
          Close
        </button>
      </div>

      {!parsed && (
        <>
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            Drop the workbook you already keep this list in — every sheet is read, and the sheet name becomes the tier.
            Handles can be bare or full profile URLs; &quot;15.9k&quot; and &quot;10k&quot; are understood.
          </p>
          <div className="mt-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void parseFile(f);
              }}
              className="block w-full cursor-pointer rounded-lg border border-dashed border-gray-300 px-3 py-6 text-[13px] text-gray-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-white dark:border-gray-700 dark:text-gray-300"
            />
          </div>
          <p className="mt-2 text-[11px] text-gray-400">
            Columns it looks for: name, Instagram handle, category, followers, approval status, pricing, negotiated
            pricing, product cost, contact number, email, address, confirmation mail, notes. Missing ones are fine.
          </p>
        </>
      )}

      {classifying && (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-gray-500">
          <ButtonSpinner /> Reading the file and checking each handle against our database…
        </p>
      )}

      {parsed && classified && !result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{parsed.fileName}</span>
            <span className="text-[12px] text-gray-500">
              {parsed.rows.length} creator{parsed.rows.length === 1 ? "" : "s"} across{" "}
              {parsed.sheets.length} sheet{parsed.sheets.length === 1 ? "" : "s"}
              {parsed.sheets.length > 1 && ` (${parsed.sheets.map((s) => `${s.sheet} ${s.count}`).join(", ")})`}
            </span>
            <button
              type="button"
              onClick={reset}
              className="text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400 cursor-pointer"
            >
              Choose a different file
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <GroupCard group="known" rows={grouped.known} classified={classified} />
            <GroupCard group="new" rows={grouped.new} classified={classified} />
            <GroupCard group="sourced" rows={grouped.sourced} classified={classified} />
          </div>

          {grouped.new.length > 0 && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <input
                type="checkbox"
                checked={createNew}
                onChange={(e) => setCreateNew(e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-indigo-600"
              />
              <span className="text-[12px] text-gray-800 dark:text-gray-200">
                <span className="font-semibold">
                  Add the {grouped.new.length} new creator{grouped.new.length === 1 ? "" : "s"} to the creator database
                </span>
                <br />
                <span className="text-gray-600 dark:text-gray-400">
                  They&apos;re filed as invited influencers, so they show up under Influencers → Invited and can be
                  enriched and emailed like any other invitation. Untick and they&apos;re left out of this import
                  entirely.
                </span>
              </span>
            </label>
          )}

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              How does the product reach them?
            </p>
            <div className="flex flex-wrap gap-2">
              {FULFILMENT_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold cursor-pointer ${
                    mode === m
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-gray-300 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300"
                  }`}
                >
                  {FULFILMENT_MODE_LABEL[m]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-gray-400">
              Applied to every creator in this import. Editable per creator afterwards.
            </p>
          </div>

          {(parsed.duplicates.length > 0 || warnings.length > 0 || parsed.sheets.some((s) => s.unmapped.length)) && (
            <details className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              <summary className="cursor-pointer text-[12px] font-semibold text-gray-700 dark:text-gray-300">
                {parsed.duplicates.length + warnings.length} thing
                {parsed.duplicates.length + warnings.length === 1 ? "" : "s"} worth a look
              </summary>
              <div className="mt-2 space-y-2 text-[11px] text-gray-600 dark:text-gray-400">
                {parsed.duplicates.length > 0 && (
                  <p>
                    <span className="font-semibold">{parsed.duplicates.length} duplicate handle(s)</span> collapsed —
                    the row carrying more detail was kept:{" "}
                    {parsed.duplicates.map((d) => `@${d.handle} (${d.sheet} row ${d.line})`).join(", ")}
                  </p>
                )}
                {warnings.map((r) => (
                  <p key={`${r.sheet}-${r.line}-w`}>
                    <span className="font-semibold">@{r.handle}</span> — {r.warnings.join("; ")}
                  </p>
                ))}
                {parsed.sheets
                  .filter((s) => s.unmapped.length)
                  .map((s) => (
                    <p key={`${s.sheet}-u`}>
                      <span className="font-semibold">{s.sheet}</span>: ignored column
                      {s.unmapped.length === 1 ? "" : "s"} {s.unmapped.map((u) => `"${u}"`).join(", ")}
                    </p>
                  ))}
              </div>
            </details>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runImport}
              disabled={busy || willImport === 0}
              aria-busy={busy}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-[13px] font-semibold text-white hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60 cursor-pointer"
            >
              {busy && <ButtonSpinner />}
              {busy ? "Importing…" : willImport === 0 ? "Nothing to import" : `Import ${willImport} creator${willImport === 1 ? "" : "s"}`}
            </button>
            {progress && <span className="text-[12px] text-gray-500">{progress}</span>}
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">
            {result.added} creator{result.added === 1 ? "" : "s"} added to the sourcing list
            {result.invitationsCreated > 0 &&
              `, ${result.invitationsCreated} new to the creator database`}
            .
          </p>
          <ul className="space-y-0.5 text-[12px] text-gray-600 dark:text-gray-400">
            {result.skippedSourced > 0 && <li>{result.skippedSourced} were already on this campaign.</li>}
            {result.skippedNew > 0 && (
              <li>{result.skippedNew} new creator(s) left out — the box above was unticked.</li>
            )}
          </ul>
          {result.failed.length > 0 && (
            <details open className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900 dark:bg-rose-950/30">
              <summary className="cursor-pointer text-[12px] font-semibold text-rose-800 dark:text-rose-300">
                {result.failed.length} couldn&apos;t be added
              </summary>
              <ul className="mt-1.5 space-y-0.5 text-[11px] text-rose-800 dark:text-rose-300">
                {result.failed.map((f) => (
                  <li key={f.handle}>
                    <span className="font-semibold">@{f.handle}</span> — {f.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button
            type="button"
            onClick={reset}
            className="text-[12px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400 cursor-pointer"
          >
            Import another sheet
          </button>
        </div>
      )}

      {parseError && <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{parseError}</p>}
    </div>
  );
}
