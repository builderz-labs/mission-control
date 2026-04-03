"""
JARVIS Conversation Intelligence — Multi-turn planning sessions.

Tracks decisions, manages planning context, and supports mid-conversation
plan modifications across multiple exchanges.
"""

import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional

log = logging.getLogger("jarvis.conversation")

CONTEXT_WINDOW_MAX = 20
SESSION_TIMEOUT_SECONDS = 300  # 5 minutes


@dataclass
class Decision:
    key: str
    value: str
    timestamp: str = ""

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now().isoformat()

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class PlanSummary:
    description: str = ""
    task_type: str = ""
    project: str = ""
    working_dir: str = ""
    tech_stack: list[str] = field(default_factory=list)
    features: list[str] = field(default_factory=list)
    constraints: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    def to_text(self) -> str:
        lines = [f"Task: {self.description}"]
        if self.project:
            lines.append(f"Project: {self.project}")
        if self.working_dir:
            lines.append(f"Directory: {self.working_dir}")
        if self.tech_stack:
            lines.append(f"Tech stack: {', '.join(self.tech_stack)}")
        if self.features:
            lines.append("Features:")
            for f in self.features:
                lines.append(f"  - {f}")
        if self.constraints:
            lines.append("Constraints:")
            for c in self.constraints:
                lines.append(f"  - {c}")
        return "\n".join(lines)


class PlanningSession:
    """Manages state for one multi-turn planning conversation."""

    def __init__(self):
        self.decisions: list[Decision] = []
        self.current_plan = PlanSummary()
        self.exchange_count: int = 0
        self.context_window: list[dict] = []
        self._created_at = datetime.now()
        self._last_activity = datetime.now()
        self._closed = False

    @property
    def is_active(self) -> bool:
        """True if session has open decisions and hasn't been closed or timed out."""
        if self._closed:
            return False
        elapsed = (datetime.now() - self._last_activity).total_seconds()
        if elapsed > SESSION_TIMEOUT_SECONDS:
            self._closed = True
            return False
        return True

    def add_decision(self, key: str, value: str):
        """Record a planning decision."""
        self.decisions.append(Decision(key=key, value=value))
        self._last_activity = datetime.now()

        # Also update plan based on known keys
        key_lower = key.lower()
        if "project" in key_lower:
            self.current_plan.project = value
        elif "dir" in key_lower or "directory" in key_lower:
            self.current_plan.working_dir = value
        elif "tech" in key_lower or "stack" in key_lower:
            self.current_plan.tech_stack = [s.strip() for s in value.split(",")]
        elif "feature" in key_lower:
            self.current_plan.features.append(value)
        elif "constraint" in key_lower:
            self.current_plan.constraints.append(value)
        elif "description" in key_lower or "task" in key_lower:
            self.current_plan.description = value

        log.info(f"Decision recorded: {key} = {value}")

    def add_exchange(self, role: str, content: str):
        """Add a message to the context window."""
        self.context_window.append({
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat(),
        })
        # Cap context window
        if len(self.context_window) > CONTEXT_WINDOW_MAX:
            self.context_window = self.context_window[-CONTEXT_WINDOW_MAX:]

        if role == "user":
            self.exchange_count += 1

        self._last_activity = datetime.now()

    def modify_plan(self, modification: str) -> PlanSummary:
        """Update the current plan based on natural language modification.

        Handles common modifications like changing tech stack, adding features, etc.
        """
        mod_lower = modification.lower()

        # Handle common modification patterns
        if "instead of" in mod_lower:
            # "use Vue instead of React"
            parts = mod_lower.split("instead of")
            new_val = parts[0].replace("use", "").strip()
            old_val = parts[1].strip() if len(parts) > 1 else ""

            # Try to replace in tech stack
            for i, tech in enumerate(self.current_plan.tech_stack):
                if old_val and old_val in tech.lower():
                    self.current_plan.tech_stack[i] = new_val
                    self.add_decision("tech_stack_change", f"{old_val} -> {new_val}")
                    break

        elif "add" in mod_lower:
            # "add a contact form"
            feature = mod_lower.replace("add", "").replace("a ", "").strip()
            self.current_plan.features.append(feature)
            self.add_decision("feature_added", feature)

        elif "remove" in mod_lower:
            # "remove the pricing section"
            to_remove = mod_lower.replace("remove", "").replace("the", "").strip()
            self.current_plan.features = [
                f for f in self.current_plan.features
                if to_remove not in f.lower()
            ]
            self.add_decision("feature_removed", to_remove)

        elif "change" in mod_lower:
            # "change the project name to Acme"
            # Generic — just record the decision
            self.add_decision("modification", modification)

        else:
            # Generic modification — record as decision
            self.add_decision("modification", modification)

        self._last_activity = datetime.now()
        log.info(f"Plan modified: {modification}")
        return self.current_plan

    def get_context(self) -> str:
        """Return formatted context string for LLM injection."""
        lines = ["=== PLANNING SESSION CONTEXT ==="]
        lines.append(f"Exchanges: {self.exchange_count}")
        lines.append(f"Decisions: {len(self.decisions)}")
        lines.append("")

        if self.decisions:
            lines.append("DECISIONS MADE:")
            for d in self.decisions:
                lines.append(f"  - {d.key}: {d.value}")
            lines.append("")

        if self.current_plan.description:
            lines.append("CURRENT PLAN:")
            lines.append(self.current_plan.to_text())
            lines.append("")

        if self.context_window:
            lines.append("RECENT EXCHANGES:")
            for ex in self.context_window[-6:]:  # Last 6 messages
                role = "USER" if ex["role"] == "user" else "JARVIS"
                lines.append(f"  {role}: {ex['content'][:200]}")

        return "\n".join(lines)

    def close(self, reason: str = "completed"):
        """Close the session."""
        self._closed = True
        log.info(f"Planning session closed: {reason} ({self.exchange_count} exchanges, {len(self.decisions)} decisions)")

    def reset(self):
        """Reset session for reuse."""
        self.decisions = []
        self.current_plan = PlanSummary()
        self.exchange_count = 0
        self.context_window = []
        self._created_at = datetime.now()
        self._last_activity = datetime.now()
        self._closed = False


class ConversationMode:
    """Tracks the conversation mode: chat, planning, or browsing."""

    def __init__(self):
        self._mode = "chat"
        self._planning_session: Optional[PlanningSession] = None

    @property
    def mode(self) -> str:
        return self._mode

    @property
    def planning_session(self) -> Optional[PlanningSession]:
        return self._planning_session

    def enter_planning(self) -> PlanningSession:
        """Enter planning mode and create a new session."""
        self._mode = "planning"
        self._planning_session = PlanningSession()
        log.info("Entered planning mode")
        return self._planning_session

    def enter_browsing(self):
        """Enter browsing mode."""
        self._mode = "browsing"
        log.info("Entered browsing mode")

    def return_to_chat(self):
        """Return to normal chat mode."""
        if self._planning_session and self._planning_session.is_active:
            self._planning_session.close("mode_change")
        self._mode = "chat"
        log.info("Returned to chat mode")

    def is_planning(self) -> bool:
        return self._mode == "planning" and self._planning_session and self._planning_session.is_active
