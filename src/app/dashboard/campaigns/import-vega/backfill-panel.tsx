"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/components/spinner";
import { BACKFILL_CHUNK_SIZE } from "@/lib/sourcing/import-constants";
import { dedupeRows, parseSheet, type SourcingImportRow } from "@/lib/sourcing/import-parse";
import {
  VEGA_SHEET_CAMPAIGNS,
  deriveVegaRow,
  parsePaymentRow,
  PROGRESS_LABEL,
  type BlankPolicy,
  type DerivedVegaRow,
  type PaymentRow,
} from "@/lib/sourcing/import-vega";
import { STAGE_LABEL, type BookingStage } from "@/lib/sourcing/stages";
import {
  previewVegaImport,
  commitVegaChunk,
  suggestHandlesByName,
  raiseCampaignCapacity,
  type HandleSuggestion,
  type VegaPreview,
  type VegaWireRow,
} from "./actions";

// The historical Vega backfill, admin side.
//
// Both workbooks are parsed in the BROWSER and only normalised rows cross
// the wire, same as bulk-create. The sheet-to-campaign map is fixed in
// import-vega.ts rather than chosen here: these are seven named campaigns
// that already exist, and a dropdown would be seven chances to put a
// creator on the wrong brief.
//
// Nothing is written until a campaign is ticked and Import is pressed, and
// each campaign is previewed against the live database first.
//
// The raw parsed rows are held in state and the DERIVATION is recomputed on
// render, because changing a sheet's blank-Progress policy changes which
// stage its rows land on — deriving once at parse time would have meant
// re-reading the file to change one dropdown.
//
// Subcomponents live at module scope, never nested inside this one — a
// component redefined on every render remounts its children and loses
// focus (see CLAUDE.md).

type ParsedSheetState = {
  sheet: string;
  campaignId: string;
  rows: SourcingImportRow[];
  duplicates: number;
};

type SheetView = ParsedSheetState & {
  derived: DerivedVegaRow[];
  importable: DerivedVegaRow[];
  skipped: DerivedVegaRow[];
  corrected: DerivedVegaRow[];
  warnings: string[];
  blankCount: number;
};

type Phase = "idle" | "parsing" | "previewing" | "importing" | "done";

const CARD = "rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900";
const LABEL = "text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400";

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div>
      <div className={LABEL}>{label}</div>
      <div className={`text-lg font-semibold ${tone || "text-gray-900 dark:text-gray-100"}`}>{value}</div>
    </div>
  );
}

function Chip({ children, tone = "gray" }: { children: React.ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    gray: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    rose: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
    violet: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone] || tones.gray}`}>
      {children}
    </span>
  );
}

function SeatLine({ p }: { p: VegaPreview }) {
  if (!p.seatsBefore || !p.seatsAfter) return null;
  const a = p.seatsAfter;
  return (
    <p className="text-sm text-gray-600 dark:text-gray-400">
      Seats {p.seatsBefore.taken} &rarr;{" "}
      <strong className={a.over ? "text-amber-600 dark:text-amber-400" : ""}>{a.taken}</strong>
      {a.capacity != null ? ` of ${a.capacity}` : " (no cap set)"}
      {a.over ? " — over capacity, which is a warning rather than a block: people drop out." : ""}
      {a.overlap > 0 ? ` · ${a.overlap} counted once (they applied and were sourced)` : ""}
    </p>
  );
}

function RowTable({ rows }: { rows: DerivedVegaRow[] }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-gray-500 dark:text-gray-400">
          <tr>
            <th className="py-1 pr-3">Handle</th>
            <th className="py-1 pr-3">Sheet progress</th>
            <th className="py-1 pr-3">Stage</th>
            <th className="py-1 pr-3">Application</th>
            <th className="py-1 pr-3">Agreed</th>
            <th className="py-1 pr-3">Route</th>
            <th className="py-1 pr-3">Live link</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.sheet}-${r.line}`} className="border-t border-gray-100 dark:border-gray-800">
              <td className="py-1 pr-3 font-mono text-xs">@{r.handle}</td>
              <td className="py-1 pr-3">{r.progress ? PROGRESS_LABEL[r.progress] : "—"}</td>
              <td className="py-1 pr-3">{STAGE_LABEL[r.stage as BookingStage] || r.stage}</td>
              <td className="py-1 pr-3">{r.applicationStatus || "—"}</td>
              <td className="py-1 pr-3">{r.agreedFee != null ? `Rs ${r.agreedFee}` : "barter"}</td>
              <td className="py-1 pr-3">{r.fulfilmentMode}</td>
              <td className="py-1 pr-3">{r.liveUrl ? "yes" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Read a cell by header name, tolerating the trailing spaces every header in
// these workbooks carries ("Creator Name ").
const cellReader = (rec: Record<string, unknown>) => (field: string): string => {
  for (const k of Object.keys(rec)) {
    if (k.trim().toLowerCase() === field.trim().toLowerCase()) {
      const v = rec[k];
      return v == null ? "" : String(v);
    }
  }
  return "";
};

const bareHandle = (raw: string) =>
  String(raw || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/^instagram\.com\//i, "")
    .split(/[?#/]/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "");

export default function BackfillPanel() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSheetState[]>([]);
  const [payments, setPayments] = useState<Record<string, Map<string, PaymentRow>>>({});
  const [previews, setPreviews] = useState<Record<string, VegaPreview>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [blankPolicy, setBlankPolicy] = useState<Record<string, BlankPolicy>>({});
  const [results, setResults] = useState<Record<string, string>>({});
  // Admin-confirmed handle corrections, keyed "sheet|line".
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<Record<string, HandleSuggestion>>({});
  const [capacityRaised, setCapacityRaised] = useState<Record<string, number>>({});

  // Derivation is a pure function of the parsed rows, the payment map and
  // the blank policy, so it belongs here rather than in parse state.
  const sheets: SheetView[] = useMemo(
    () =>
      parsed.map((p) => {
        const pay = payments[p.sheet];
        const derived = p.rows.map((r) => {
          const override = overrides[`${r.sheet}|${r.line}`];
          // The payment row is keyed on the handle, so a corrected handle
          // must be used to look it up — that is how @thecozyshot picks up
          // the "Cleared" row that the wrong cell had hidden.
          return deriveVegaRow(r, pay?.get(override || r.handle), {
            blankPolicy: blankPolicy[p.sheet],
            handleOverride: override,
          });
        });
        return {
          ...p,
          derived,
          importable: derived.filter((d) => !d.skipReason),
          skipped: derived.filter((d) => d.skipReason),
          corrected: derived.filter((d) => d.corrected && !d.skipReason),
          warnings: [...new Set(derived.flatMap((d) => d.warnings))],
          blankCount: derived.filter((d) => d.progress === "blank").length,
        };
      }),
    [parsed, payments, blankPolicy, overrides],
  );

  // Ask our own database who the skipped rows are, by creator name. Free —
  // no API call, no credits.
  async function findSuggestions() {
    const wanted = sheets.flatMap((s) =>
      s.skipped.filter((r) => r.name).map((r) => ({ key: `${r.sheet}|${r.line}`, name: r.name })),
    );
    if (!wanted.length) return;
    const res = await suggestHandlesByName(wanted);
    if (res.suggestions) {
      const map: Record<string, HandleSuggestion> = {};
      for (const s of res.suggestions) map[s.key] = s;
      setSuggestions(map);
    }
  }

  // ── Parse ──────────────────────────────────────────────────────────────
  async function onFiles(mainFile: File | null, payFile: File | null) {
    if (!mainFile) return;
    setPhase("parsing");
    setError(null);
    setPreviews({});
    setResults({});
    setPicked({});
    try {
      const XLSX = await import("xlsx");

      // Payment workbook first — the main sheets need it to tell a finished
      // paid row ("live, and paid") from one that is merely live.
      const payMap: Record<string, Map<string, PaymentRow>> = {};
      if (payFile) {
        const wb = XLSX.read(await payFile.arrayBuffer(), { type: "array" });
        for (const name of wb.SheetNames) {
          const recs = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: "" });
          const m = new Map<string, PaymentRow>();
          for (const rec of recs) {
            const get = cellReader(rec);
            const handle = bareHandle(get("Profile"));
            if (handle) m.set(handle, parsePaymentRow(get));
          }
          payMap[name] = m;
        }
      }

      const wb = XLSX.read(await mainFile.arrayBuffer(), { type: "array" });
      const next: ParsedSheetState[] = [];

      for (const name of wb.SheetNames) {
        const campaignId = VEGA_SHEET_CAMPAIGNS[name];
        if (!campaignId) continue;
        const ws = wb.Sheets[name];
        const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        const headers = (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false })[0] || []).map((h) =>
          String(h ?? ""),
        );
        const sheetRows = parseSheet(name, records, headers);
        // Keyed on sheet AND handle: 37 creators legitimately appear on more
        // than one campaign, and the bare-handle default would discard them.
        const { rows: unique, duplicates } = dedupeRows(sheetRows.rows, (r) => `${r.sheet}|${r.handle}`);
        next.push({ sheet: name, campaignId, rows: unique, duplicates: duplicates.length });
      }

      if (!next.length) {
        setError("No recognised sheet names in that workbook — expected the seven Vega sheets.");
        setPhase("idle");
        return;
      }
      setPayments(payMap);
      setParsed(next);
      setPhase("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that workbook.");
      setPhase("idle");
    }
  }

  // ── Dry run ────────────────────────────────────────────────────────────
  async function runPreview() {
    setPhase("previewing");
    setError(null);
    const out: Record<string, VegaPreview> = {};
    for (const s of sheets) {
      setProgress(`Checking ${s.sheet}…`);
      out[s.sheet] = await previewVegaImport(
        s.campaignId,
        s.importable.map((r) => ({ handle: r.handle, stage: r.stage, applicationStatus: r.applicationStatus })),
      );
      setPreviews({ ...out });
    }
    setProgress("");
    setPhase("idle");
  }

  // ── Commit ─────────────────────────────────────────────────────────────
  async function runImport() {
    const chosen = sheets.filter((s) => picked[s.sheet]);
    if (!chosen.length) return;
    setPhase("importing");
    setError(null);
    const out: Record<string, string> = { ...results };

    for (const s of chosen) {
      const wire: VegaWireRow[] = s.importable.map((r) => ({
        handle: r.handle,
        sheet: r.sheet,
        line: r.line,
        stage: r.stage,
        applicationStatus: r.applicationStatus,
        name: r.name,
        email: r.email,
        phone: r.phone,
        address: r.address,
        tier: r.tier,
        category: r.category,
        followers: r.followers,
        productCost: r.productCost,
        quotedFee: r.quotedFee,
        agreedFee: r.agreedFee,
        notes: r.notes,
        notesSuffix: r.notesSuffix,
        liveUrl: r.liveUrl || undefined,
        liveAt: r.liveAt,
        fulfilmentMode: r.fulfilmentMode,
        revisionNote: r.revisionNote || undefined,
        contactedAt: r.contactedAt,
        confirmedAt: r.confirmedAt,
        scriptSharedAt: r.scriptSharedAt,
      }));

      let added = 0;
      let updated = 0;
      let invited = 0;
      let apps = 0;
      let dropped = 0;
      const problems: string[] = [];

      for (let i = 0; i < wire.length; i += BACKFILL_CHUNK_SIZE) {
        const chunk = wire.slice(i, i + BACKFILL_CHUNK_SIZE);
        setProgress(`${s.sheet}: ${Math.min(i + chunk.length, wire.length)} of ${wire.length}…`);
        const res = await commitVegaChunk(s.campaignId, chunk);
        if (res.error) {
          problems.push(res.error);
          break;
        }
        added += res.added ?? 0;
        updated += res.updated ?? 0;
        invited += res.invitationsCreated ?? 0;
        apps += res.applicationsUpdated ?? 0;
        dropped += res.droppedLinks ?? 0;
        for (const f of res.failed || []) problems.push(`@${f.handle}: ${f.reason}`);
      }

      out[s.sheet] =
        `${added} booked · ${updated} refreshed · ${invited} new creators invited · ${apps} applications moved` +
        (dropped ? ` · ${dropped} unusable live link(s) dropped` : "") +
        (problems.length ? ` · ${problems.length} problem(s): ${problems[0]}` : "");
      setResults({ ...out });
    }

    setProgress("");
    setPhase("done");
    await runPreview();
    router.refresh();
  }

  const busy = phase === "parsing" || phase === "previewing" || phase === "importing";
  const anyPicked = sheets.some((s) => picked[s.sheet]);
  const previewed = Object.keys(previews).length > 0;

  return (
    <div className="space-y-6">
      <div className={CARD}>
        <h2 className="mb-1 text-base font-semibold text-gray-900 dark:text-gray-100">1. The two workbooks</h2>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Both are read in your browser — neither file is uploaded. The payment workbook is optional, but without it a
          finished paid row records as <strong>live</strong> rather than <strong>paid</strong>, because nothing else in
          either file says the money moved.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL}>Vega × Adinfinity.xlsx</span>
            <input
              id="vega-main"
              type="file"
              accept=".xlsx,.xls"
              disabled={busy}
              onChange={(e) => {
                const main = e.target.files?.[0] ?? null;
                const pay = (document.getElementById("vega-pay") as HTMLInputElement | null)?.files?.[0] ?? null;
                void onFiles(main, pay);
              }}
              className="mt-1 block w-full text-sm"
            />
          </label>
          <label className="block">
            <span className={LABEL}>Paid Creators.xlsx (optional)</span>
            <input
              id="vega-pay"
              type="file"
              accept=".xlsx,.xls"
              disabled={busy}
              onChange={() => {
                const main = (document.getElementById("vega-main") as HTMLInputElement | null)?.files?.[0] ?? null;
                const pay = (document.getElementById("vega-pay") as HTMLInputElement | null)?.files?.[0] ?? null;
                if (main) void onFiles(main, pay);
              }}
              className="mt-1 block w-full text-sm"
            />
          </label>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {sheets.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void runPreview()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900"
              aria-busy={phase === "previewing"}
            >
              {phase === "previewing" && <ButtonSpinner />}
              2. Dry run — check against the database
            </button>
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={busy || !anyPicked || !previewed}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              aria-busy={phase === "importing"}
            >
              {phase === "importing" && <ButtonSpinner />}
              3. Import the ticked campaigns
            </button>
            {sheets.some((s) => s.skipped.some((r) => r.name)) && (
              <button
                type="button"
                onClick={() => void findSuggestions()}
                disabled={busy}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
              >
                Identify the skipped rows
              </button>
            )}
            {progress && <span className="text-sm text-gray-600 dark:text-gray-400">{progress}</span>}
          </div>

          <div className="space-y-4">
            {sheets.map((s) => {
              const p = previews[s.sheet];
              const moving = (p?.applicationChanges || []).filter((c) => c.willChange);
              const histogram: Record<string, number> = {};
              for (const r of s.importable) histogram[r.stage] = (histogram[r.stage] || 0) + 1;

              return (
                <div key={s.sheet} className={CARD}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!picked[s.sheet]}
                          disabled={busy || !p || !!p.error}
                          onChange={(e) => setPicked({ ...picked, [s.sheet]: e.target.checked })}
                          className="h-4 w-4"
                        />
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{s.sheet}</span>
                      </label>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{p?.campaignTitle || s.campaignId}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip>{s.importable.length} importable</Chip>
                      {s.duplicates > 0 && <Chip tone="amber">{s.duplicates} duplicate row(s) collapsed</Chip>}
                      {s.skipped.length > 0 && <Chip tone="rose">{s.skipped.length} skipped</Chip>}
                      {results[s.sheet] && <Chip tone="green">imported</Chip>}
                    </div>
                  </div>

                  {s.blankCount > 0 && (
                    <div className="mt-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                      <label className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-gray-700 dark:text-gray-300">
                          {s.blankCount} row(s) have no Progress. Record them as
                        </span>
                        <select
                          value={blankPolicy[s.sheet] || "contacted"}
                          disabled={busy}
                          onChange={(e) => {
                            setBlankPolicy({ ...blankPolicy, [s.sheet]: e.target.value as BlankPolicy });
                            // The stages change, so the dry run no longer
                            // describes what would happen.
                            setPreviews((prev) => {
                              const copy = { ...prev };
                              delete copy[s.sheet];
                              return copy;
                            });
                            setPicked((prev) => ({ ...prev, [s.sheet]: false }));
                          }}
                          className="rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
                        >
                          <option value="contacted">Contacted — does not take a seat</option>
                          <option value="confirmed">Confirmed — takes a seat</option>
                        </select>
                      </label>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                        Contacted is the safer default: the sheet only proves somebody reached out. Neither option
                        touches an application.
                      </p>
                    </div>
                  )}

                  {p?.error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{p.error}</p>}

                  {p && !p.error && (
                    <>
                      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
                        <Stat label="Registered" value={p.counts?.registered ?? 0} />
                        <Stat label="Already invited" value={p.counts?.invited ?? 0} />
                        <Stat label="New to us" value={p.counts?.new ?? 0} tone="text-violet-600 dark:text-violet-400" />
                        <Stat label="Ours to refresh" value={p.refreshable ?? 0} />
                        <Stat
                          label="Hand-built (left alone)"
                          value={p.manual ?? 0}
                          tone={(p.manual ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
                        />
                      </div>

                      <div className="mt-4">
                        <div className={LABEL}>Stages these rows will land on</div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {Object.entries(histogram)
                            .sort((a, b) => b[1] - a[1])
                            .map(([stage, n]) => (
                              <Chip key={stage} tone={stage === "fee_paid" ? "green" : "gray"}>
                                {STAGE_LABEL[stage as BookingStage] || stage}: {n}
                              </Chip>
                            ))}
                        </div>
                      </div>

                      <div className="mt-4 space-y-1">
                        <SeatLine p={p} />
                        {p.seatsAfter?.over && (
                          <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30">
                            <p className="text-sm text-amber-900 dark:text-amber-200">
                              {p.seatsAfter.taken} creators against {p.seatsAfter.capacity} seats. The import proceeds
                              either way — people drop out, and the seat counter has always treated this as a warning.
                            </p>
                            {capacityRaised[s.sheet] ? (
                              <p className="mt-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                                Capacity raised to {capacityRaised[s.sheet]}.
                              </p>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={async () => {
                                  const to = p.seatsAfter?.taken ?? 0;
                                  const res = await raiseCampaignCapacity(s.campaignId, to);
                                  if (res.error) setError(res.error);
                                  else {
                                    setCapacityRaised({ ...capacityRaised, [s.sheet]: res.capacity ?? to });
                                    await runPreview();
                                  }
                                }}
                                className="mt-2 rounded-lg border border-amber-400 px-3 py-1 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-900/40"
                              >
                                Also raise this campaign&apos;s capacity to {p.seatsAfter.taken}
                              </button>
                            )}
                          </div>
                        )}
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {p.existingApplications?.total ?? 0} existing applications on this campaign stay as they are,
                          except {moving.length} that move forward.
                          {moving.length > 0 && (
                            <span className="ml-1">{moving.map((c) => `@${c.handle} ${c.from}→${c.to}`).join(", ")}</span>
                          )}
                        </p>
                      </div>
                    </>
                  )}

                  {s.skipped.length > 0 && (
                    <details className="mt-4" open>
                      <summary className="cursor-pointer text-sm font-medium text-rose-700 dark:text-rose-400">
                        {s.skipped.length} row(s) cannot be imported
                      </summary>
                      <ul className="mt-2 space-y-3 text-sm">
                        {s.skipped.map((r) => {
                          const key = `${r.sheet}|${r.line}`;
                          const sug = suggestions[key];
                          return (
                            <li key={key} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                              <div className="text-gray-700 dark:text-gray-300">
                                Row {r.line}
                                {r.name ? (
                                  <>
                                    {" — "}
                                    <strong>{r.name}</strong>
                                  </>
                                ) : null}
                              </div>
                              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{r.skipReason}</div>
                              {r.handleRaw && (
                                <a
                                  href={r.handleRaw}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="mt-1 block break-all text-xs text-blue-600 underline dark:text-blue-400"
                                >
                                  {r.handleRaw}
                                </a>
                              )}
                              {sug && sug.candidates.length > 0 && (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <span className="text-xs text-gray-500 dark:text-gray-400">We may know them:</span>
                                  {sug.candidates.map((c) => (
                                    <button
                                      key={c.handle}
                                      type="button"
                                      disabled={busy}
                                      onClick={() => {
                                        setOverrides({ ...overrides, [key]: c.handle });
                                        // The stages and classification change,
                                        // so the dry run is stale.
                                        setPreviews((prev) => {
                                          const copy = { ...prev };
                                          delete copy[s.sheet];
                                          return copy;
                                        });
                                        setPicked((prev) => ({ ...prev, [s.sheet]: false }));
                                      }}
                                      className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-300"
                                    >
                                      use @{c.handle} ({c.kind}
                                      {c.fullName ? `, ${c.fullName}` : ""})
                                    </button>
                                  ))}
                                </div>
                              )}
                              {sug && sug.candidates.length === 0 && (
                                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                  No match in our creator database — open the link above, read the handle, and either
                                  fix the sheet or paste it here.
                                </div>
                              )}
                              <div className="mt-2 flex items-center gap-2">
                                <input
                                  type="text"
                                  placeholder="or type the handle"
                                  defaultValue={overrides[key] || ""}
                                  disabled={busy}
                                  onBlur={(e) => {
                                    const v = e.target.value.trim().replace(/^@/, "").toLowerCase();
                                    if (!v || v === overrides[key]) return;
                                    setOverrides({ ...overrides, [key]: v });
                                    setPreviews((prev) => {
                                      const copy = { ...prev };
                                      delete copy[s.sheet];
                                      return copy;
                                    });
                                    setPicked((prev) => ({ ...prev, [s.sheet]: false }));
                                  }}
                                  className="w-56 rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
                                />
                                {overrides[key] && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => {
                                      const copy = { ...overrides };
                                      delete copy[key];
                                      setOverrides(copy);
                                    }}
                                    className="text-xs text-gray-500 underline dark:text-gray-400"
                                  >
                                    clear
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                        Correcting a handle here is only for this run — it does not change the sheet. Re-run the dry run
                        afterwards, since the corrected row changes the classification and may pick up a payment row.
                      </p>
                    </details>
                  )}

                  {s.corrected.length > 0 && (
                    <p className="mt-2 text-sm text-violet-700 dark:text-violet-400">
                      {s.corrected.length} handle(s) corrected by hand:{" "}
                      {s.corrected.map((r) => `row ${r.line} → @${r.handle}`).join(", ")}
                    </p>
                  )}

                  {s.warnings.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-medium text-amber-700 dark:text-amber-400">
                        {s.warnings.length} warning(s)
                      </summary>
                      <ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
                        {s.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300">
                      Row detail ({s.importable.length})
                    </summary>
                    <RowTable rows={s.importable} />
                  </details>

                  {results[s.sheet] && (
                    <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                      {results[s.sheet]}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
