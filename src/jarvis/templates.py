"""
JARVIS Prompt Templates — Structured prompts for Claude Code tasks.

Each template is a format string with named placeholders.
Templates are matched by task type and optionally by keyword analysis.
"""

TEMPLATES = {
    "landing_page": {
        "task_type": "build",
        "keywords": ["landing", "page", "website", "site"],
        "template": """\
## Task
Build a landing page for {project_name}.

## Working Directory
{working_dir}

## Tech Stack
{tech_stack}

## Sections
{sections}

## Design
- {design_notes}
- Mobile responsive
- Modern, clean aesthetic

## Acceptance Criteria
- [ ] All sections render correctly
- [ ] Mobile responsive
- [ ] No console errors
- [ ] Looks professional
""",
    },

    "bug_fix": {
        "task_type": "fix",
        "keywords": ["fix", "bug", "error", "broken", "crash"],
        "template": """\
## Task
Fix a bug in {project_name}.

## Working Directory
{working_dir}

## Error Description
{error_description}

## File / Location
{file_path}

## Expected Behavior
{expected_behavior}

## Approach
1. Reproduce the issue
2. Identify root cause
3. Implement fix
4. Verify fix works
5. Check for regressions

## Acceptance Criteria
- [ ] Bug is fixed
- [ ] No regressions introduced
- [ ] No console errors
- [ ] Clean, readable fix
""",
    },

    "feature": {
        "task_type": "feature",
        "keywords": ["add", "feature", "implement", "new"],
        "template": """\
## Task
Add a new feature to {project_name}.

## Working Directory
{working_dir}

## Feature Description
{feature_description}

## Tech Stack
{tech_stack}

## Design Notes
- {design_notes}

## Acceptance Criteria
- [ ] Feature works as described
- [ ] Integrated with existing code
- [ ] Mobile responsive (if UI)
- [ ] No console errors
- [ ] Clean, readable code
""",
    },

    "refactor": {
        "task_type": "refactor",
        "keywords": ["refactor", "clean", "restructure", "reorganize"],
        "template": """\
## Task
Refactor code in {project_name}.

## Working Directory
{working_dir}

## Target
{file_path}

## Goal
{refactor_goal}

## Constraints
- Preserve all existing functionality
- No breaking changes to public APIs
- Improve code quality

## Acceptance Criteria
- [ ] All tests still pass
- [ ] Functionality preserved
- [ ] Code is cleaner / more maintainable
- [ ] No regressions
""",
    },

    "research": {
        "task_type": "research",
        "keywords": ["research", "investigate", "analyze", "look into"],
        "template": """\
## Task
Research: {research_topic}

## Depth
{research_depth}

## Output Format
{output_format}

## Deliverables
- Summary of findings
- Key recommendations
- Sources / references where applicable

## Acceptance Criteria
- [ ] Research question answered
- [ ] Output in requested format
- [ ] Actionable recommendations included
""",
    },

    "fullstack_app": {
        "task_type": "build",
        "keywords": ["app", "application", "fullstack", "full-stack", "dashboard"],
        "template": """\
## Task
Build {project_name}.

## Working Directory
{working_dir}

## Tech Stack
{tech_stack}

## Features
{sections}

## Design
- {design_notes}
- Mobile responsive
- Modern, clean aesthetic

## Acceptance Criteria
- [ ] All features functional
- [ ] Mobile responsive
- [ ] No console errors
- [ ] Looks professional
- [ ] Clean project structure
""",
    },

    "api": {
        "task_type": "build",
        "keywords": ["api", "endpoint", "backend", "server", "rest"],
        "template": """\
## Task
Build an API for {project_name}.

## Working Directory
{working_dir}

## Tech Stack
{tech_stack}

## Endpoints / Features
{sections}

## Acceptance Criteria
- [ ] All endpoints working
- [ ] Proper error handling
- [ ] No crashes on edge cases
- [ ] Clean, documented code
""",
    },
}


def get_template(task_type: str, request_text: str) -> str | None:
    """Find the best matching template for a task type and request.

    Returns the template format string or None if no good match.
    """
    request_lower = request_text.lower()
    best_match = None
    best_score = 0

    for name, config in TEMPLATES.items():
        if config["task_type"] != task_type:
            continue

        # Score by keyword matches
        score = sum(1 for kw in config["keywords"] if kw in request_lower)
        if score > best_score:
            best_score = score
            best_match = config["template"]

    # Require at least 1 keyword match
    if best_score > 0:
        return best_match

    # Fallback: return the first template for this task_type
    for name, config in TEMPLATES.items():
        if config["task_type"] == task_type:
            return config["template"]

    return None
