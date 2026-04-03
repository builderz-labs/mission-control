"""
JARVIS Proactive Suggestions — Contextual follow-up suggestions after task completion.

Generates at most 1 voice-friendly suggestion per completed task based on
simple heuristics (file checks, not LLM calls).
"""

import logging
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

from qa import QAResult

log = logging.getLogger("jarvis.suggestions")

# Web project indicators
WEB_INDICATORS = {
    "package.json", "index.html", "index.tsx", "index.jsx",
    "App.tsx", "App.jsx", "vite.config.ts", "next.config.js",
}

# Test directory/file patterns
TEST_DIRS = {"test", "tests", "__tests__", "spec", "specs"}


@dataclass
class Suggestion:
    """A proactive follow-up suggestion."""
    text: str  # Voice-friendly suggestion (JARVIS personality)
    action_type: str  # favicon, tests, readme, related, quality
    action_details: dict  # Details for executing the suggestion

    def to_dict(self) -> dict:
        return asdict(self)


def suggest_followup(
    task_type: str,
    task_description: str,
    working_dir: str,
    qa_result: Optional[QAResult] = None,
) -> Optional[Suggestion]:
    """Generate a contextual follow-up suggestion after task completion.

    Checks in priority order and returns the first applicable suggestion.
    Returns None if nothing useful to suggest.

    Args:
        task_type: The type of task that was completed (build, fix, etc.)
        task_description: Description of the completed task.
        working_dir: The project working directory.
        qa_result: QA verification result, if available.

    Returns:
        A single Suggestion or None.
    """
    path = Path(working_dir)

    if not path.exists():
        return None

    # Check sequence: favicon -> tests -> readme -> quality
    # Each returns early with max 1 suggestion

    suggestion = _check_favicon(path, task_type)
    if suggestion:
        return suggestion

    suggestion = _check_tests(path, task_type)
    if suggestion:
        return suggestion

    suggestion = _check_readme(path, task_type)
    if suggestion:
        return suggestion

    suggestion = _check_quality(qa_result)
    if suggestion:
        return suggestion

    return None


def _is_web_project(path: Path) -> bool:
    """Check if the directory looks like a web project."""
    try:
        entries = {e.name for e in path.iterdir() if not e.name.startswith(".")}
    except (PermissionError, OSError):
        return False
    return bool(entries & WEB_INDICATORS)


def _check_favicon(path: Path, task_type: str) -> Optional[Suggestion]:
    """Suggest adding a favicon if missing in web projects."""
    if task_type not in ("build", "feature"):
        return None

    if not _is_web_project(path):
        return None

    favicon_files = [
        "favicon.ico", "favicon.png", "favicon.svg",
        "public/favicon.ico", "public/favicon.png", "public/favicon.svg",
        "src/assets/favicon.ico",
    ]

    if any((path / f).exists() for f in favicon_files):
        return None

    return Suggestion(
        text=(
            "That's done, sir. I noticed the project doesn't have a favicon. "
            "Shall I add one?"
        ),
        action_type="favicon",
        action_details={
            "working_dir": str(path),
            "task": "Add a favicon to the project",
        },
    )


def _check_tests(path: Path, task_type: str) -> Optional[Suggestion]:
    """Suggest writing tests if none exist."""
    if task_type not in ("build", "feature", "fix"):
        return None

    try:
        entries = {e.name.lower() for e in path.iterdir()}
    except (PermissionError, OSError):
        return None

    if entries & TEST_DIRS:
        return None

    # Check for test files in top 2 levels
    has_test_files = False
    try:
        for child in path.iterdir():
            if child.name.startswith(".") or child.name == "node_modules":
                continue
            name_lower = child.name.lower()
            if "test" in name_lower or "spec" in name_lower:
                has_test_files = True
                break
            if child.is_dir():
                for grandchild in child.iterdir():
                    gc_lower = grandchild.name.lower()
                    if "test" in gc_lower or "spec" in gc_lower:
                        has_test_files = True
                        break
                if has_test_files:
                    break
    except (PermissionError, OSError):
        pass

    if has_test_files:
        return None

    return Suggestion(
        text=(
            "The implementation looks good, sir. "
            "I notice there aren't any tests yet. Shall I write some?"
        ),
        action_type="tests",
        action_details={
            "working_dir": str(path),
            "task": "Write tests for the project",
        },
    )


def _check_readme(path: Path, task_type: str) -> Optional[Suggestion]:
    """Suggest creating a README if missing."""
    if task_type not in ("build", "feature"):
        return None

    readme_names = ["README.md", "readme.md", "README", "README.txt"]
    if any((path / name).exists() for name in readme_names):
        return None

    # Only suggest if project has enough files to warrant a README
    try:
        file_count = sum(
            1 for e in path.iterdir()
            if not e.name.startswith(".") and e.name != "node_modules"
        )
    except (PermissionError, OSError):
        return None

    if file_count < 3:
        return None

    return Suggestion(
        text=(
            "If I may suggest, sir \u2014 the project has no README. "
            "Want me to create one?"
        ),
        action_type="readme",
        action_details={
            "working_dir": str(path),
            "task": "Create a README.md for the project",
        },
    )


def _check_quality(qa_result: Optional[QAResult]) -> Optional[Suggestion]:
    """Suggest refactoring if QA passed but noted non-critical issues."""
    if not qa_result or not qa_result.passed:
        return None

    if not qa_result.issues:
        return None

    quality_keywords = [
        "cleanup", "clean up", "refactor", "readable", "readability",
        "naming", "structure", "organize", "simplify", "duplication",
        "duplicate", "long function", "complex",
    ]

    relevant_issues = [
        issue for issue in qa_result.issues
        if any(kw in issue.lower() for kw in quality_keywords)
    ]

    if not relevant_issues:
        return None

    return Suggestion(
        text=(
            "Everything works, sir, but I noticed a few areas that could "
            "use some tidying up. Shall I refactor?"
        ),
        action_type="quality",
        action_details={
            "issues": relevant_issues,
            "task": "Refactor code to address quality issues",
        },
    )
