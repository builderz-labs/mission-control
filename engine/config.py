"""RoceOS Execution Engine Configuration"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # LLM Mode: "cli" = Claude Code CLI ($0), "api" = LiteLLM proxy (costs $)
    llm_mode: str = "cli"
    anthropic_api_key: str = ""  # Only used when llm_mode="api" or as failover

    # LiteLLM proxy (used by LangGraph graphs for tool calling)
    litellm_base_url: str = "http://litellm:4000"

    # Mission Control API
    mc_api_url: str = "http://mission-control:3000/api"
    mc_api_key: str = ""

    # Telegram
    telegram_bot_token: str = ""
    telegram_user_id: int = 8787239235  # Ross

    # GitHub
    github_token: str = ""

    # Alpaca Trading
    alpaca_live_key: str = ""
    alpaca_live_secret: str = ""
    alpaca_paper_key: str = ""
    alpaca_paper_secret: str = ""

    # UniFi
    unifi_host: str = ""
    unifi_username: str = ""
    unifi_password: str = ""

    # Google (OAuth token file path)
    google_token_path: str = "/app/data/google_token.json"

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
