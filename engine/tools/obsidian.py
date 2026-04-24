"""Obsidian vault tools — read, write, search, and manage notes.

The full Obsidian vault is synced to /app/obsidian/ in the container.
Supports all vault operations: read notes, create/edit notes, search content,
list directories, and manage wiki links.

Vault structure:
/app/obsidian/
├── CY_BORG/              — Campaign notes, PCs, NPCs
├── Homelab/              — Infrastructure projects, decisions
├── Personal/             — Finances, tasks, profile
├── Plants/               — Plant care
├── Projects/             — Active dev projects
├── Templates/            — Templater scripts
├── _Archive/             — Archived notes
└── _LLM-Wiki/           — Compiled wikis (CY_BORG-Wiki, ICT-Wiki)
"""
import logging
import os
import re
from pathlib import Path

from langchain_core.tools import tool

logger = logging.getLogger("roceos.obsidian")

VAULT_ROOT = "/app/obsidian"


@tool
def obsidian_read_note(path: str) -> str:
    """Read a note from the Obsidian vault.

    Args:
        path: Path relative to vault root (e.g., "CY_BORG/Lucky Flight Takedown/Session-1-Recap.md")

    Returns:
        Note content with frontmatter
    """
    full_path = os.path.join(VAULT_ROOT, path)
    real = os.path.realpath(full_path)
    if not real.startswith(os.path.realpath(VAULT_ROOT)):
        return "Invalid path."

    if not os.path.exists(full_path):
        return f"Note not found: {path}"

    try:
        content = Path(full_path).read_text(encoding="utf-8")
        if len(content) > 10000:
            content = content[:10000] + "\n\n[... truncated]"
        return content
    except Exception as e:
        return f"Error reading: {e}"


@tool
def obsidian_write_note(path: str, content: str) -> str:
    """Create or overwrite a note in the Obsidian vault.

    Args:
        path: Path relative to vault root (e.g., "CY_BORG/Lucky Flight Takedown/Session-2-Recap.md")
        content: Full note content (including frontmatter if desired)

    Returns:
        Confirmation message
    """
    full_path = os.path.join(VAULT_ROOT, path)
    real = os.path.realpath(full_path)
    if not real.startswith(os.path.realpath(VAULT_ROOT)):
        return "Invalid path."

    try:
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        Path(full_path).write_text(content, encoding="utf-8")
        logger.info(f"Wrote note: {path}")
        return f"Note written: {path} ({len(content)} chars)"
    except Exception as e:
        return f"Error writing: {e}"


@tool
def obsidian_append_note(path: str, content: str) -> str:
    """Append content to an existing note.

    Args:
        path: Path relative to vault root
        content: Content to append (will add a newline before)

    Returns:
        Confirmation message
    """
    full_path = os.path.join(VAULT_ROOT, path)
    real = os.path.realpath(full_path)
    if not real.startswith(os.path.realpath(VAULT_ROOT)):
        return "Invalid path."

    if not os.path.exists(full_path):
        return f"Note not found: {path}"

    try:
        with open(full_path, "a", encoding="utf-8") as f:
            f.write(f"\n{content}")
        return f"Appended to: {path}"
    except Exception as e:
        return f"Error appending: {e}"


@tool
def obsidian_search(query: str, folder: str = "") -> str:
    """Search for text across all notes in the Obsidian vault.

    Args:
        query: Text to search for (case-insensitive)
        folder: Optional folder to limit search (e.g., "CY_BORG", "Homelab")

    Returns:
        List of matching files with context snippets
    """
    search_root = os.path.join(VAULT_ROOT, folder) if folder else VAULT_ROOT

    if not os.path.isdir(search_root):
        return f"Folder not found: {folder}"

    results = []
    query_lower = query.lower()

    for root, dirs, files in os.walk(search_root):
        # Skip hidden directories and archive
        dirs[:] = [d for d in dirs if not d.startswith(".")]

        for fname in files:
            if not fname.endswith(".md"):
                continue

            fpath = os.path.join(root, fname)
            try:
                content = Path(fpath).read_text(encoding="utf-8")
                if query_lower in content.lower():
                    # Get context snippet
                    idx = content.lower().find(query_lower)
                    start = max(0, idx - 50)
                    end = min(len(content), idx + len(query) + 50)
                    snippet = content[start:end].replace("\n", " ").strip()

                    rel_path = os.path.relpath(fpath, VAULT_ROOT)
                    results.append(f"  {rel_path}\n    ...{snippet}...")

                    if len(results) >= 15:
                        break
            except Exception:
                continue

        if len(results) >= 15:
            break

    if not results:
        return f"No matches for '{query}' in {folder or 'vault'}"

    return f"Found {len(results)} match(es) for '{query}':\n" + "\n".join(results)


@tool
def obsidian_list(folder: str = "") -> str:
    """List files and folders in the Obsidian vault.

    Args:
        folder: Path relative to vault root (empty = list top-level)

    Returns:
        Directory listing with files and subfolders
    """
    target = os.path.join(VAULT_ROOT, folder) if folder else VAULT_ROOT

    if not os.path.isdir(target):
        return f"Folder not found: {folder}"

    items = []
    try:
        for entry in sorted(os.listdir(target)):
            if entry.startswith("."):
                continue
            full = os.path.join(target, entry)
            if os.path.isdir(full):
                count = sum(1 for _, _, f in os.walk(full) for fn in f if fn.endswith(".md"))
                items.append(f"  📁 {entry}/ ({count} notes)")
            elif entry.endswith(".md"):
                items.append(f"  📄 {entry}")
    except Exception as e:
        return f"Error listing: {e}"

    if not items:
        return f"Empty folder: {folder}"

    header = f"/{folder}" if folder else "/vault root"
    return f"{header}:\n" + "\n".join(items)


@tool
def obsidian_find_links(path: str) -> str:
    """Find all wikilinks ([[...]]) in a note and check if they resolve.

    Args:
        path: Path to the note

    Returns:
        List of outgoing links and their resolution status
    """
    full_path = os.path.join(VAULT_ROOT, path)
    if not os.path.exists(full_path):
        return f"Note not found: {path}"

    try:
        content = Path(full_path).read_text(encoding="utf-8")
    except Exception as e:
        return f"Error: {e}"

    # Find all [[wikilinks]]
    links = re.findall(r'\[\[([^\]]+)\]\]', content)
    if not links:
        return "No wikilinks found in this note."

    results = []
    for link in set(links):
        # Check if the link resolves to a file
        link_name = link.split("|")[0]  # Handle [[file|display]] format
        found = False
        for root, _, files in os.walk(VAULT_ROOT):
            for f in files:
                if f.replace(".md", "") == link_name:
                    found = True
                    break
            if found:
                break
        status = "✓" if found else "✗ broken"
        results.append(f"  {status} [[{link}]]")

    return f"Links in {path}:\n" + "\n".join(sorted(results))


# Tool collection
OBSIDIAN_TOOLS = [
    obsidian_read_note,
    obsidian_write_note,
    obsidian_append_note,
    obsidian_search,
    obsidian_list,
    obsidian_find_links,
]
