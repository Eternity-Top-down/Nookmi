from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
import sqlite3

from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.tests.test_api import ApiTestCase, NOW, create_app, group, student
from backend.app.schemas import AppData


def exam_workspace():
    entries = [
        {"studentId": "course-1", "school": "第一学校", "maxScore": 150, "score": 112.5, "status": "recorded"},
        {"studentId": "course-2", "school": "第二学校", "maxScore": 100, "score": 0, "status": "recorded"},
        {"studentId": "course-3", "school": "", "maxScore": 120, "score": None, "status": "pending"},
        {"studentId": "course-4", "school": "第一学校", "maxScore": 150, "score": None, "status": "absent"},
    ]
    return {
        "schemaVersion": 1,
        "classes": [group("course-class", "course"), group("other-class", "course"), group("evening", "evening")],
        "students": [student(entry["studentId"], "course", "course-class") for entry in entries]
            + [student("other-student", "course", "other-class")],
        "records": [],
        "exams": [{"id": "exam-1", "classId": "course-class", "name": "第一次月考", "subject": "数学",
            "date": "2026-10-21", "defaultMaxScore": 150, "entries": entries, "createdAt": NOW, "updatedAt": NOW}],
    }


class ExamTests(ApiTestCase):
    def test_decimal_zero_pending_absent_and_school_snapshots_round_trip_and_restart(self):
        data = exam_workspace()
        data["students"][0]["school"] = "转学后学校"
        response = self.put_workspace(data)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"data": data, "revision": 1})
        with TestClient(create_app(self.directory.name), base_url="http://localhost:8000") as restarted:
            self.assertEqual(restarted.get("/api/workspace").json(), response.json())
        with closing(sqlite3.connect(Path(self.directory.name) / "nookmi.sqlite3")) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM exams").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM exam_entries").fetchone()[0], 4)
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_legacy_shape_empty_exams_and_restoring_pre_exam_backup(self):
        data = exam_workspace()
        legacy = {key: value for key, value in data.items() if key != "exams"}
        for revision, payload in enumerate((legacy, {**legacy, "exams": []}, data, legacy)):
            response = self.put_workspace(payload, revision)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["data"], payload)
        with closing(sqlite3.connect(Path(self.directory.name) / "nookmi.sqlite3")) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM exams").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM exam_entries").fetchone()[0], 0)

    def test_existing_database_gains_exam_tables_without_touching_legacy_data(self):
        data = exam_workspace()
        del data["exams"]
        self.assertEqual(self.put_workspace(data).status_code, 200)
        with closing(sqlite3.connect(Path(self.directory.name) / "nookmi.sqlite3")) as connection:
            connection.executescript("DROP TABLE exam_entries; DROP TABLE exams;")
        with TestClient(create_app(self.directory.name), base_url="http://localhost:8000") as upgraded:
            self.assertEqual(upgraded.get("/api/workspace").json(), {"data": data, "revision": 1})
            saved = upgraded.put("/api/workspace", json={"data": exam_workspace(), "revision": 1})
            self.assertEqual(saved.status_code, 200, saved.text)

    def test_invalid_scores_statuses_and_limits(self):
        changes = [
            ("score", -1), ("score", 151), ("score", None), ("score", True), ("score", "100"),
            ("maxScore", 0), ("maxScore", 1001), ("maxScore", False), ("maxScore", "150"),
            ("school", "校" * 121), ("status", "bad"), ("status", "pending"), ("status", "absent"),
        ]
        for field, value in changes:
            with self.subTest(field=field, value=value):
                data = exam_workspace()
                data["exams"][0]["entries"][0][field] = value
                response = self.put_workspace(data)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertNotIn("第一学校", response.text)
        for value in (float("nan"), float("inf"), float("-inf")):
            data = exam_workspace()
            data["exams"][0]["entries"][0]["score"] = value
            with self.assertRaises(ValidationError):
                AppData.model_validate(data)
        self.assertEqual(self.client.get("/api/workspace").json()["revision"], 0)

    def test_invalid_metadata_relationships_and_duplicates(self):
        changes = [("name", " "), ("name", "考" * 101), ("subject", ""), ("subject", "科" * 51),
            ("date", "2026-02-30"), ("date", "1899-12-31"), ("defaultMaxScore", 0),
            ("defaultMaxScore", True), ("defaultMaxScore", "150"), ("defaultMaxScore", 1001),
            ("classId", "evening"), ("classId", "missing"), ("id", "course-1")]
        for field, value in changes:
            with self.subTest(field=field, value=value):
                data = exam_workspace()
                data["exams"][0][field] = value
                self.assertEqual(self.put_workspace(data).status_code, 422)
        for identifier in ("other-student", "missing"):
            data = exam_workspace()
            data["exams"][0]["entries"][0]["studentId"] = identifier
            response = self.put_workspace(data)
            self.assertEqual(response.status_code, 422)
            self.assertIn("成绩学生不属于", response.json()["detail"])
        data = exam_workspace()
        data["exams"][0]["entries"].append(deepcopy(data["exams"][0]["entries"][0]))
        self.assertEqual(self.put_workspace(data).status_code, 422)
        data = exam_workspace()
        data["exams"].append(deepcopy(data["exams"][0]))
        self.assertEqual(self.put_workspace(data).status_code, 422)
        data = exam_workspace()
        data["exams"] = None
        self.assertEqual(self.put_workspace(data).status_code, 422)

    def test_reject_missing_null_score_and_oversized_collections(self):
        data = exam_workspace()
        del data["exams"][0]["entries"][2]["score"]
        self.assertEqual(self.put_workspace(data).status_code, 422)
        data = exam_workspace()
        data["exams"][0]["entries"] = [data["exams"][0]["entries"][0]] * 50_001
        with self.assertRaises(ValidationError):
            AppData.model_validate(data)
        data = exam_workspace()
        data["exams"] = [data["exams"][0]] * 20_001
        with self.assertRaises(ValidationError):
            AppData.model_validate(data)

    def test_atomic_rollback_preserves_all_exam_scores_and_revision(self):
        data = exam_workspace()
        self.assertEqual(self.put_workspace(data).status_code, 200)
        with closing(sqlite3.connect(Path(self.directory.name) / "nookmi.sqlite3")) as connection:
            connection.execute("CREATE TRIGGER reject_exam_entry BEFORE INSERT ON exam_entries BEGIN SELECT RAISE(ABORT,'test rollback'); END")
            connection.commit()
        changed = deepcopy(data)
        changed["exams"][0]["entries"][0]["score"] = 120
        self.assertEqual(self.put_workspace(changed, 1).status_code, 503)
        self.assertEqual(self.client.get("/api/workspace").json(), {"data": data, "revision": 1})

    def test_concurrent_exam_writes_cannot_silently_overwrite(self):
        first, second = exam_workspace(), exam_workspace()
        second["exams"][0]["entries"][0]["score"] = 130
        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(lambda data: self.put_workspace(data), (first, second)))
        self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
        winner = next(response.json() for response in responses if response.status_code == 200)
        self.assertEqual(self.client.get("/api/workspace").json(), winner)

    def test_delete_exam_or_student_entries_keeps_other_scores(self):
        data = exam_workspace()
        self.assertEqual(self.put_workspace(data).status_code, 200)
        data["students"] = data["students"][1:]
        data["exams"][0]["entries"] = data["exams"][0]["entries"][1:]
        self.assertEqual(self.put_workspace(data, 1).json()["data"], data)
        data["exams"] = []
        self.assertEqual(self.put_workspace(data, 2).json()["data"], data)
