"""Parse the model's structured suggestions without exposing its raw output."""
import json
import re

from ..schemas import FeedbackSuggestions


def unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def reject_constant(_value: str) -> None:
    raise ValueError("non-standard JSON constant")


def parse_suggestions(content: str) -> dict:
    text = content.strip()
    if text.startswith("```"):
        fenced = re.fullmatch(r"```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```", text, re.IGNORECASE)
        if fenced is None:
            raise ValueError("invalid JSON fence")
        text = fenced.group(1)
    decoded = json.loads(text, object_pairs_hook=unique_object, parse_constant=reject_constant)
    return FeedbackSuggestions.model_validate(decoded).model_dump()
