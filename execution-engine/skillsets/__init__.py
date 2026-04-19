from skillsets.base import SKILLSET_REGISTRY, SkillsetConfig, register_skillset
from skillsets.general import general_assistant_config
from skillsets.wealth import wealth_config
from skillsets.cto import cto_config
from skillsets.ttrpg import ttrpg_config

__all__ = [
    "SKILLSET_REGISTRY",
    "SkillsetConfig",
    "register_skillset",
    "general_assistant_config",
    "wealth_config",
    "cto_config",
    "ttrpg_config",
]
