"""Small presentation choices, separate from student facts and model transport."""
from datetime import date
from hashlib import sha256
import re

from ..schemas import GenerateRequest


LESSON_ICON_SETS = (
    ("📖", "✨", "🔍", "📌"),
    ("📚", "🔎", "💡", "📝"),
    ("📘", "🧩", "🧭", "📋"),
    ("📝", "💬", "🎯", "✍️"),
)
LESSON_HEADINGS = ("课堂学习内容", "课堂表现与知识掌握情况", "课后建议", "作业安排")
_PICTOGRAPH = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF]")


def lesson_icons(request: GenerateRequest) -> tuple[str, ...]:
    """Keep retries stable; dates and course content provide restrained variety."""
    content_offset = int.from_bytes(sha256(request.brief.teachingContent.strip().encode("utf-8")).digest()[:2], "big")
    index = (date.fromisoformat(request.brief.periodStart).toordinal() + content_offset) % len(LESSON_ICON_SETS)
    return LESSON_ICON_SETS[index]


def apply_example_icons(text: str, icons: tuple[str, ...]) -> str:
    """Only adapt built-in template headings, never historical or generated prose."""
    for number, (title, original, selected) in enumerate(zip(LESSON_HEADINGS, LESSON_ICON_SETS[0], icons), 1):
        text = text.replace(f"{original} {number}. {title}", f"{selected} {number}. {title}")
    return text


def icon_guidance(request: GenerateRequest) -> str:
    if request.module != "one-to-one":
        return ""
    custom = bool(request.styleReference.strip())
    if custom and not _PICTOGRAPH.search(request.styleReference):
        return "个人范文没有图标，不自行增加图标或表情；保持其自然段或文字标题习惯。"
    pairs = "；".join(f"{title}用{icon}" for title, icon in zip(LESSON_HEADINGS, lesson_icons(request)))
    condition = (
        "仅当个人范文的分段标题本来使用图标时，才可在语义相近的图标中适度搭配；保留个人标题、顺序和编号习惯，不强加四板块。范文只有正文中的表情、没有图标标题时，不因此增加图标标题。"
        if custom else "本次一对一采用下列成组标题图标，示例已同步本次搭配。标题名称与内容含义保持稳定。"
    )
    return condition + "\n图标语义搭配：" + pairs + "。每个已有标题最多一个图标，正文和每个条目不额外加表情。不为使用图标补造段落，不使用庆祝、奖牌或警告来暗示未记录的评价。"
