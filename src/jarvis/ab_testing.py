"""
JARVIS A/B Testing — Template version selection and experiment tracking.

Randomly assigns template versions for the same task type,
tracks which version was used, and calculates success rates per version.
"""

import logging
import math
import random
import sqlite3
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional

import yaml

log = logging.getLogger("jarvis.ab_testing")

TEMPLATES_DIR = Path(__file__).parent / "templates" / "prompts"
DB_PATH = Path(__file__).parent / "jarvis_data.db"

# Minimum tasks per version before declaring a winner
MIN_TASKS_FOR_WINNER = 20
# Minimum success rate difference (as percentage points) to declare a winner
MIN_RATE_DIFFERENCE = 10.0


@dataclass
class PromptTemplate:
    """A loaded prompt template with metadata."""
    task_type: str
    version: str
    file_path: str
    description: str
    sections: list[dict] = field(default_factory=list)
    success_rate: Optional[float] = None
    raw_data: Optional[dict] = field(default=None, repr=False)

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("raw_data", None)
        return d


@dataclass
class VersionStats:
    version: str
    success_rate: float
    total_tasks: int
    passed: int
    failed: int
    confidence_interval: tuple[float, float] = (0.0, 0.0)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["confidence_interval"] = list(self.confidence_interval)
        return d


class ABTester:
    """A/B testing framework for prompt templates."""

    def __init__(self, db_path: str = None, templates_dir: str = None):
        self.db_path = db_path or str(DB_PATH)
        self.templates_dir = Path(templates_dir) if templates_dir else TEMPLATES_DIR
        self.db = sqlite3.connect(self.db_path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self._create_tables()

    def _create_tables(self):
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS experiments (
                id TEXT PRIMARY KEY,
                task_type TEXT NOT NULL,
                template_version TEXT NOT NULL,
                success INTEGER DEFAULT NULL,
                created_at TEXT NOT NULL,
                completed_at TEXT DEFAULT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_exp_type ON experiments(task_type);
            CREATE INDEX IF NOT EXISTS idx_exp_version ON experiments(template_version);
        """)
        self.db.commit()

    def _discover_versions(self, task_type: str) -> list[PromptTemplate]:
        """Find all template versions for a given task type."""
        templates: list[PromptTemplate] = []
        if not self.templates_dir.exists():
            return templates

        # Look for files matching the task type
        for f in sorted(self.templates_dir.glob(f"{task_type}*.yaml")):
            try:
                data = yaml.safe_load(f.read_text())
                if data and data.get("task_type") == task_type:
                    templates.append(PromptTemplate(
                        task_type=data.get("task_type", task_type),
                        version=data.get("version", "v1"),
                        file_path=str(f),
                        description=data.get("description", ""),
                        sections=data.get("sections", []),
                        success_rate=data.get("success_rate"),
                        raw_data=data,
                    ))
            except Exception as e:
                log.warning(f"Failed to load template {f}: {e}")

        return templates

    def select_template(self, task_type: str) -> tuple[PromptTemplate, str]:
        """Select a template version for the given task type.

        Returns (PromptTemplate, experiment_id).
        If multiple versions exist, randomly selects one with equal probability.
        If no templates found, returns a minimal default.
        """
        versions = self._discover_versions(task_type)

        if not versions:
            log.warning(f"No templates found for task type: {task_type}")
            default = PromptTemplate(
                task_type=task_type,
                version="default",
                file_path="",
                description=f"Default template for {task_type}",
            )
            experiment_id = self._create_experiment(task_type, "default")
            return default, experiment_id

        # Random selection with equal probability
        selected = random.choice(versions)
        experiment_id = self._create_experiment(task_type, selected.version)

        log.info(
            f"Selected template {task_type} {selected.version} "
            f"(experiment {experiment_id})"
        )
        return selected, experiment_id

    def _create_experiment(self, task_type: str, version: str) -> str:
        """Record a new experiment and return its ID."""
        experiment_id = str(uuid.uuid4())[:12]
        try:
            self.db.execute(
                "INSERT INTO experiments (id, task_type, template_version, created_at) "
                "VALUES (?, ?, ?, ?)",
                (experiment_id, task_type, version, datetime.now().isoformat()),
            )
            self.db.commit()
        except Exception as e:
            log.warning(f"Failed to record experiment: {e}")
        return experiment_id

    def record_result(
        self, experiment_id: str, template_version: str, success: bool
    ):
        """Record the outcome of an A/B experiment.

        Args:
            experiment_id: The experiment ID from select_template().
            template_version: The template version that was used.
            success: Whether the task succeeded.
        """
        try:
            self.db.execute(
                "UPDATE experiments SET success = ?, completed_at = ? WHERE id = ?",
                (int(success), datetime.now().isoformat(), experiment_id),
            )
            self.db.commit()
            log.info(
                f"Recorded experiment {experiment_id}: "
                f"version={template_version}, {'passed' if success else 'failed'}"
            )
        except Exception as e:
            log.warning(f"Failed to record result: {e}")

    def get_version_stats(self, task_type: str) -> dict[str, VersionStats]:
        """Get per-version success rates with confidence intervals."""
        stats: dict[str, VersionStats] = {}

        try:
            rows = self.db.execute(
                "SELECT template_version, success, COUNT(*) as cnt "
                "FROM experiments WHERE task_type = ? AND success IS NOT NULL "
                "GROUP BY template_version, success",
                (task_type,),
            ).fetchall()

            # Aggregate by version
            version_data: dict[str, dict] = {}
            for row in rows:
                v = row["template_version"]
                if v not in version_data:
                    version_data[v] = {"passed": 0, "failed": 0}
                if row["success"]:
                    version_data[v]["passed"] += row["cnt"]
                else:
                    version_data[v]["failed"] += row["cnt"]

            for version, data in version_data.items():
                total = data["passed"] + data["failed"]
                rate = (data["passed"] / total * 100) if total > 0 else 0.0
                ci = self._wilson_interval(data["passed"], total)
                stats[version] = VersionStats(
                    version=version,
                    success_rate=rate,
                    total_tasks=total,
                    passed=data["passed"],
                    failed=data["failed"],
                    confidence_interval=ci,
                )

        except Exception as e:
            log.warning(f"Failed to get version stats: {e}")

        return stats

    def promote_winner(self, task_type: str) -> Optional[str]:
        """Identify the winning template version if data supports it.

        Requirements:
        - At least MIN_TASKS_FOR_WINNER tasks per version
        - At least MIN_RATE_DIFFERENCE percentage-point gap
        """
        stats = self.get_version_stats(task_type)

        # Need at least 2 versions with enough data
        qualified = {
            v: s for v, s in stats.items()
            if s.total_tasks >= MIN_TASKS_FOR_WINNER
        }

        if len(qualified) < 2:
            return None

        # Sort by success rate descending
        ranked = sorted(
            qualified.values(), key=lambda s: s.success_rate, reverse=True
        )
        best = ranked[0]
        second = ranked[1]

        if best.success_rate - second.success_rate >= MIN_RATE_DIFFERENCE:
            log.info(
                f"Winner for {task_type}: {best.version} "
                f"({best.success_rate:.1f}% vs {second.success_rate:.1f}%)"
            )
            return best.version

        return None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _wilson_interval(
        successes: int, total: int, z: float = 1.96
    ) -> tuple[float, float]:
        """Wilson score interval for binomial proportion (~95% confidence).

        Returns interval as percentages (0-100).
        """
        if total == 0:
            return (0.0, 0.0)

        p = successes / total
        denom = 1 + z * z / total
        centre = (p + z * z / (2 * total)) / denom
        spread = (
            z
            * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total)
            / denom
        )

        lower = max(0.0, centre - spread) * 100
        upper = min(1.0, centre + spread) * 100
        return (round(lower, 2), round(upper, 2))

    def close(self):
        """Close the database connection."""
        try:
            self.db.close()
        except Exception:
            pass
