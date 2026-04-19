"""RoceOS Execution Engine Configuration"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # LiteLLM proxy
    litellm_base_url: str = "http://litellm:4000"

    # Mission Control API
    mc_api_url: str = "http://mission-control:3000/api"
    mc_api_key: str = ""

    # Redis
    redis_url: str = "redis://redis:6379"

    # Model tiers
    model_reasoning: str = "reasoning"
    model_analysis: str = "analysis"
    model_fast: str = "fast"

    # Data directory for SQLite checkpoints
    data_dir: str = "/app/data"

    class Config:
        env_prefix = "ROCEOS_"
        env_file = ".env"


settings = Settings()
