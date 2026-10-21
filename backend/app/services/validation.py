"""Actionable validation messages made only from trusted labels and error codes."""
from dataclasses import dataclass


@dataclass(frozen=True)
class FieldInfo:
    label: str
    limit: int | None = None
    kind: str = "text"


FIELDS = {
    ("module",): FieldInfo("教学模块", kind="module"),
    ("grade",): FieldInfo("年级", 50),
    ("styleReference",): FieldInfo("个人风格参考", 12000),
    ("brief",): FieldInfo("课程信息", kind="object"),
    ("brief", "periodStart"): FieldInfo("反馈开始日期", kind="date"),
    ("brief", "periodEnd"): FieldInfo("反馈结束日期", kind="date"),
    ("brief", "subjects"): FieldInfo("科目", 10, "list"),
    ("brief", "teachingContent"): FieldInfo("教学 / 学习内容", 5000),
    ("brief", "commonTasks"): FieldInfo("课程安排 / 课后任务", 5000),
    ("brief", "focus"): FieldInfo("反馈重点", 5000),
    ("brief", "length"): FieldInfo("反馈篇幅", kind="length"),
    ("observations",): FieldInfo("学生课堂记录", kind="object"),
    ("observations", "performance"): FieldInfo("课堂情况", 2000),
    ("observations", "strengths"): FieldInfo("值得肯定", 2000),
    ("observations", "difficulties"): FieldInfo("需要关注", 2000),
    ("observations", "plan"): FieldInfo("后续建议", 2000),
    ("observations", "tasks"): FieldInfo("课后任务", 8000),
    ("observations", "subjects"): FieldInfo("分学科记录", 10, "object"),
    ("baseUrl",): FieldInfo("API 地址", 500, "url"),
    ("model",): FieldInfo("模型名称", 200),
    ("apiKey",): FieldInfo("API Key", 2000, "key"),
    ("clearApiKey",): FieldInfo("删除 API Key 选项", kind="bool"),
    ("revision",): FieldInfo("数据版本", kind="number"),
    ("lessonNumber",): FieldInfo("课程次数", kind="lesson_number"),
    ("title",): FieldInfo("反馈标题", 300),
}

EXAM_FIELDS = {
    (): FieldInfo("考试", kind="object"),
    ("name",): FieldInfo("考试名称", 100),
    ("subject",): FieldInfo("考试科目", 50),
    ("date",): FieldInfo("考试日期", kind="date"),
    ("classId",): FieldInfo("考试所属班级", 128),
    ("defaultMaxScore",): FieldInfo("考试默认满分", kind="exam_max_score"),
    ("entries",): FieldInfo("考试成绩", 50_000, "object"),
    ("entries", "school"): FieldInfo("考试时学校", 120),
    ("entries", "studentId"): FieldInfo("成绩所属学生", 128),
    ("entries", "score"): FieldInfo("学生成绩", kind="exam_score"),
    ("entries", "maxScore"): FieldInfo("学生试卷满分", kind="exam_max_score"),
    ("entries", "status"): FieldInfo("成绩状态", kind="exam_status"),
}


def field_info(location: tuple) -> FieldInfo | None:
    # Never join the raw location: dictionary keys and unknown field names can
    # contain student details, pasted content, or credentials.
    path = location[1:] if location[:1] == ("body",) else location
    if path[:1] == ("data",):
        path = path[1:]
        if path[:1] == ("exams",):
            if len(path) == 1:
                return FieldInfo("考试", 20_000, "list")
            if isinstance(path[1], int):
                exam_path = path[2:]
                if exam_path[:1] == ("entries",) and len(exam_path) > 1 and isinstance(exam_path[1], int):
                    exam_path = ("entries",) + exam_path[2:]
                return EXAM_FIELDS.get(exam_path)
        if path[:1] == ("feedbackSessions",) and len(path) > 2 and isinstance(path[1], int):
            path = path[2:]
            if path[:1] == ("entries",) and len(path) > 2 and isinstance(path[1], int):
                path = path[2:]
        if path[:1] == ("feedbackStyles",):
            if path[-1:] == ("[key]",):
                return FieldInfo("个人风格所属模块", kind="module")
            if len(path) > 1:
                return FieldInfo("个人风格参考", 12000)
            return FieldInfo("个人风格设置", 3, "object")
    if path[:2] == ("brief", "subjects") and len(path) > 2:
        return FieldInfo("科目名称", 50)
    if path[:2] == ("observations", "subjects") and len(path) > 2:
        return FieldInfo("分学科记录的科目名称", 50) if path[-1:] == ("[key]",) else FieldInfo("分学科记录内容", 2000)
    return FIELDS.get(path)


def validation_message(error: dict) -> str:
    code = error.get("type")
    info = field_info(tuple(error.get("loc", ())))
    label = f"「{info.label}」" if info else "该项信息"
    if code == "json_invalid":
        return "请求内容不是有效的 JSON，请重新操作后重试"
    if code == "extra_forbidden":
        return "请求包含当前版本不支持的信息；若刚更新工作台，请先保存草稿，再重新启动工作台"
    if code == "personal_facts_required":
        return "请至少填写一项这位学生的真实观察：课堂情况、值得肯定、需要关注或分学科记录；仅有课程内容、后续建议、课后任务或范文还不够"
    if code == "feedback_period_order":
        return "反馈结束日期不能早于开始日期"
    if code == "lesson_number_module":
        return "「课程次数」仅适用于一对一反馈，晚辅和班课请留空"
    if code == "feedback_title_module":
        return "「反馈标题」仅适用于一对一反馈，晚辅和班课请省略"
    exam_errors = {
        "exam_score_range": "已录入成绩须为 0 到该学生试卷满分之间的数字",
        "exam_unrecorded_score": "待录入或缺考学生的成绩应留空，不能记为零分",
        "exam_students_duplicate": "同一次考试中存在重复学生，请每位学生只保留一条成绩",
        "exam_class_invalid": "考试必须属于有效的班课班级，请检查考试所属班级",
        "exam_student_invalid": "成绩学生不属于本次考试的班课班级，请检查学生所属班级",
    }
    if code in exam_errors:
        return exam_errors[code]
    if info and info.kind == "lesson_number":
        return "「课程次数」须为 1—9999 的整数"
    if code == "api_key_conflict":
        return "不能同时填写新 API Key 和选择删除 API Key，请只保留一种操作"
    if code == "missing":
        return f"缺少{label}，请补全后重试"
    if code in ("date_format", "date_invalid", "date_range") or (info and info.kind == "date"):
        return f"{label}须为 1900—2100 年内的有效日期，格式为 YYYY-MM-DD"
    if code == "subjects_duplicate":
        return f"{label}的科目名称不能重复，请合并同一科目的记录"
    if code == "text_blank":
        if info and info.label in ("科目", "分学科记录"):
            return f"{label}中的科目名称不能为空，请补全或删除空项"
        return f"{label}不能为空或只有空格"
    if code == "text_unicode":
        return f"{label}包含无效文本字符，请重新粘贴或输入"
    if info and info.kind == "exam_max_score":
        return f"{label}须为大于 0 且不超过 1000 的数字"
    if info and info.kind == "exam_score":
        return f"{label}须为 0 到该学生试卷满分之间的数字；待录入或缺考时请留空"
    if info and info.kind == "exam_status":
        return f"{label}须为待录入、已录入或缺考"
    if code in ("string_too_long", "too_long") and info and info.limit is not None:
        if info.kind in ("list", "object"):
            return f"{label}最多 {info.limit} 项，请删减后重试"
        return f"{label}不能超过 {info.limit} 字，请精简后重试"
    if code == "string_type":
        return f"{label}必须是文本，未填写时请留空，不能使用 null 或数字"
    if code == "literal_error" and info:
        if info.kind == "module":
            return f"{label}无效，只支持一对一、晚辅和班课"
        if info.kind == "length":
            return f"{label}无效，请选择简短或适中"
    if info and info.kind == "url":
        return "「API 地址」格式不正确；远程服务须使用 HTTPS，HTTP 仅限本机地址，地址不能包含账号、密码或查询参数"
    if info and info.kind == "key":
        return "「API Key」不能包含空格、换行或非英文字符，请检查后重新填写"
    if info and info.kind == "bool":
        return f"{label}格式不正确，请重新选择"
    if info and info.kind == "list":
        return f"{label}格式不正确，请使用科目列表"
    if info and info.kind == "object":
        return f"{label}格式不正确，请检查各项记录是否完整"
    return f"{label}格式不正确，请检查内容、日期或所属关系后重试"


def validation_detail(path: str, errors: list[dict]) -> str:
    if path == "/api/exports/feedback-docx":
        from .feedback_docx import export_validation_message
        messages = list(dict.fromkeys(export_validation_message(error) for error in errors))[:4]
        return "Word 未导出：" + "；".join(messages) + "。"
    prefix = {
        "/api/ai/generate": "暂时无法生成反馈",
        "/api/ai/settings": "AI 设置未保存",
        "/api/workspace": "数据未保存",
    }.get(path, "请求未完成")
    messages = []
    for error in errors:
        message = validation_message(error)
        if message not in messages:
            messages.append(message)
        if len(messages) == 4:
            break
    return prefix + "：" + "；".join(messages or ["输入格式不正确，请检查后重试"]) + "。"
