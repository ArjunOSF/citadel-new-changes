#!/bin/bash
# Starts the FastAPI backend on port 8000.
cd "$(dirname "$0")"

# Install deps if first run
if ! python3 -c "import fastapi, openpyxl, claude_agent_sdk" 2>/dev/null; then
  echo "Installing backend dependencies..."
  pip install -r requirements.txt --break-system-packages 2>/dev/null || pip install -r requirements.txt
fi

# Locate the `claude` CLI. The Agent SDK needs it to authenticate against
# your Claude Code Max / Pro subscription. If it's not in PATH we check a
# couple of common install locations; if still missing we warn (everything
# else in the app still works — only PDF extraction will error until you
# install Claude Code and sign in).
CLAUDE_BIN="$(command -v claude || true)"
if [ -z "$CLAUDE_BIN" ]; then
  for p in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" "/opt/homebrew/bin/claude" "/usr/local/bin/claude"; do
    if [ -x "$p" ]; then CLAUDE_BIN="$p"; break; fi
  done
fi

if [ -z "$CLAUDE_BIN" ]; then
  echo
  echo "  ⚠  \`claude\` CLI not found — the Invoice-PDF extractor will fail until you:"
  echo "       1. Install Claude Code  →  https://docs.claude.com/claude-code"
  echo "       2. Sign in              →  claude setup-token"
  echo "     (Uses your Max / Pro subscription — no API key needed.)"
  echo
else
  # Make sure ~/.local/bin is on PATH so the SDK's subprocess finds the binary.
  case ":$PATH:" in *":$(dirname "$CLAUDE_BIN"):"*) ;; *) export PATH="$(dirname "$CLAUDE_BIN"):$PATH" ;; esac
  echo "  ✓ claude CLI: $CLAUDE_BIN"
fi

echo "Starting RECON backend on http://localhost:8000 ..."
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
