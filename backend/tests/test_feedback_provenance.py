"""Adopted feedback provenance survives storage without becoming a generation log."""
from copy import deepcopy
from pathlib import Path
import json
import tempfile
import unittest

from pydantic import ValidationError

from backend.app.database import Database
from backend.app.schemas import AppData, FeedbackSession
from backend.app.services.validation import validation_detail


NOW = "2026-10-22T08:00:00.000Z"
TEMP_ROOT = Path(__file__).resolve().parents[2] / ".local" / "test-temp"


def fixture(module="one-to-one"):
    individual = module == "one-to-one"
    snapshot = {
        "module": module, "grade": "七年级", "lessonAt": "2026-10-22T16:30",
        "brief": {
            "periodStart": "2026-10-22", "periodEnd": "2026-10-22", "subjects": ["数学"],
            "teachingContent": "一元一次方程", "commonTasks": "", "focus": "", "length": "standard",
        },
        "observations": {
            "performance": "能列式，移项漏负号", "strengths": "", "difficulties": "",
            "plan": "", "tasks": "", "subjects": {},
        },
    }
    source = {
        "id": "source-1", "sessionId": "session-1", "studentId": "student-1",
        "content": "AI 原稿：列式清楚，计算需要关注符号。", "input": snapshot,
        "createdAt": NOW, "model": "test-model",
    }
    entry = {
        "studentId": "student-1", "content": "最终稿：能列式，移项时需要注意负号。", "reviewed": True,
        "comparison": {
            "source": source, "finalContent": "最终稿：能列式，移项时需要注意负号。",
            "finalInput": deepcopy(snapshot), "confirmedAt": NOW,
        },
    }
    session = {
        "id": "session-1", "module": module, "classId": None if individual else "class-1",
        "studentId": "student-1" if individual else None, "lessonAt": snapshot["lessonAt"],
        "entries": [entry], "createdAt": NOW, "updatedAt": NOW,
    }
    student = {
        "id": "student-1", "name": "测试学生", "grade": "八年级", "school": "", "guardian": "",
        "phone": "", "notes": "", "module": module, "classId": session["classId"],
        "createdAt": NOW, "updatedAt": NOW,
    }
    return {
        "schemaVersion": 1, "records": [], "students": [student], "feedbackSessions": [session],
        "classes": [] if individual else [{
            "id": "class-1", "module": module, "name": "测试班", "grade": "八年级",
            "schedule": "", "notes": "", "createdAt": NOW,
        }],
    }


def entry_of(data):
    return data["feedbackSessions"][0]["entries"][0]


class FeedbackProvenanceTests(unittest.TestCase):
    def test_roundtrip_all_modules_keeps_source_and_final_input_independent_of_current_grade(self):
        for module in ("one-to-one", "evening", "course"):
            with self.subTest(module=module):
                data = fixture(module)
                restored = AppData.model_validate(data).payload()
                self.assertEqual(restored, data)
                self.assertEqual(entry_of(restored)["comparison"]["source"]["input"]["grade"], "七年级")
                self.assertEqual(restored["students"][0]["grade"], "八年级")

    def test_previous_adoption_may_remain_during_editing_but_reviewed_final_must_match(self):
        data = fixture()
        entry = entry_of(data)
        entry["reviewed"] = False
        entry["content"] = "正在修改的新稿"
        entry["aiDraft"] = deepcopy(entry["comparison"]["source"])
        entry["aiDraft"]["id"] = "current-source"
        self.assertEqual(AppData.model_validate(data).payload(), data)
        entry["reviewed"] = True
        with self.assertRaises(ValidationError):
            AppData.model_validate(data)

    def test_legacy_reviewed_feedback_does_not_need_a_fabricated_ai_source(self):
        data = fixture()
        del entry_of(data)["comparison"]
        self.assertEqual(AppData.model_validate(data).payload(), data)

    def test_rejects_invalid_source_shape_dates_limits_and_cross_target_provenance(self):
        mutations = [
            ("comparison", None), ("aiDraft", None),
            ("comparison.source", []), ("comparison.finalInput", None),
            ("comparison.source.sessionId", "other-session"),
            ("comparison.source.studentId", "other-student"),
            ("comparison.source.input.module", "evening"),
            ("comparison.finalInput.module", "course"),
            ("comparison.source.id", " "), ("comparison.source.id", "i" * 129),
            ("comparison.source.content", " \n"), ("comparison.source.content", "字" * 10001),
            ("comparison.finalContent", "字" * 10001), ("comparison.source.model", "m" * 201),
            ("comparison.source.model", 42), ("comparison.source.input.grade", "字" * 51),
            ("comparison.source.createdAt", "2026-02-30T08:00:00.000Z"),
            ("comparison.confirmedAt", "2101-01-01T08:00:00.000Z"),
            ("comparison.source.input.lessonAt", "2026-02-30T16:30"),
            ("comparison.finalInput.brief.periodEnd", "2026-02-30"),
            ("comparison.source.input.observations.performance", False),
            ("comparison.finalInput.observations.performance", "字" * 2001),
            ("comparison.source.input.observations.performance", "\ud800"),
            ("comparison.source.unrecognized", "must not silently discard"),
            ("comparison.source.input.brief.unrecognized", "must not silently discard"),
        ]
        for path, value in mutations:
            with self.subTest(path=path, value=str(value)[:30]):
                data = fixture()
                target = entry_of(data)
                keys = path.split(".")
                for key in keys[:-1]:
                    target = target[key]
                target[keys[-1]] = value
                with self.assertRaises(ValidationError):
                    FeedbackSession.model_validate(data["feedbackSessions"][0])

    def test_ai_draft_is_scoped_even_without_adoption(self):
        data = fixture("course")
        entry = entry_of(data)
        entry["aiDraft"] = entry.pop("comparison")["source"]
        entry["reviewed"] = False
        self.assertEqual(AppData.model_validate(data).payload(), data)
        entry["aiDraft"]["studentId"] = "another-student"
        with self.assertRaises(ValidationError):
            AppData.model_validate(data)

    def test_validation_errors_name_the_recovery_record_without_echoing_student_text(self):
        cases = [
            ("comparison.source.studentId", "secret-student-name", "当前学生或反馈不一致"),
            ("comparison.finalContent", "secret-final-feedback", "重新确认采用"),
            ("comparison", None, "修改对比记录不完整"),
            ("comparison.source.input.observations.performance", "secret-observation" * 200, "生成时原始记录的课堂情况"),
            ("comparison.source.createdAt", "secret-invalid-date", "AI 原稿的生成时间"),
            ("comparison.finalInput.observations.subjects.secret-subject", False, "采用时原始记录的分学科记录内容"),
            ("comparison.source.secret-unknown-field", "secret-body", "已采用反馈的 AI 原稿"),
        ]
        for path, value, expected in cases:
            with self.subTest(path=path):
                data = fixture()
                target = entry_of(data)
                keys = path.split(".")
                for key in keys[:-1]:
                    target = target[key]
                target[keys[-1]] = value
                with self.assertRaises(ValidationError) as caught:
                    AppData.model_validate(data)
                errors = [{**error, "loc": ("body", "data") + error["loc"]} for error in caught.exception.errors()]
                message = validation_detail("/api/workspace", errors)
                self.assertIn(expected, message)
                self.assertIn("本机草稿仍保留", message)
                self.assertNotIn("secret", message)
                self.assertNotIn("该项信息", message)

    def test_database_reopen_backup_restore_and_delete_leave_no_active_provenance_rows(self):
        TEMP_ROOT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as directory:
            root = Path(directory)
            database = Database(root / "original")
            data = fixture("course")
            database.replace(AppData.model_validate(data), 0)
            reopened = Database(root / "original")
            saved = reopened.read()
            self.assertEqual(saved["data"], data)
            backup = json.loads(json.dumps(saved["data"], ensure_ascii=False))
            restored = Database(root / "restored")
            restored.replace(AppData.model_validate(backup), 0)
            self.assertEqual(restored.read()["data"], data)

            # A new accepted result replaces the one provenance object, not an append-only history.
            entry = entry_of(backup)
            entry["comparison"]["source"]["id"] = "source-2"
            entry["comparison"]["source"]["content"] = "新原稿"
            restored.replace(AppData.model_validate(backup), 1)
            with restored.connect() as connection:
                rows = connection.execute("SELECT payload FROM feedback_entries").fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(json.loads(rows[0]["payload"])["comparison"]["source"]["id"], "source-2")

            # Clear the feedback while retaining the student: payload disappears with the entry.
            backup["feedbackSessions"] = []
            restored.replace(AppData.model_validate(backup), 2)
            with restored.connect() as connection:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM feedback_entries").fetchone()[0], 0)
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM feedback_sessions").fetchone()[0], 0)
            self.assertEqual(len(restored.read()["data"]["students"]), 1)

            # Recreate then delete the student and their feedback, without retaining an archive elsewhere.
            restored.replace(AppData.model_validate(data), 3)
            data["students"] = []
            data["feedbackSessions"] = []
            restored.replace(AppData.model_validate(data), 4)
            self.assertEqual(restored.read()["data"], data)
            with restored.connect() as connection:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM feedback_entries").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
