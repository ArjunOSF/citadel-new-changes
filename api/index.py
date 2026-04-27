import sys
import os

# Add backend/ to path so `from main import app` resolves
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

# Use /tmp for writable storage on Vercel's read-only filesystem
if not os.environ.get("RECON_DB_PATH"):
    os.environ["RECON_DB_PATH"] = "/tmp/recon.db"
if not os.environ.get("RECON_UPLOAD_DIR"):
    os.environ["RECON_UPLOAD_DIR"] = "/tmp/uploads"

from main import app  # noqa: F401  — Vercel picks up the `app` ASGI object
