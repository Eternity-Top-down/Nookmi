"""Validated API models shared by storage and AI routes."""
from __future__ import annotations

from datetime import date, datetime
import re
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator, BaseModel, ConfigDict, Field, StrictBool, StrictFloat, StrictInt,
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


class FeedbackInputSnapshot(Model):
    module: Module
    grade: Annotated[Text, Field(max_length=50)]
    lessonAt: LessonTime
    brief: FeedbackBrief
    observations: StudentObservations


class FeedbackAIDraft(Model):
    id: Identifier
    sessionId: Identifier
    studentId: Identifier
    content: Annotated[Text10000, AfterValidator(nonblank)]
    input: FeedbackInputSnapshot
    createdAt: Timestamp
    model: Annotated[Text, Field(max_length=200)]


class FeedbackComparison(Model):
    source: FeedbackAIDraft
    finalContent: Annotated[Text10000, AfterValidator(nonblank)]
    finalInput: FeedbackInputSnapshot
    confirmedAt: Timestamp


class FeedbackEntry(OptionalFieldsModel):
    studentId: Identifier
    content: Text10000
    observations: StudentObservations | None = None
    reviewed: StrictBool | None = None
    generationSource: Literal["ai", "manual", "outline"] | None = None
    generatedFrom: Annotated[Text, Field(max_length=256)] | None = None
    aiDraft: FeedbackAIDraft | None = None
    comparison: FeedbackComparison | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        if isinstance(value, dict) and any(key in value and value[key] is None for key in ("aiDraft", "comparison")):
            raise PydanticCustomError("feedback_provenance_null", "AI 原稿和修改对比记录不可为 null；未使用时请省略")
        return super().reject_explicit_null(value)

    def has_text(self) -> bool:
        return bool(self.content.strip() or (self.observations and self.observations.has_text()))


class FeedbackSession(OptionalFieldsModel):
    id: Identifier
    module: Module
    classId: Identifier | None
    studentId: Identifier | None
    lessonAt: LessonTime
    lessonNumber: Annotated[StrictInt, Field(ge=1, le=9999)] | None = None
    title: Annotated[Text, Field(max_length=300)] | None = None
    entries: Annotated[list[FeedbackEntry], Field(max_length=50_000)]
    brief: FeedbackBrief | None = None
    createdAt: Timestamp
    updatedAt: Timestamp

    @model_validator(mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        # Missing/null title metadata is legacy-compatible. Normalize null to
        # omission, while retaining the existing null rules for every other field.
        if isinstance(value, dict):
            null_metadata = {key for key in ("lessonNumber", "title") if key in value and value[key] is None}
            if null_metadata:
                value = {key: item for key, item in value.items() if key not in null_metadata}
        return super().reject_explicit_null(value)

    @model_validator(mode="after")
    def validate_entries(self) -> Self:
        if self.lessonNumber is not None and self.module != "one-to-one":
            raise PydanticCustomError("lesson_number_module", "课程次数仅适用于一对一反馈")
        if self.title is not None and self.module != "one-to-one":
            raise PydanticCustomError("feedback_title_module", "自定义标题仅适用于一对一反馈")
        ids = [entry.studentId for entry in self.entries]
        if len(set(ids)) != len(ids):
            raise ValueError("同一次课程反馈中存在重复学生")
        for entry in self.entries:
            sources = [entry.aiDraft, entry.comparison.source if entry.comparison else None]
            for source in sources:
                if source and (source.sessionId != self.id or source.studentId != entry.studentId or source.input.module != self.module):
                    raise PydanticCustomError("feedback_provenance_scope", "AI 原稿与当前课程、学生或模块的归属不一致")
            if entry.comparison:
                if entry.comparison.finalInput.module != self.module:
                    raise PydanticCustomError("feedback_provenance_scope", "已采用反馈输入快照与当前模块不一致")
                if entry.reviewed is True and entry.comparison.finalContent != entry.content:
                    raise PydanticCustomError("feedback_provenance_final", "已确认反馈正文与保存的最终稿不一致，请重新确认采用")
        if not any(entry.has_text() for entry in self.entries) and not (self.brief and self.brief.has_text()):
            if self.module == "one-to-one":
                raise ValueError("请先填写本次课程内容、学生事实或反馈正文")
            raise ValueError("请先填写学生事实、反馈内容或课程共用内容")
        return self


ExamMaxScore = Annotated[StrictFloat, Field(gt=0, le=1000, allow_inf_nan=False)]
ExamScore = Annotated[StrictFloat, Field(ge=0, le=1000, allow_inf_nan=False)]


class ExamEntry(Model):
    studentId: Identifier
    school: Annotated[Text, Field(max_length=120)]
    maxScore: ExamMaxScore
    score: ExamScore | None
    status: Literal["pending", "recorded", "absent"]

    @model_validator(mode="after")
    def validate_score(self) -> Self:
        if self.status == "recorded":
            if self.score is None or self.score > self.maxScore:
                raise PydanticCustomError("exam_score_range", "已录入成绩须在 0 到该学生试卷满分之间")
        elif self.score is not None:
            raise PydanticCustomError("exam_unrecorded_score", "待录入或缺考学生的成绩必须为空")
        return self


class Exam(Model):
    id: Identifier
    classId: Identifier
    name: Annotated[Text, Field(max_length=100), AfterValidator(nonblank)]
    subject: Annotated[Text, Field(max_length=50), AfterValidator(nonblank)]
    date: Day
    defaultMaxScore: ExamMaxScore
    entries: Annotated[list[ExamEntry], Field(max_length=50_000)]
    createdAt: Timestamp
    updatedAt: Timestamp

    @model_validator(mode="after")
    def validate_entries(self) -> Self:
        ids = [entry.studentId for entry in self.entries]
        if len(set(ids)) != len(ids):
            raise PydanticCustomError("exam_students_duplicate", "同一次考试中存在重复学生")
        return self


class AppData(OptionalFieldsModel):
    schemaVersion: Literal[1]
    students: Annotated[list[Student], Field(max_length=50_000)]
    classes: Annotated[list[ClassGroup], Field(max_length=5000)]
    records: Annotated[list[TeachingRecord], Field(max_length=100_000)]
    feedbackSessions: Annotated[list[FeedbackSession], Field(max_length=20_000)] | None = None
    feedbackStyles: Annotated[dict[Module, Text12000], Field(max_length=3)] | None = None
    exams: Annotated[list[Exam], Field(max_length=20_000)] | None = None

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
        exams = self.exams or []
        ids = [item.id for items in (self.classes, self.students, self.records, sessions, exams) for item in items]
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
        for exam in exams:
            target_class = groups.get(exam.classId)
            if not target_class or target_class.module != "course":
                raise PydanticCustomError("exam_class_invalid", "考试必须属于有效的班课班级")
            for entry in exam.entries:
                member = students.get(entry.studentId)
                if not member or member.module != "course" or member.classId != exam.classId:
                    raise PydanticCustomError("exam_student_invalid", "成绩学生不属于本次考试的班课班级")
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
