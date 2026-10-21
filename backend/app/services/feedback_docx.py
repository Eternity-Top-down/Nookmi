"""Build a plain editable Word feedback document with only the standard library."""
from __future__ import annotations

from io import BytesIO
import re
from typing import Annotated, Self
from urllib.parse import quote
import xml.etree.ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from pydantic import AfterValidator, Field, model_validator
from pydantic_core import PydanticCustomError

from ..schemas import Model, Text, nonblank

MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
MAX_ENTRIES = 500
MAX_TOTAL_CHARACTERS = 500_000
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML = "http://www.w3.org/XML/1998/namespace"
ET.register_namespace("w", W)


def xml_text(value: str) -> str:
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]", value):
        raise PydanticCustomError("docx_text_invalid", "文本包含 Word 无法使用的控制字符")
    return value


ExportText = Annotated[Text, AfterValidator(xml_text)]


class FeedbackWordEntry(Model):
    studentName: Annotated[ExportText, Field(max_length=80), AfterValidator(nonblank)]
    content: Annotated[ExportText, Field(max_length=10_000), AfterValidator(nonblank)]


class FeedbackWordRequest(Model):
    title: Annotated[ExportText, Field(max_length=200), AfterValidator(nonblank)]
    entries: Annotated[list[FeedbackWordEntry], Field(min_length=1, max_length=MAX_ENTRIES)]

    @model_validator(mode="after")
    def validate_total_size(self) -> Self:
        if sum(len(entry.content) for entry in self.entries) > MAX_TOTAL_CHARACTERS:
            raise PydanticCustomError("docx_total_size", "反馈总正文最多 50 万字，请分批导出")
        return self


def export_validation_message(error: dict) -> str:
    code = error.get("type")
    location = tuple(error.get("loc", ()))
    key = location[-1] if location else ""
    label, limit = {"title": ("文档标题", 200), "studentName": ("学生姓名", 80),
                    "content": ("反馈正文", 10_000)}.get(key, ("导出内容", None))
    if code == "docx_total_size":
        return "反馈总正文最多 50 万字，请分批导出"
    if code == "docx_text_invalid" or code == "text_unicode":
        return f"「{label}」包含无法写入 Word 的字符，请重新粘贴或输入"
    if key == "entries":
        return "请提供 1—500 位有反馈正文的学生，人数较多时请分批导出"
    if code in ("string_too_long", "too_long") and limit:
        return f"「{label}」不能超过 {limit} 字"
    if code in ("text_blank", "missing"):
        return f"「{label}」不能为空，请填写后再导出"
    if code == "extra_forbidden":
        return "导出信息与当前后端版本不一致，请重新启动工作台后重试"
    return f"「{label}」格式不正确，请检查后重试"


def _element(parent: ET.Element, name: str, **attributes: object) -> ET.Element:
    return ET.SubElement(parent, f"{{{W}}}{name}", {f"{{{W}}}{key}": str(value) for key, value in attributes.items()})


def _run_properties(parent: ET.Element, *, bold: bool = False) -> None:
    properties = _element(parent, "rPr")
    _element(properties, "rFonts", ascii="宋体", hAnsi="宋体", eastAsia="宋体", cs="宋体")
    _element(properties, "b", val="1" if bold else "0")
    _element(properties, "bCs", val="1" if bold else "0")
    _element(properties, "color", val="000000")
    _element(properties, "sz", val="24")
    _element(properties, "szCs", val="24")
    _element(properties, "lang", val="zh-CN", eastAsia="zh-CN")


def _run(parent: ET.Element, text: str, *, bold: bool = False) -> None:
    run = _element(parent, "r")
    _run_properties(run, bold=bold)
    for part in re.split(r"(\n|\t)", text.replace("\r\n", "\n").replace("\r", "\n")):
        if part == "\n":
            _element(run, "br")
        elif part == "\t":
            _element(run, "tab")
        elif part:
            node = _element(run, "t")
            node.set(f"{{{XML}}}space", "preserve")
            node.text = part


def _xml(element: ET.Element) -> bytes:
    return ET.tostring(element, encoding="utf-8", xml_declaration=True)


def build_feedback_docx(request: FeedbackWordRequest) -> bytes:
    document = ET.Element(f"{{{W}}}document")
    body = _element(document, "body")
    title = _element(body, "p")
    title_properties = _element(title, "pPr")
    _element(title_properties, "pStyle", val="Title")
    _element(title_properties, "keepNext")
    _element(title_properties, "jc", val="center")
    _element(title_properties, "spacing", before="0", after="240", line="360", lineRule="auto")
    _run(title, request.title.strip(), bold=True)
    for entry in request.entries:
        paragraph = _element(body, "p")
        properties = _element(paragraph, "pPr")
        _element(properties, "pStyle", val="Normal")
        _element(properties, "widowControl")
        _element(properties, "spacing", before="0", after="240", line="360", lineRule="auto")
        _run(paragraph, entry.studentName.strip(), bold=True)
        _run(paragraph, "：" + entry.content.strip())
    section = _element(body, "sectPr")
    _element(section, "pgSz", w="11906", h="16838")
    _element(section, "pgMar", top="1134", right="1134", bottom="1134", left="1134", header="0", footer="0", gutter="0")

    styles = ET.Element(f"{{{W}}}styles")
    defaults = _element(styles, "docDefaults")
    _run_properties(_element(defaults, "rPrDefault"))
    normal = _element(styles, "style", type="paragraph", default="1", styleId="Normal")
    _element(normal, "name", val="Normal")
    _run_properties(normal)
    title_style = _element(styles, "style", type="paragraph", styleId="Title")
    _element(title_style, "name", val="Title")
    _element(title_style, "basedOn", val="Normal")
    _element(title_style, "next", val="Normal")
    _run_properties(title_style, bold=True)

    content_types = b'''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>'''
    root_relationships = b'''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''
    relationships = b'''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>'''
    buffer = BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_relationships)
        archive.writestr("word/document.xml", _xml(document))
        archive.writestr("word/styles.xml", _xml(styles))
        archive.writestr("word/_rels/document.xml.rels", relationships)
    return buffer.getvalue()


def attachment_header(title: str) -> str:
    stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", title)
    stem = re.sub(r"\s+", " ", stem).strip(" .")[:80].rstrip(" .") or "反馈汇总"
    if re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", stem):
        stem = "反馈_" + stem
    return f"attachment; filename=\"feedback.docx\"; filename*=UTF-8''{quote(stem + '.docx', safe='')}"
