"""LangGraph tools for skillset memory and wiki access.

These tools are bound to skillset graphs so Claude can call them
during conversations to remember facts, recall knowledge, and
read wiki pages.
"""
import os
import logging
from pathlib import Path

from langchain_core.tools import tool

from tools.store import KnowledgeStore
from config import settings

logger = logging.getLogger("roceos.tools")

# Global knowledge store instance (initialized on first use)
_store: KnowledgeStore | None = None

# Wiki base paths on VPS
WIKI_BASE = "/app/wikis"


def get_store() -> KnowledgeStore:
    global _store
    if _store is None:
        db_path = os.path.join(settings.data_dir, "knowledge.db")
        _store = KnowledgeStore(db_path)
    return _store


@tool
def remember_fact(skillset: str, fact: str, tags: str = "") -> str:
    """Remember a fact or piece of information for future reference.

    Use this when Ross mentions something worth remembering:
    preferences, decisions, goals, deadlines, or any fact that
    would be useful in future conversations.

    Args:
        skillset: Which skillset this fact belongs to (e.g., "wealth", "cto", "ttrpg", "general")
        fact: The fact to remember (be specific and concise)
        tags: Optional comma-separated tags for searchability

    Returns:
        Confirmation message
    """
    store = get_store()
    store.remember(skillset, fact, tags)
    return f"Remembered for {skillset}: {fact}"


@tool
def recall_facts(skillset: str, query: str = "") -> str:
    """Recall previously remembered facts for a skillset.

    Use this to check what you know about a topic before answering,
    or when Ross asks about something you might have stored.

    Args:
        skillset: Which skillset to search (or leave empty string to search all)
        query: Optional search term to filter results

    Returns:
        List of matching facts or "No facts found"
    """
    store = get_store()
    if skillset:
        facts = store.recall(skillset, query)
    else:
        facts = store.recall_all(query)

    if not facts:
        return "No facts found."

    lines = []
    for f in facts:
        lines.append(f"- [{f['skillset']}] {f['fact']}")
    return "\n".join(lines)


@tool
def read_wiki_page(wiki: str, page_path: str) -> str:
    """Read a page from a knowledge wiki.

    Available wikis:
    - "cyborg" — CY_BORG campaign wiki (entities, locations, mechanics, concepts)
    - "ict" — ICT trading methodology wiki

    Common page paths for cyborg wiki:
    - wiki/entities/Wattana-Arms-Dealer.md
    - wiki/entities/Zola.md
    - wiki/locations/Lucky-Flight-Basement.md
    - wiki/mechanics/Combat-Mechanics.md
    - wiki/mechanics/Core-Resolution-System.md
    - output/Vault-Infiltration-Strategy.md

    Args:
        wiki: Wiki identifier ("cyborg" or "ict")
        page_path: Path to the page within the wiki (e.g., "wiki/entities/Wattana-Arms-Dealer.md")

    Returns:
        The page content, or an error message if not found
    """
    wiki_dirs = {
        "cyborg": os.path.join(WIKI_BASE, "cy-borg-wiki"),
        "ict": os.path.join(WIKI_BASE, "ict-wiki"),
    }

    wiki_dir = wiki_dirs.get(wiki)
    if not wiki_dir:
        return f"Unknown wiki: {wiki}. Available: {list(wiki_dirs.keys())}"

    full_path = os.path.join(wiki_dir, page_path)

    # Security: prevent path traversal
    real_path = os.path.realpath(full_path)
    if not real_path.startswith(os.path.realpath(wiki_dir)):
        return "Invalid path."

    if not os.path.exists(full_path):
        # Try to list available files if directory exists
        parent = os.path.dirname(full_path)
        if os.path.isdir(parent):
            files = [f for f in os.listdir(parent) if f.endswith(".md")]
            return f"Page not found: {page_path}\nAvailable in {os.path.basename(parent)}/: {', '.join(files[:20])}"
        return f"Page not found: {page_path}"

    try:
        content = Path(full_path).read_text(encoding="utf-8")
        # Truncate very long pages to avoid token overflow
        if len(content) > 8000:
            content = content[:8000] + "\n\n[... truncated — page too long]"
        return content
    except Exception as e:
        return f"Error reading {page_path}: {e}"


@tool
def list_wiki_pages(wiki: str, directory: str = "wiki") -> str:
    """List available pages in a wiki directory.

    Args:
        wiki: Wiki identifier ("cyborg" or "ict")
        directory: Directory within the wiki (e.g., "wiki/entities", "wiki/mechanics", "output")

    Returns:
        List of available pages
    """
    wiki_dirs = {
        "cyborg": os.path.join(WIKI_BASE, "cy-borg-wiki"),
        "ict": os.path.join(WIKI_BASE, "ict-wiki"),
    }

    wiki_dir = wiki_dirs.get(wiki)
    if not wiki_dir:
        return f"Unknown wiki: {wiki}. Available: {list(wiki_dirs.keys())}"

    target = os.path.join(wiki_dir, directory)

    if not os.path.isdir(target):
        # List top-level directories
        if os.path.isdir(wiki_dir):
            dirs = [d for d in os.listdir(wiki_dir) if os.path.isdir(os.path.join(wiki_dir, d))]
            return f"Directory not found: {directory}\nAvailable directories: {', '.join(dirs)}"
        return f"Wiki not found at {wiki_dir}"

    files = []
    for root, _, filenames in os.walk(target):
        for f in filenames:
            if f.endswith(".md"):
                rel = os.path.relpath(os.path.join(root, f), wiki_dir)
                files.append(rel)

    if not files:
        return f"No markdown files in {directory}/"

    return "\n".join(sorted(files))


# Tool collections per skillset type
MEMORY_TOOLS = [remember_fact, recall_facts]
WIKI_TOOLS = [read_wiki_page, list_wiki_pages]
ALL_TOOLS = MEMORY_TOOLS + WIKI_TOOLS
