"""Generate and review a draft without losing it when the review is unavailable."""
from ..schemas import GenerateRequest
from .prompts import build_messages, build_review_messages
from .provider import AIProvider, ProviderError


REVIEW_WARNING = "初稿已保留，但自动检查未完成；请重点核对学生事实、掌握程度和学科建议后再使用。"


def generate_feedback(body: GenerateRequest, provider: AIProvider) -> dict[str, str]:
    # These are per-network-operation waits, not promises of a wall-clock deadline.
    draft = provider.complete(build_messages(body), timeout_seconds=40.0)
    try:
        return provider.complete(build_review_messages(body, draft["content"]), timeout_seconds=25.0)
    except ProviderError:
        # Provider failures must not discard a valid first pass or expose diagnostics.
        return {**draft, "reviewWarning": REVIEW_WARNING}
