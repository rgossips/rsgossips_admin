#!/usr/bin/env node
// Run a Supabase CLI command against the edge functions from THIS repo.
//
// The functions don't live here. They live in the consumer app (rgossips_web)
// alongside the supabase/config.toml that declares each one's settings, and
// the CLI resolves `supabase/functions/<name>` relative to the working
// directory. Running `supabase functions deploy send-email` from the admin
// repo therefore uploads an empty source tree and fails with
// "Entrypoint path does not exist".
//
// Copying the functions here would be worse than the error. 49 of the 69
// functions are declared `verify_jwt = false` in that config.toml — sign-in,
// the payment webhooks, the store notification handlers — and a deploy from a
// directory without it silently applies the default `verify_jwt = true`,
// locking them the moment they ship. So this delegates: same command, run in
// the directory that owns both the source and the config.
//
//   npm run fn -- deploy send-email
//   npm run fn -- list
//   npm run fn -- deploy send-email --debug
//
// Anything after `--` is passed through to `supabase functions <...>`.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const adminRoot = resolve(here, "..");

// Sibling checkout by default; override when the repos aren't side by side.
const webRoot = process.env.RGOSSIPS_WEB_PATH
  ? resolve(process.env.RGOSSIPS_WEB_PATH)
  : resolve(adminRoot, "..", "rgossips_web");

const functionsDir = join(webRoot, "supabase", "functions");
const configFile = join(webRoot, "supabase", "config.toml");

if (!existsSync(functionsDir) || !existsSync(configFile)) {
  console.error(`Can't find the edge functions.

Looked in: ${webRoot}
  supabase/functions  ${existsSync(functionsDir) ? "found" : "MISSING"}
  supabase/config.toml ${existsSync(configFile) ? "found" : "MISSING"}

If the consumer app lives somewhere else, point at it:
  set RGOSSIPS_WEB_PATH=D:\\path\\to\\rgossips_web   (cmd)
  $env:RGOSSIPS_WEB_PATH = "D:\\path\\to\\rgossips_web"  (PowerShell)`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(`Usage: npm run fn -- <supabase functions subcommand>

  npm run fn -- deploy send-email
  npm run fn -- deploy send-email --debug
  npm run fn -- list

Running in: ${webRoot}`);
  process.exit(1);
}

// One deliberate guard: deploying everything at once would recreate the four
// Stripe functions that were deleted from the project, because their source
// is still in the repo.
if (args[0] === "deploy" && !args.some((a) => !a.startsWith("-") && a !== "deploy")) {
  console.error(`Refusing to deploy ALL functions.

The Stripe functions were deleted from the project but their source is still
in the repo, so a bulk deploy would bring them back. Name the ones you mean:
  npm run fn -- deploy send-email`);
  process.exit(1);
}

console.log(`> supabase functions ${args.join(" ")}`);
console.log(`  (in ${webRoot})\n`);

const child = spawn("npx", ["--yes", "supabase@latest", "functions", ...args], {
  cwd: webRoot,
  stdio: "inherit",
  shell: true, // npx is a .cmd on Windows
});
child.on("exit", (code) => process.exit(code ?? 1));
