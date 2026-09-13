# RGossips Admin — Windows desktop widget

A small always-on-top card with today's numbers and the all-time totals, refreshed
automatically. PowerShell + WPF only — nothing to install. Adapted from
`myshop-client/widget`.

```
  ● RGOSSIPS ADMIN                   ⟳  ✕
  COLLECTED TODAY
  ₹4,299.00
  ₹1,24,560.00 total · 6 payments   +₹299.00
  ┌ ● SUBSCRIPTIONS ┐ ┌ ● SIGN-UPS ─────┐
  │ +2 today        │ │ +37 today       │
  │ 10 total        │ │ 128 total       │
  └─────────────────┘ └─────────────────┘
  Updated 22:29:30 · every 60s
```

## What the numbers mean

| Figure | Today (IST day) | Total |
| --- | --- | --- |
| **Collected** | Razorpay captured payments since midnight IST, minus refunds | All Razorpay captured payments, minus refunds |
| **Subscriptions** | New paid subscriptions (`subscription_events`, migration 067) | Creators on Starter / Pro / Elite |
| **Sign-ups** | New creator + brand profiles | All creator + brand profiles (hover for the split) |

- Collected covers everything paid **through Razorpay** — subscriptions, campaign escrow,
  services. App Store / Google Play purchases don't go through Razorpay and aren't included.
  A `+` after the total means the scan hit its safety cap (20k payments).
- Subscriptions today shows `—` until migration 067 is applied; it counts from then on.

## Setup (once)

1. **Admin app env (Netlify → Site settings → Environment variables), then redeploy:**
   - `WIDGET_API_TOKEN` — a long random string (≥ 24 chars). Same value goes in the widget config.
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` — the live Razorpay API keys (Razorpay
     Dashboard → Account & Settings → API keys). Read-only use; needed for "Collected".
2. **Install the widget:**
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\widget\Install-Widget.ps1
   ```
   Creates `config.json` from `config.example.json` if missing, a Desktop shortcut and a
   Startup shortcut, then launches. Put the token in `config.json` → `"token"`.

`-NoStartup` skips the Startup shortcut; `-Uninstall` removes both shortcuts.

## Share with teammates (single .exe)

Build once:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\widget\build\Build-WidgetExe.ps1
```

→ `widget\dist\RGossipsWidget.exe` (~60 KB, gitignored). It uses only what ships with
Windows 10/11 — the .NET Framework C# compiler and the Windows PowerShell 5.1 engine — and
hosts this same script in-process (no `powershell.exe -ExecutionPolicy Bypass` child, which
antivirus tends to flag). Rebuild after editing `RGossipsWidget.ps1`.

**The exe contains no token.** Send teammates the file, and the access token separately
(e.g. a password manager or a direct message — not in the same place as the exe). On first
run it asks for the token and stores it DPAPI-encrypted for that Windows account in
`%LOCALAPPDATA%\RGossipsAdminWidget\config.json`; right-click → **Set access token…** changes
it. To revoke everyone, change `WIDGET_API_TOKEN` on Netlify and share the new one.

Teammates will see a **"Windows protected your PC"** SmartScreen prompt the first time
(the exe isn't code-signed): **More info → Run anyway**. Right-click → **Start with Windows**
makes it launch at sign-in from wherever the exe is saved — put it somewhere permanent first.

## Using it

| Action | Result |
| --- | --- |
| Drag the card | Move it (remembered) |
| Drag the bottom-right grip / `Ctrl` + wheel | Resize, 65%–250% (double-click grip = 100%) |
| `⟳` / `✕` | Refresh now / close |
| Double-click the card | Open the admin dashboard |
| Right-click | Refresh interval (30s–5m), opacity, size, always-on-top, start with Windows |

A green pulse and a chip (`+₹299.00`, `+1 sub`, `+2 sign-ups`) appear when something new
lands between refreshes. The header dot is green when fresh, blue while fetching, red when
the API can't be reached — the footer then says why (offline, token rejected, API disabled).

## How it works / security

One `GET {apiUrl}/api/widget/stats` per refresh with `Authorization: Bearer <token>`.
The route (`src/app/api/widget/stats/route.ts`) runs server-side with the service role and
returns **only aggregate numbers** — no names, phones or ids. The widget never holds a
Supabase or Razorpay key. The token lives in `widget/config.json`, which is gitignored —
never commit it. If it leaks, change `WIDGET_API_TOKEN` on Netlify and in `config.json`.

The all-time Razorpay total is cached for 30 minutes on the server and topped up with
today's live figure, so frequent refreshes don't rescan every payment.

Window position, size, opacity and interval are stored in
`%LOCALAPPDATA%\RGossipsAdminWidget\state.json` (delete it to reset). If nothing appears,
run `RGossipsWidget.ps1` from a PowerShell window to see errors.
