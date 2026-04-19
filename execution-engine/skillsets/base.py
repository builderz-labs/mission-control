"""Base skillset definition for RoceOS."""
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SkillsetConfig:
    """Configuration for a skillset."""
    id: str
    name: str
    description: str
    model_tier: str  # "reasoning", "analysis", or "fast"
    system_prompt: str
    tools: list = field(default_factory=list)
    cross_team_events: list = field(default_factory=list)


# Registry of all skillset configs
SKILLSET_REGISTRY: dict[str, SkillsetConfig] = {}


def register_skillset(config: SkillsetConfig):
    """Register a skillset configuration."""
    SKILLSET_REGISTRY[config.id] = config
    return config
