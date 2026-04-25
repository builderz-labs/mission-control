"""Single source of truth for the roce-os version.

Read at import time from /VERSION at the repo root. Every component
(Discord bot, scanner, dashboard API) imports __version__ from here
instead of hardcoding a string.
"""

import subprocess
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
_VERSION_FILE = _REPO_ROOT / "VERSION"

__version__ = _VERSION_FILE.read_text().strip()


def git_sha(short: bool = True) -> str | None:
    """Return current git SHA, or None if not in a git repo / git missing."""
    try:
        result = subprocess.run(
            ["git", "-C", str(_REPO_ROOT), "rev-parse", "--short" if short else "HEAD", "HEAD"],
            capture_output=True, text=True, timeout=2,
        )
        return result.stdout.strip() or None
    except (subprocess.SubprocessError, FileNotFoundError):
        return None


def version_string(include_sha: bool = True) -> str:
    """Human-readable version, e.g. 'v3.6.0 (a1b2c3d)' or just 'v3.6.0'."""
    sha = git_sha() if include_sha else None
    return f"v{__version__} ({sha})" if sha else f"v{__version__}"
