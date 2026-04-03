"""
JARVIS Template Evolution — Analyzes failures and generates improved template versions.

Looks at success/failure data, identifies patterns, and creates new template
versions incorporating improvements.
"""

import json
import logging
import sqlite3
from dataclasses import dataclass, asdict, field
from datetime import datetime
from pathlib import Path
from typing import Optional

import yaml

log = logging.getLogger("jarvis.evolution")

TEMPLATES_DIR = Path(__file__).parent / "templates" / "prompts"
DB_PATH = Path(__file__).parent / "jarvis_data.db"

# Common failure patterns and their fixes
FAILURE_PATTERNS = {
    "import": {
        "keywords": ["import error", "importerror", "modulenotfounderror", "no module named"],
        "section": "acceptance_criteria",
        "fix": "- [ ] All imports resolve without errors\n- [ ] Required packages added to requirements/package files",
    },
    "file_missing": {
        "keywords": ["file not found", "filenotfounderror", "no such file", "missing file"],
        "section": "acceptance_criteria",
        "fix": "- [ ] All referenced files exist at expected paths\n- [ ] File creation verified",
    },
    "syntax": {
        "keywords": ["syntax error", "syntaxerror", "unexpected token", "parsing error"],
        "section": "acceptance_criteria",
        "fix": "- [ ] Code parses without syntax errors\n- [ ] Linter passes on all modified files",
    },
    "wrong_tech": {
        "keywords": ["wrong framework", "wrong library", "tech stack mismatch", "incompatible"],
        "section": "requirements",
        "fix": "- Tech stack must be explicitly specified and verified before starting",
    },
    "incomplete": {
        "keywords": ["incomplete", "missing section", "not implemented", "todo", "placeholder"],
        "section": "acceptance_criteria",
        "fix": "- [ ] All sections/features listed in requirements are fully implemented\n- [ ] No TODO or placeholder content remains",
    },
    "test_failure": {
        "keywords": ["test failed", "assertion error", "assertionerror", "test failure"],
        "section": "acceptance_criteria",
        "fix": "- [ ] All existing tests pass\n- [ ] New tests added for new functionality",
    },
}


@dataclass
class FailureAnalysis:
    task_type: str
    total_failures: int
    common_issues: list[str]
    failure_patterns: list[str]
    suggested_improvements: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Improvement:
    section_name: str
    current_content: str
    suggested_change: str
    rationale: str

    def to_dict(self) -> dict:
        return asdict(self)


class TemplateEvolver:
    """Analyzes failures and generates improved template versions."""

    def __init__(self, db_path: str = None, templates_dir: str = None):
        self.db_path = db_path or str(DB_PATH)
        self.templates_dir = Path(templates_dir) if templates_dir else TEMPLATES_DIR
        self.db = sqlite3.connect(self.db_path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row

    def analyze_failures(self, task_type: str) -> FailureAnalysis:
        """Analyze failed tasks to identify common issues and patterns."""
        issues = []
        patterns_found = []

        try:
            # Get failed tasks from task_log
            rows = self.db.execute(
                "SELECT prompt, success FROM task_log WHERE task_type = ? AND success = 0",
                (task_type,),
            ).fetchall()

            total_failures = len(rows)

            # Collect all prompts from failures to look for patterns
            failure_texts = [row["prompt"].lower() for row in rows]

            # Also check experiments table
            exp_rows = self.db.execute(
                "SELECT template_version FROM experiments WHERE task_type = ? AND success = 0",
                (task_type,),
            ).fetchall()
            total_failures += len(exp_rows)

            # Match against known failure patterns
            for pattern_name, pattern_info in FAILURE_PATTERNS.items():
                for text in failure_texts:
                    for keyword in pattern_info["keywords"]:
                        if keyword in text:
                            if pattern_name not in patterns_found:
                                patterns_found.append(pattern_name)
                                issues.append(
                                    f"{pattern_name}: {keyword} found in failure data"
                                )
                            break

            # Generate suggested improvements based on patterns
            suggested = []
            for pattern in patterns_found:
                info = FAILURE_PATTERNS[pattern]
                suggested.append(
                    f"Add to {info['section']}: {info['fix']}"
                )

        except Exception as e:
            log.warning(f"Failure analysis error: {e}")
            total_failures = 0

        return FailureAnalysis(
            task_type=task_type,
            total_failures=total_failures,
            common_issues=issues,
            failure_patterns=patterns_found,
            suggested_improvements=suggested if suggested else ["No patterns detected — more data needed"],
        )

    def suggest_improvements(self, task_type: str) -> list[Improvement]:
        """Generate specific template improvement suggestions based on failure analysis."""
        analysis = self.analyze_failures(task_type)
        improvements = []

        # Load current template
        template_path = self.templates_dir / f"{task_type}.yaml"
        if not template_path.exists():
            log.warning(f"Template not found: {template_path}")
            return improvements

        try:
            template = yaml.safe_load(template_path.read_text())
        except Exception as e:
            log.warning(f"Failed to load template: {e}")
            return improvements

        # Map patterns to improvements
        sections = {s["name"]: s for s in template.get("sections", [])}

        for pattern in analysis.failure_patterns:
            info = FAILURE_PATTERNS.get(pattern)
            if not info:
                continue

            target_section = info["section"]
            current = sections.get(target_section, {})
            current_content = current.get("content", "")

            # Don't suggest if the fix is already present
            if info["fix"] in current_content:
                continue

            improvements.append(Improvement(
                section_name=target_section,
                current_content=current_content[:200],
                suggested_change=info["fix"],
                rationale=f"Pattern '{pattern}' detected in {analysis.total_failures} failures",
            ))

        return improvements

    def create_new_version(self, task_type: str, improvements: list[Improvement]) -> str:
        """Create a new template version with improvements applied.

        Returns the new version identifier (e.g., 'v2').
        """
        # Find current latest version
        existing = sorted(self.templates_dir.glob(f"{task_type}*.yaml"))
        if not existing:
            log.warning(f"No existing template for {task_type}")
            return ""

        # Load the latest version
        latest_path = existing[-1]
        try:
            template = yaml.safe_load(latest_path.read_text())
        except Exception as e:
            log.warning(f"Failed to load template: {e}")
            return ""

        # Determine new version number
        current_version = template.get("version", "v1")
        version_num = int(current_version.replace("v", "")) if current_version.startswith("v") else 1
        new_version = f"v{version_num + 1}"

        # Apply improvements
        sections = template.get("sections", [])
        for improvement in improvements:
            for section in sections:
                if section["name"] == improvement.section_name:
                    # Append the improvement to the section content
                    section["content"] = section["content"].rstrip() + "\n" + improvement.suggested_change + "\n"
                    break

        # Update metadata
        template["version"] = new_version
        template["created_at"] = datetime.now().strftime("%Y-%m-%d")
        template["success_rate"] = None

        # Save new version
        new_filename = f"{task_type}_{new_version}.yaml"
        new_path = self.templates_dir / new_filename

        try:
            new_path.write_text(yaml.dump(template, default_flow_style=False, sort_keys=False))
            log.info(f"Created new template version: {new_path}")
            return new_version
        except Exception as e:
            log.warning(f"Failed to save new template: {e}")
            return ""

    def evolve_if_needed(self, task_type: str, min_failures: int = 5) -> Optional[str]:
        """Check if evolution is warranted and create new version if so.

        Only evolves if there are enough failures to detect patterns.
        Returns new version string or None.
        """
        analysis = self.analyze_failures(task_type)

        if analysis.total_failures < min_failures:
            log.info(
                f"Not enough failures for {task_type} ({analysis.total_failures}/{min_failures}) — skipping evolution"
            )
            return None

        improvements = self.suggest_improvements(task_type)
        if not improvements:
            log.info(f"No improvements suggested for {task_type}")
            return None

        new_version = self.create_new_version(task_type, improvements)
        if new_version:
            log.info(
                f"Evolved {task_type} to {new_version} with {len(improvements)} improvements"
            )
        return new_version

    def close(self):
        try:
            self.db.close()
        except Exception:
            pass
