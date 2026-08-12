def normalize_chat_url(base: str) -> str:
    """Normalize base to a proper chat completions URL.
    Tolerates bare host, /v1, /v1/chat/completions etc.
    Used by pyrit, garak, deepteam workers.
    """
    if not base:
        return "https://api.openai.com/v1/chat/completions"
    b = base.rstrip("/")
    if b.endswith(("/chat/completions", "/completions")):
        return b
    if b.endswith("/v1"):
        b = b[:-3].rstrip("/")
    return b + "/v1/chat/completions"
