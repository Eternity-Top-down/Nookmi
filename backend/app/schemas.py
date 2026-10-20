"""Validated API models shared by storage and AI routes."""
from __future__ import annotations

from datetime import date, datetime
import re
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator, BaseModel, ConfigDict, Field, StrictBool, StrictInt,
    StrictStr, field_validator, model_validator,
)
from pydantic_core import PydanticCustomError

Module = Literal["one-to-one", "evening", "course"]


def valid_unicode(value: str) -> str:
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise PydanticCustomError("text_unicode", "文本包含无效 Unicode 字符") from exc
    return value


def nonblank(value: str) -> str:
    if not value.strip():
        raise PydanticCustomError("text_blank", "内容不能为空")
    return value


Text = Annotated[StrictStr, AfterValidator(valid_unicode)]
Identifier = Annotated[Text, Field(max_length=128), AfterValidator(nonblank)]
Text2000 = Annotated[Text, Field(max_length=2000)]
Text5000 = Annotated[Text, Field(max_length=5000)]
Text8000 = Annotated[Text, Field(max_length=8000)]
Text10000 = Annotated[Text, Field(max_length=10000)]
Text12000 = Annotated[Text, Field(max_length=12000)]


def valid_day(value: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise PydanticCustomError("date_format", "日期须为 YYYY-MM-DD 格式")
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise PydanticCustomError("date_invalid", "日期无效") from exc
    if not "1900-01-01" <= value <= "2100-12-31":
        raise PydanticCustomError("date_range", "日期须在 1900—2100 年内")
    return value


def valid_time(value: str) -> str:
    if not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d"
        r"(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})", value
    ):
        raise ValueError("时间格式无效")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("时间无效") from exc
    valid_day(value[:10])
    return value


def valid_lesson(value: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d", value):
        raise ValueError("上课时间须为 YYYY-MM-DDTHH:mm 格式")
    valid_day(value[:10])
    return value


Day = Annotated[Text, Field(max_length=10), AfterValidator(valid_day)]
Timestamp = Annotated[Text, Field(max_length=40), AfterValidator(valid_time)]
LessonTime = Annotated[Text, Field(max_length=16), AfterValidator(valid_lesson)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Student(Model):
    id: Identifier
    module: Module
    classId: Identifier | None
    name: Annotated[Text, Field(max_length=80), AfterValidator(nonblank)]
    grade: Annotated[Text, Field(max_length=50)]
    school: Annotated[Text, Field(max_length=120)]
    guardian: Annotated[Text, Field(max_length=80)]
    phone: Annotated[Text, Field(max_length=80)]
    notes: Text5000
    createdAt: Timestamp
    updatedAt: Timestamp


class ClassGroup(Model):
    id: Identifier
    module: Literal["evening", "course"]
    name: Annotated[Text, Field(max_length=100), AfterValidator(nonblank)]
    grade: Annotated[Text, Field(max_length=50)]
    schedule: Annotated[Text, Field(max_length=200)]
    notes: Text5000
    createdAt: Timestamp


class TeachingRecord(Model):
    id: Identifier
    studentId: Identifier
    date: Day
    content: Annotated[Text5000, AfterValidator(nonblank)]
    createdAt: Timestamp


class FeedbackBrief(Model):
    periodStart: Day
    periodEnd: Day
    subjects: Annotated[list[Annotated[Text, Field(max_length=50)]], Field(max_length=10)]
    teachingContent: Text5000
    commonTasks: Text5000
    focus: Text5000
    length: Literal["brief", "standard"]

    @field_validator("subjects")
    @classmethod
    def normalize_subjects(cls, values: list[str]) -> list[str]:
        normalized = [nonblank(value).strip() for value in values]
        if len(set(normalized)) != len(normalized):
            raise PydanticCustomError("subjects_duplicate", "学科不能重复")
        return normalized

    @model_validator(mode="after")
    def validate_period(self) -> Self:
        if not "1900-01-01" <= self.periodStart <= self.periodEnd <= "2100-12-31":
            raise PydanticCustomError("feedback_period_order", "反馈日期须在 1900—2100 年内，且开始日期不能晚于结束日期")
        return self

    def has_text(self) -> bool:
        return any(value.strip() for value in (self.teachingContent, self.commonTasks, self.focus))


class StudentObservations(Model):
    performance: Text2000
    strengths: Text2000
    difficulties: Text2000
    plan: Text2000
    tasks: Text8000
    subjects: Annotated[
        dict[Annotated[Text, Field(max_length=50)], Text2000],
        Field(max_length=10),
    ]

    @field_validator("subjects")
    @classmethod
    def normalize_subjects(cls, values: dict[str, str]) -> dict[str, str]:
        normalized: dict[str, str] = {}
        for key, value in values.items():
            key = nonblank(key).strip()
            if key in normalized:
                raise PydanticCustomError("subjects_duplicate", "分学科事实的学科名称不能重复")
            normalized[key] = value
        return normalized

    def has_text(self) -> bool:
        return any(value.strip() for value in (
            self.performance, self.strengths, self.difficulties,
            self.plan, self.tasks, *self.subjects.values(),
        ))


class OptionalFieldsModel(Model):
    @model_validator(mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        if isinstance(value, dict):
            for key, info in cls.model_fields.items():
                if not info.is_required() and key in value and value[key] is None:
                    raise ValueError(f"{key} 不可为 null；未使用时请省略")
        return value


class FeedbackEntry(OptionalFieldsModel):
    studentId: Identifier
    content: Text10000
    observations: StudentObservations | None = None
    reviewed: StrictBool | None = None
    generationSource: Literal["ai", "manual", "outline"] | None = None
    generatedFrom: Annotated[Text, Field(max_length=256)] | None = None

    def has_text(self) -> bool:
        return bool(self.content.strip() or (self.observations and self.observations.has_text()))


class FeedbackSession(OptionalFieldsModel):
    id: Identifier
    module: Module
    classId: Identifier | None
    studentId: Identifier | None
    lessonAt: LessonTime
    entries: Annotated[list[FeedbackEntry], Field(max_length=50_000)]
    brief: FeedbackBrief | None = None
    createdAt: Timestamp
    updatedAt: Timestamp

    @model_validator(mode="after")
    def validate_entries(self) -> Self:
        ids = [entry.studentId for entry in self.entries]
        if len(set(ids)) != len(ids):
            raise ValueError("同一次课程反馈中存在重复学生")
        if not any(entry.has_text() for entry in self.entries) and not (self.brief and self.brief.has_text()):
            if self.module == "one-to-one":
                raise ValueError("请先填写本次课程内容、学生事实或反馈正文")
            raise ValueError("请先填写学生事实、反馈内容或课程共用内容")
        return self


class AppData(OptionalFieldsModel):
    schemaVersion: Literal[1]
    students: Annotated[list[Student], Field(max_length=50_000)]
    classes: Annotated[list[ClassGroup], Field(max_length=5000)]
    records: Annotated[list[TeachingRecord], Field(max_length=100_000)]
    feedbackSessions: Annotated[list[FeedbackSession], Field(max_length=20_000)] | None = None
    feedbackStyles: Annotated[dict[Module, Text12000], Field(max_length=3)] | None = None

    @field_validator("schemaVersion", mode="before")
    @classmethod
    def strict_version(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("备份版本须为整数")
        return value

    @model_validator(mode="after")
    def validate_relationships(self) -> Self:
        groups = {group.id: group for group in self.classes}
        students = {student.id: student for student in self.students}
        sessions = self.feedbackSessions or []
        ids = [item.id for items in (self.classes, self.students, self.records, sessions) for item in items]
        if len(set(ids)) != len(ids):
            raise ValueError("数据中存在重复 ID")
        for student in self.students:
            if student.module == "one-to-one":
                if student.classId is not None:
                    raise ValueError("一对一学生不能属于班级")
            elif student.classId not in groups or groups[student.classId].module != student.module:
                raise ValueError("学生所属班级不存在或与模块不一致")
        for record in self.records:
            if record.studentId not in students:
                raise ValueError("教学记录所属学生不存在")
        for session in sessions:
            if session.module == "one-to-one":
                target = students.get(session.studentId)
                if session.classId is not None or not target or target.module != "one-to-one":
                    raise ValueError("课程反馈所属一对一学生无效")
                if len(session.entries) != 1 or session.entries[0].studentId != session.studentId:
                    raise ValueError("一对一反馈必须仅包含目标学生")
            else:
                target_class = groups.get(session.classId)
                if session.studentId is not None or not target_class or target_class.module != session.module:
                    raise ValueError("课程反馈所属班级无效")
            for entry in session.entries:
                member = students.get(entry.studentId)
                if not member or member.module != session.module or (
                    session.module != "one-to-one" and member.classId != session.classId
                ):
                    raise ValueError("反馈学生不属于指定学生或班级")
        return self

    def payload(self) -> dict:
        return self.model_dump(exclude_unset=True)


class WorkspaceUpdate(Model):
    data: AppData
    revision: Annotated[StrictInt, Field(ge=0)]


class AISettingsUpdate(Model):
    baseUrl: Annotated[Text, Field(max_length=500)]
    model: Annotated[Text, Field(max_length=200)]
    apiKey: Annotated[Text, Field(max_length=2000)] | None = None
    clearApiKey: StrictBool = False

    @field_validator("baseUrl")
    @classmethod
    def validate_url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not value:
            return value
        parsed = urlsplit(value)
        try:
            parsed.port
        except ValueError as exc:
            raise ValueError("API 地址端口无效") from exc
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("API 地址须为不含凭据、查询或片段的 http/https 地址")
        if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
            raise ValueError("远程 API 地址须使用 HTTPS；HTTP 仅限本机服务")
        return value

    @field_validator("model")
    @classmethod
    def normalize_model(cls, value: str) -> str:
        if any(ord(char) < 32 for char in value):
            raise ValueError("模型名称包含无效字符")
        return value.strip()

    @field_validator("apiKey")
    @classmethod
    def validate_key(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if any(ord(char) < 33 or ord(char) > 126 for char in value):
            raise ValueError("API Key 须为不含空格的可打印 ASCII 字符")
        return value

    @model_validator(mode="after")
    def reject_conflicting_key(self) -> Self:
        if self.clearApiKey and self.apiKey:
            raise PydanticCustomError("api_key_conflict", "不能同时设置与删除 API Key")
        return self


class GenerateRequest(Model):
    module: Module
    brief: FeedbackBrief
    observations: StudentObservations
    grade: Annotated[Text, Field(max_length=50)]
    styleReference: Text12000 = ""

    @model_validator(mode="after")
    def require_personal_facts(self) -> Self:
        if not any(value.strip() for value in (
            self.observations.performance, self.observations.strengths,
            self.observations.difficulties, *self.observations.subjects.values(),
        )):
            if self.module == "one-to-one":
                raise PydanticCustomError("personal_facts_required", "请先填写这位学生在本次课的实际观察，不能仅凭课程内容或课后任务生成反馈")
            raise PydanticCustomError("personal_facts_required", "请先填写这位学生的实际观察，不能仅凭共用内容生成个人反馈")
        return self


class FeedbackSuggestion(Model):
    field: Literal["performance", "strengths", "difficulties", "plan"]
    text: Annotated[Text, Field(max_length=240), AfterValidator(nonblank)]

    @field_validator("text")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return value.strip()


class FeedbackSuggestions(Model):
    suggestions: Annotated[list[FeedbackSuggestion], Field(min_length=1, max_length=6)]
