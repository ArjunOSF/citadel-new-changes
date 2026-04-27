# RECON — Account Reconciliation Prototype

A working prototype of an account reconciliation tool with:
- **Python FastAPI backend** (port 8000) — SQLite storage, auth, file upload, role-based APIs
- **React + Vite frontend** (port 3000) — login, summary, detail, 4 reconciliation templates

## Quick start

### One-time setup
```bash
# Install Node.js (LTS) from https://nodejs.org
# Install Python 3.10+

cd "recon-app citadel"
npm install                                   # frontend deps
pip install -r backend/requirements.txt       # backend deps
```

### Run (two terminals)

**Terminal 1 — backend:**
```bash
cd backend
./start.sh                                    # or: python3 -m uvicorn main:app --reload --port 8000
```

**Terminal 2 — frontend:**
```bash
npm run dev                                   # opens http://localhost:3000
```

## Sample login accounts

All use password `demo123`:

| Username | Role     | Name           |
|----------|----------|----------------|
| `bob`    | Admin    | Waldoff, Bob   |
| `kim`    | Preparer | Wilson, Kim    |
| `edith`  | Approver | Grayson, Edith |
| `sam`    | Auditor  | Humphrey, Sam  |

## Demo flow

1. Sign in as **bob** (Admin) → "Import GL Balances" → drop `sample.xlsx` (or `sample.csv`) → period `2026-04` → Upload
2. Summary page now shows the 4 top cards: Total / Completed / Not Completed / Donut
3. As Admin, use the inline **Template** dropdown on any row to reclassify that account's reconciliation template
4. Click **⚡ Run Auto-Certify** to evaluate the 3 PRD rules against the current period
5. Sign out, sign in as **kim** (Preparer) → see only her assigned recons
6. Click into one → add supporting items until the unidentified difference is within tolerance → "Certify & Submit for Approval"
7. Sign out, sign in as **edith** (Approver) → see the Pending Approval recon → Approve (or Reject with reason)
8. Sign back in as **bob** → summary shows the updated completed count and donut

## Auto-certification rules

From **Summary** (Admin only) click **⚡ Run Auto-Certify** to evaluate:

- **Rule 1 — Zero Balance, No Activity**: `gl_balance = 0` AND no supporting items.
- **Rule 2 — Schedule Match**: Template is Amortizable or Accrual AND supporting-item total matches GL balance within tolerance.
- **Rule 3 — Balance Unchanged from Prior Period**: Current GL equals the prior period's GL AND the prior period was already Reviewed/Approved/System Certified AND no supporting items were added this period.

Matching recons transition to **System Certified** and a system-authored comment records the reason.

## Grouped reconciliations

Admin → **Account Groups** → create a group, then assign accounts to it. On the Summary page the group collapses to a single row (🔗 icon) showing the summed GL balance. Clicking it opens the Group Detail page where supporting items are added against any member account and a single uploaded proof document satisfies every member for the period.

## Invoice-PDF extraction (General List template)

Inside a General List reconciliation, click **📄 Extract from Invoice PDF** in the Supporting Items toolbar. The PDF is sent to the Claude API (`claude-sonnet-4-6`), which reads each invoice and returns structured `{vendor, description, amount, date, invoice_number}` rows. A review modal lets the preparer tweak/deselect before the selected items are committed as supporting items.

**Setup** — give the backend your Anthropic API key ONE of two ways:

1. **`.env` file (recommended)**:
   ```bash
   cd backend
   cp .env.example .env
   # edit .env and replace sk-ant-... with your real key
   ```
   The backend auto-loads `backend/.env`, `.env` in the repo root, or `~/.recon-app/.env` at startup.

2. **Shell export**:
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   cd backend && ./start.sh
   ```

Without the key set, the **📄 Extract from Invoice PDF** button surfaces a clear error telling you exactly where to put the key — everything else in the app is unaffected.

## Templates

Every account is configured with one of four reconciliation templates, each with its own
supporting-items layout and calculations:

- **General List** — flat list of items, classified as List Component / Required Adjustment / Timing Item
- **Amortizable** — each item has an original amount + months; the system computes remaining balance
- **Accrual** — Opening + Additions − Reversals = Expected Ending
- **Schedule List** — scheduled items with 0-30 / 31-60 / 61-90 / 90+ day aging buckets

## File upload format

CSV or Excel with these columns (case-insensitive, flexible aliases):

`Entity`, `Entity Code`, `Account` (or `Account Number`), `Description`, `Template`,
`Preparer`, `Approver`, `GL Balance`, `Currency`, `Threshold %`, `Threshold Amount`

Samples are included at the repo root as `sample.xlsx` and `sample.csv`.

## Architecture notes

- SQLite DB lives at `~/.recon-app/recon.db` (the workspace folder is a FUSE mount that
  doesn't support SQLite journaling, so we fall back to the user home directory).
- Uploaded files and supporting documents are stored under `backend/uploads/`.
- Auth is simplified: the token is the username. This is a prototype — swap for JWTs or
  a real session layer before production.
- Re-importing a period preserves existing reconciliation work. If a GL balance changes
  on an already-approved recon, the status is reset to `In Progress`.
