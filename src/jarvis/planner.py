"""
JARVIS Task Planner — Conversational planning before spawning Claude Code.

Handles:
1. Planning mode detection (distinguish "build me X" from "what time is it")
2. Clarifying question generation (1-3 short, voice-friendly questions)
3. Plan confirmation flow (summarize → confirm → execute)
4. Context gathering from project files
5. Structured prompt building from templates + context + answers
"""

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import anthropic

from templates import TEMPLATES, get_template

log = logging.getLogger("jarvis.planner")

DESKTOP_PATH = Path.home() / "Desktop"

# ---------------------------------------------------------------------------
# Planning Mode Detection
# ---------------------------------------------------------------------------

BYPASS_PHRASES = [
    "just do it", "figure it out", "just go", "skip planning",
    "don't ask", "stop asking", "yep just go", "just build it",
    "wing it", "surprise me", "do your thing",
]

SMART_DEFAULTS = {
    "build": {
        "tech_stack": "React + Tailwind",
        "project_dir": str(DESKTOP_PATH),
        "design": "Modern, clean aesthetic",
    },
    "fix": {
        "approach": "Diagnose and fix in-place",
    },
    "research": {
        "depth": "comprehensive",
        "output_format": "summary report",
    },
    "refactor": {
        "goal": "readability and maintainability",
    },
    "simple": {},
}


@dataclass
class PlanningDecision:
    """Result of analyzing whether a request needs planning."""
    needs_planning: bool
    task_type: str  # build, fix, research, refactor, simple
    confidence: float  # 0.0 - 1.0
    missing_info: list[str] = field(default_factory=list)
    smart_defaults: dict = field(default_factory=dict)


async def detect_planning_mode(
    user_text: str,
    client: Optional[anthropic.AsyncAnthropic] = None,
    force_bypass: bool = False,
) -> PlanningDecision:
    """Classify a user request as simple (execute now) or complex (needs planning).

    Args:
        user_text: The raw user request.
        client: Anthropic async client for Haiku classification.
        force_bypass: If True, skip planning and apply smart defaults.

    Returns:
        PlanningDecision with needs_planning, task_type, confidence, missing_info.
    """
    text_lower = user_text.lower().strip()

    # Check for explicit bypass phrases
    if force_bypass or any(phrase in text_lower for phrase in BYPASS_PHRASES):
        # Still classify the task type so we can apply smart defaults
        task_type = _quick_classify(text_lower)
        defaults = dict(SMART_DEFAULTS.get(task_type, {}))
        return PlanningDecision(
            needs_planning=False,
            task_type=task_type,
            confidence=0.7,
            missing_info=[],
            smart_defaults=defaults,
        )

    # Use Haiku for accurate classification
    if client:
        return await _classify_planning_mode_llm(user_text, client)

    # Fallback: keyword-based heuristic (no API available)
    return _classify_planning_mode_heuristic(text_lower)


def _quick_classify(text: str) -> str:
    """Fast keyword-based task type detection (no API call)."""
    build_words = ["build", "create", "make", "set up", "scaffold", "generate", "new"]
    fix_words = ["fix", "debug", "repair", "patch", "resolve", "broken", "error", "bug"]
    research_words = ["research", "look into", "investigate", "analyze", "compare", "find out"]
    refactor_words = ["refactor", "clean up", "restructure", "reorganize", "optimize"]

    for word in fix_words:
        if word in text:
            return "fix"
    for word in refactor_words:
        if word in text:
            return "refactor"
    for word in research_words:
        if word in text:
            return "research"
    for word in build_words:
        if word in text:
            return "build"
    return "simple"


async def _classify_planning_mode_llm(
    text: str, client: anthropic.AsyncAnthropic
) -> PlanningDecision:
    """Use Haiku to classify request and identify missing info."""
    try:
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=400,
            system=(
                "You analyze development requests to decide if they need planning.\n"
                "Respond with JSON only, no markdown fences.\n\n"
                "Fields:\n"
                "- needs_planning: bool — true if the request is vague or missing key details\n"
                "- task_type: build|fix|research|refactor|simple\n"
                "- confidence: float 0.0-1.0 — how confident you are in the classification\n"
                "- missing_info: list[str] — what essential info is absent\n\n"
                "Rules:\n"
                "- Short/vague build requests ('make a website') → needs_planning=true\n"
                "- Detailed requests with file paths, specifics → needs_planning=false\n"
                "- Fix requests with specific file/line info → needs_planning=false\n"
                "- Fix requests without context → needs_planning=true\n"
                "- Simple questions/chat → needs_planning=false, task_type=simple\n"
                "- missing_info should list specific things like: "
                "project_name, tech_stack, design_requirements, target_file, "
                "error_details, scope, expected_behavior\n\n"
                "Examples:\n"
                '{"needs_planning": true, "task_type": "build", "confidence": 0.95, '
                '"missing_info": ["project_name", "tech_stack", "design_requirements"]}\n'
                '{"needs_planning": false, "task_type": "fix", "confidence": 0.9, '
                '"missing_info": []}\n'
                '{"needs_planning": false, "task_type": "simple", "confidence": 0.99, '
                '"missing_info": []}'
            ),
            messages=[{"role": "user", "content": text}],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        data = json.loads(raw)

        task_type = data.get("task_type", "simple")
        needs_planning = data.get("needs_planning", True)
        defaults = dict(SMART_DEFAULTS.get(task_type, {})) if not needs_planning else {}

        return PlanningDecision(
            needs_planning=needs_planning,
            task_type=task_type,
            confidence=float(data.get("confidence", 0.5)),
            missing_info=data.get("missing_info", []),
            smart_defaults=defaults,
        )
    except Exception as e:
        log.warning(f"Planning mode detection failed: {e}")
        # Fall back to heuristic
        return _classify_planning_mode_heuristic(text.lower().strip())


def _classify_planning_mode_heuristic(text: str) -> PlanningDecision:
    """Fallback heuristic when Haiku is unavailable."""
    task_type = _quick_classify(text)

    # Short requests almost always need planning
    word_count = len(text.split())

    if task_type == "simple":
        return PlanningDecision(
            needs_planning=False,
            task_type="simple",
            confidence=0.6,
            missing_info=[],
        )

    if task_type == "fix":
        # Fix with file/line references → no planning needed
        has_specifics = any(
            indicator in text
            for indicator in ["line ", "file ", ".py", ".js", ".ts", "error:", "traceback"]
        )
        if has_specifics and word_count > 5:
            return PlanningDecision(
                needs_planning=False,
                task_type="fix",
                confidence=0.7,
                missing_info=[],
            )
        return PlanningDecision(
            needs_planning=True,
            task_type="fix",
            confidence=0.6,
            missing_info=["target_file", "error_details"],
        )

    if task_type == "build":
        if word_count < 8:
            return PlanningDecision(
                needs_planning=True,
                task_type="build",
                confidence=0.8,
                missing_info=["project_name", "tech_stack", "design_requirements"],
            )
        # Longer build requests may have enough info
        return PlanningDecision(
            needs_planning=True,
            task_type="build",
            confidence=0.6,
            missing_info=["project_name", "tech_stack"],
        )

    # research / refactor — generally need some clarification
    missing = {
        "research": ["scope", "depth"],
        "refactor": ["target_file", "refactor_goal"],
    }
    return PlanningDecision(
        needs_planning=True,
        task_type=task_type,
        confidence=0.6,
        missing_info=missing.get(task_type, []),
    )

# ---------------------------------------------------------------------------
# Task type → relevant clarifying questions
# ---------------------------------------------------------------------------

QUESTION_MAP = {
    "build": [
        {"key": "project", "q": "Which project, sir?", "default": None},
        {"key": "tech_stack", "q": "React or vanilla?", "default": "React + Tailwind"},
        {"key": "details", "q": "Any specific sections or features?", "default": None},
    ],
    "fix": [
        {"key": "project", "q": "Which project, sir?", "default": None},
        {"key": "error", "q": "What error are you seeing?", "default": None},
        {"key": "expected", "q": "What should it do instead?", "default": None},
    ],
    "research": [
        {"key": "depth", "q": "Quick overview or deep dive, sir?", "default": "quick overview"},
        {"key": "sources", "q": "Any specific sources to check?", "default": None},
        {"key": "output_format", "q": "Want a summary or a full report?", "default": "summary"},
    ],
    "refactor": [
        {"key": "project", "q": "Which project, sir?", "default": None},
        {"key": "target", "q": "Which file or module?", "default": None},
        {"key": "goal", "q": "What's the goal — performance, readability, or structure?", "default": "readability"},
    ],
    "run": [
        {"key": "project", "q": "Which project, sir?", "default": None},
        {"key": "command", "q": "Any specific command?", "default": None},
    ],
    "feature": [
        {"key": "project", "q": "Which project, sir?", "default": None},
        {"key": "details", "q": "Can you describe the feature briefly?", "default": None},
        {"key": "tech_stack", "q": "Any tech preferences?", "default": None},
    ],
}


# ---------------------------------------------------------------------------
# Data Model
# ---------------------------------------------------------------------------

@dataclass
class Plan:
    """A plan being built through conversation."""
    task_type: str  # build, fix, research, etc.
    original_request: str
    project: Optional[str] = None
    project_path: Optional[str] = None
    answers: dict = field(default_factory=dict)
    pending_questions: list = field(default_factory=list)
    current_question_index: int = 0
    confirmed: bool = False
    skipped: bool = False  # "just do it" — skip remaining questions

    @property
    def is_complete(self) -> bool:
        """All questions answered or skipped."""
        return self.skipped or self.current_question_index >= len(self.pending_questions)

    @property
    def needs_confirmation(self) -> bool:
        return self.is_complete and not self.confirmed

    def current_question(self) -> Optional[dict]:
        if self.current_question_index < len(self.pending_questions):
            return self.pending_questions[self.current_question_index]
        return None


# ---------------------------------------------------------------------------
# Context Gatherer
# ---------------------------------------------------------------------------

async def gather_project_context(project_path: str) -> dict:
    """Read project files for context injection into the prompt."""
    path = Path(project_path)
    context = {
        "path": project_path,
        "name": path.name,
        "files": [],
        "claude_md": None,
        "package_json": None,
        "requirements_txt": None,
        "readme": None,
        "git_log": None,
        "directory_listing": [],
    }

    if not path.exists():
        return context

    # Top-level directory listing
    try:
        context["directory_listing"] = sorted([
            entry.name + ("/" if entry.is_dir() else "")
            for entry in path.iterdir()
            if not entry.name.startswith(".")
        ])[:30]  # cap at 30 entries
    except PermissionError:
        pass

    # Key config files
    for filename, key in [
        ("CLAUDE.md", "claude_md"),
        ("package.json", "package_json"),
        ("requirements.txt", "requirements_txt"),
        ("README.md", "readme"),
    ]:
        filepath = path / filename
        if filepath.exists():
            try:
                content = filepath.read_text()
                # Truncate large files
                if len(content) > 2000:
                    content = content[:2000] + "\n... (truncated)"
                context[key] = content
            except Exception:
                pass

    # Git log
    import asyncio
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "log", "--oneline", "-5",
            cwd=project_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        if proc.returncode == 0:
            context["git_log"] = stdout.decode().strip()
    except Exception:
        pass

    return context


# ---------------------------------------------------------------------------
# Task Planner
# ---------------------------------------------------------------------------

class TaskPlanner:
    """Manages the planning conversation before spawning Claude Code."""

    def __init__(self):
        self.active_plan: Optional[Plan] = None

    @property
    def is_planning(self) -> bool:
        return self.active_plan is not None and not self.active_plan.confirmed

    async def start_planning(
        self,
        user_request: str,
        projects: list[dict],
        client: anthropic.AsyncAnthropic,
    ) -> dict:
        """Analyze request and determine what questions to ask.

        Returns: {
            "task_type": str,
            "questions": [str, ...],
            "project_match": str | None,
            "first_question": str | None,
            "needs_questions": bool,
        }
        """
        # Classify the request with Haiku
        classification = await self._classify_request(user_request, client)
        task_type = classification.get("task_type", "build")
        detected_project = classification.get("project", "")
        inferred_answers = classification.get("inferred", {})

        # Build question list for this task type
        questions = list(QUESTION_MAP.get(task_type, QUESTION_MAP["build"]))

        # Auto-answer project question if we can match it
        project_match = None
        project_path = None
        if detected_project:
            for p in projects:
                name_norm = p["name"].lower().replace("-", "").replace("_", "")
                detect_norm = detected_project.lower().replace("-", "").replace("_", "").replace(" ", "")
                if detect_norm in name_norm or name_norm in detect_norm:
                    project_match = p["name"]
                    project_path = p["path"]
                    break

        # Filter out questions we already have answers for
        answered = {}
        if project_match:
            answered["project"] = project_match
        answered.update(inferred_answers)

        pending = [q for q in questions if q["key"] not in answered]

        self.active_plan = Plan(
            task_type=task_type,
            original_request=user_request,
            project=project_match,
            project_path=project_path,
            answers=answered,
            pending_questions=pending,
        )

        first_question = None
        if pending:
            first_question = pending[0]["q"]

        return {
            "task_type": task_type,
            "project_match": project_match,
            "first_question": first_question,
            "needs_questions": len(pending) > 0,
        }

    async def process_answer(self, answer: str, projects: list[dict]) -> dict:
        """Process user's answer to a clarifying question.

        Returns: {
            "next_question": str | None,
            "plan_complete": bool,
            "needs_confirmation": bool,
            "confirmation_summary": str | None,
        }
        """
        plan = self.active_plan
        if not plan:
            return {"next_question": None, "plan_complete": False, "needs_confirmation": False}

        answer_lower = answer.lower().strip()

        # Check for "just do it" / skip
        skip_phrases = ["just do it", "skip", "go ahead", "proceed", "do it", "yep just go"]
        if any(phrase in answer_lower for phrase in skip_phrases):
            plan.skipped = True
            # Fill remaining with defaults
            for q in plan.pending_questions[plan.current_question_index:]:
                if q["default"] is not None and q["key"] not in plan.answers:
                    plan.answers[q["key"]] = q["default"]
            summary = await self.get_confirmation_summary()
            return {
                "next_question": None,
                "plan_complete": True,
                "needs_confirmation": True,
                "confirmation_summary": summary,
            }

        # Record the answer
        current_q = plan.current_question()
        if current_q:
            plan.answers[current_q["key"]] = answer

            # If they answered the project question, try to resolve path
            if current_q["key"] == "project" and not plan.project_path:
                for p in projects:
                    name_norm = p["name"].lower().replace("-", "").replace("_", "")
                    answer_norm = answer.lower().replace("-", "").replace("_", "").replace(" ", "")
                    if answer_norm in name_norm or name_norm in answer_norm:
                        plan.project = p["name"]
                        plan.project_path = p["path"]
                        break
                if not plan.project:
                    plan.project = answer
                    new_dir = DESKTOP_PATH / answer.lower().replace(" ", "-")
                    plan.project_path = str(new_dir)

            plan.current_question_index += 1

        # Check if there are more questions
        next_q = plan.current_question()
        if next_q:
            return {
                "next_question": next_q["q"],
                "plan_complete": False,
                "needs_confirmation": False,
                "confirmation_summary": None,
            }

        # All questions answered — generate confirmation summary
        summary = await self.get_confirmation_summary()
        return {
            "next_question": None,
            "plan_complete": True,
            "needs_confirmation": True,
            "confirmation_summary": summary,
        }

    async def handle_confirmation(self, answer: str) -> dict:
        """Handle yes/no/modify response to confirmation summary.

        Returns: {
            "confirmed": bool,
            "cancelled": bool,
            "modification_question": str | None,
        }
        """
        plan = self.active_plan
        if not plan:
            return {"confirmed": False, "cancelled": True, "modification_question": None}

        answer_lower = answer.lower().strip()

        yes_phrases = ["yes", "yeah", "yep", "do it", "proceed", "go", "affirmative",
                       "confirmed", "go ahead", "make it so", "let's go", "sure"]
        no_phrases = ["no", "nope", "cancel", "stop", "nevermind", "forget it", "abort"]

        if any(phrase in answer_lower for phrase in yes_phrases):
            plan.confirmed = True
            return {"confirmed": True, "cancelled": False, "modification_question": None}

        if any(phrase in answer_lower for phrase in no_phrases):
            self.active_plan = None
            return {"confirmed": False, "cancelled": True, "modification_question": None}

        # Treat as a modification — restart with the new info folded in
        # For now, just update the original request and re-confirm
        plan.original_request += f" ({answer})"
        summary = await self.get_confirmation_summary()
        return {
            "confirmed": False,
            "cancelled": False,
            "modification_question": summary,
        }

    async def get_confirmation_summary(self) -> str:
        """Generate a voice-friendly plan summary for confirmation."""
        plan = self.active_plan
        if not plan:
            return "No active plan."

        parts = []

        # Task description
        action_verb = {
            "build": "create",
            "fix": "fix",
            "research": "research",
            "refactor": "refactor",
            "run": "run",
            "feature": "build",
        }.get(plan.task_type, "work on")

        parts.append(f"I'll {action_verb}")

        # What — use a clean description, not raw user text
        if plan.answers.get("details"):
            parts.append(plan.answers["details"])
        elif plan.answers.get("description"):
            parts.append(plan.answers["description"])
        else:
            # Clean up the request — extract the core task
            clean = plan.original_request.lower()
            # Remove conversational fluff
            for prefix in ["yeah ", "i just want to ", "can you ", "i want to ", "i need to ", "let's ", "please ", "go ahead and "]:
                if clean.startswith(prefix):
                    clean = clean[len(prefix):]
            parts.append(clean)

        # Where
        if plan.project:
            target_path = plan.project_path or f"~/Desktop/{plan.project}"
            parts.append(f"at {target_path}")

        # Tech stack
        if plan.answers.get("tech_stack"):
            parts.append(f"using {plan.answers['tech_stack']}")

        summary = " ".join(parts) + ". Shall I proceed, sir?"
        return summary

    async def build_prompt(self) -> str:
        """Build the structured claude -p prompt from the finalized plan."""
        plan = self.active_plan
        if not plan:
            return ""

        # Gather project context if we have a path
        context = {}
        if plan.project_path and Path(plan.project_path).exists():
            context = await gather_project_context(plan.project_path)

        # Try to get a matching template
        template = get_template(plan.task_type, plan.original_request)

        if template:
            # Fill template with available data
            fill = {
                "project_name": plan.project or "project",
                "working_dir": plan.project_path or str(DESKTOP_PATH),
                "tech_stack": plan.answers.get("tech_stack", "developer's choice"),
                "sections": plan.answers.get("details", plan.original_request),
                "design_notes": plan.answers.get("design", "Modern, clean aesthetic"),
                "error_description": plan.answers.get("error", ""),
                "file_path": plan.answers.get("target", ""),
                "expected_behavior": plan.answers.get("expected", ""),
                "feature_description": plan.answers.get("details", plan.original_request),
                "refactor_goal": plan.answers.get("goal", "readability"),
                "research_topic": plan.original_request,
                "research_depth": plan.answers.get("depth", "thorough"),
                "output_format": plan.answers.get("output_format", "summary"),
            }

            try:
                prompt = template.format(**{k: v for k, v in fill.items() if v is not None})
            except KeyError:
                # Template had a key we don't have — fall back to assembled prompt
                prompt = self._assemble_prompt(plan, context)
        else:
            prompt = self._assemble_prompt(plan, context)

        # Append project context if available
        context_section = self._format_context(context)
        if context_section:
            prompt += "\n\n" + context_section

        return prompt

    def get_working_dir(self) -> str:
        """Get the working directory for the current plan."""
        if self.active_plan and self.active_plan.project_path:
            return self.active_plan.project_path
        return str(DESKTOP_PATH)

    def reset(self):
        """Clear the active plan."""
        self.active_plan = None

    # -- Private helpers --

    async def _classify_request(self, text: str, client: anthropic.AsyncAnthropic) -> dict:
        """Use Haiku to classify request type and extract known info."""
        try:
            response = await client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=300,
                system=(
                    "Classify this development request. Respond with JSON only, no markdown.\n"
                    "Fields:\n"
                    "- task_type: build|fix|research|refactor|run|feature\n"
                    "- project: project name mentioned (or empty string)\n"
                    "- inferred: dict of any info you can extract from the request "
                    "(keys: tech_stack, details, error, target, goal, depth, output_format)\n"
                    "Only include inferred keys that are clearly stated.\n"
                    'Example: {"task_type": "build", "project": "roofo", '
                    '"inferred": {"tech_stack": "React", "details": "landing page with hero and pricing"}}'
                ),
                messages=[{"role": "user", "content": text}],
            )
            raw = response.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            return json.loads(raw)
        except Exception as e:
            log.warning(f"Request classification failed: {e}")
            return {"task_type": "build", "project": "", "inferred": {}}

    def _assemble_prompt(self, plan: Plan, context: dict) -> str:
        """Build a freeform prompt when no template matches."""
        lines = [
            f"## Task",
            f"{plan.original_request}",
            "",
        ]

        if plan.project_path:
            lines.extend([f"## Working Directory", f"{plan.project_path}", ""])

        if plan.answers.get("tech_stack"):
            lines.extend([f"## Tech Stack", f"{plan.answers['tech_stack']}", ""])

        if plan.answers.get("details"):
            lines.extend([f"## Details", f"{plan.answers['details']}", ""])

        if plan.answers.get("error"):
            lines.extend([f"## Error", f"{plan.answers['error']}", ""])

        if plan.answers.get("expected"):
            lines.extend([f"## Expected Behavior", f"{plan.answers['expected']}", ""])

        if plan.answers.get("goal"):
            lines.extend([f"## Goal", f"{plan.answers['goal']}", ""])

        lines.extend([
            "## Acceptance Criteria",
            "- [ ] Task completed as described",
            "- [ ] No console errors",
            "- [ ] Clean, readable code",
        ])

        return "\n".join(lines)

    def _format_context(self, context: dict) -> str:
        """Format gathered project context as a prompt section."""
        if not context:
            return ""

        sections = []

        if context.get("claude_md"):
            sections.append(f"## Project Instructions (CLAUDE.md)\n{context['claude_md']}")

        if context.get("package_json"):
            sections.append(f"## package.json\n```json\n{context['package_json']}\n```")

        if context.get("requirements_txt"):
            sections.append(f"## requirements.txt\n```\n{context['requirements_txt']}\n```")

        if context.get("git_log"):
            sections.append(f"## Recent Git History\n```\n{context['git_log']}\n```")

        if context.get("directory_listing"):
            listing = "\n".join(context["directory_listing"])
            sections.append(f"## Directory Structure\n```\n{listing}\n```")

        if sections:
            return "## Project Context\n\n" + "\n\n".join(sections)
        return ""
