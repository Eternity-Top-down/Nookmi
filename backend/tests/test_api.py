from __future__ import annotations

import atexit
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from copy import deepcopy
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

import httpx
from fastapi.testclient import TestClient

# Importing the ASGI entry point creates its default app. Keep even that
# initialization inside a temporary directory, never in a teacher's real data.
_temporary_root = Path(__file__).resolve().parents[2] / ".local" / "tmp"
_temporary_root.mkdir(parents=True, exist_ok=True)
_bootstrap = tempfile.TemporaryDirectory(dir=_temporary_root)
_previous_data_dir = os.environ.get("NOOKMI_DATA_DIR")
os.environ["NOOKMI_DATA_DIR"] = _bootstrap.name
from backend.app.main import create_app  # noqa: E402
from backend.app.services.provider import AIProvider  # noqa: E402
if _previous_data_dir is None:
    os.environ.pop("NOOKMI_DATA_DIR", None)
else:
    os.environ["NOOKMI_DATA_DIR"] = _previous_data_dir
atexit.register(_bootstrap.cleanup)

NOW = "2026-10-21T08:00:00.000Z"
KEY = "sk-test-secret-never-return"


def student(identifier="student-1", module="one-to-one", class_id=None):
    return {
        "id": identifier, "module": module, "classId": class_id,
        "name": "测试学生", "grade": "七年级", "school": "", "guardian": "",
        "phone": "", "notes": "", "createdAt": NOW, "updatedAt": NOW,
    }


def group(identifier="class-1", module="evening"):
    return {
        "id": identifier, "module": module, "name": "测试班级",
        "grade": "七年级", "schedule": "", "notes": "", "createdAt": NOW,
    }


def observations(**changes):
    return {
        "performance": "", "strengths": "", "difficulties": "",
        "plan": "", "tasks": "", "subjects": {}, **changes,
    }


def brief(**changes):
    return {
        "periodStart": "2026-10-21", "periodEnd": "2026-10-21",
        "subjects": ["数学"], "teachingContent": "", "commonTasks": "",
        "focus": "", "length": "standard", **changes,
    }


def session(module="one-to-one", **changes):
    individual = module == "one-to-one"
    return {
        "id": "session-1", "module": module,
        "classId": None if individual else "class-1",
        "studentId": "student-1" if individual else None,
        "lessonAt": "2026-10-21T16:30",
        "entries": [{"studentId": "student-1" if individual else "student-2", "content": "能准确说明计算依据。"}],
        "createdAt": NOW, "updatedAt": NOW, **changes,
    }


def workspace():
    return {
        "schemaVersion": 1,
        "students": [student(), student("student-2", "evening", "class-1")],
        "classes": [group()],
        "records": [],
    }


class ApiTestCase(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=_temporary_root)
        self.app = create_app(self.directory.name)
        self.client = TestClient(self.app, base_url="http://127.0.0.1:8000")

    def tearDown(self):
        self.client.close()
        self.directory.cleanup()

    def put_workspace(self, data, revision=0):
        return self.client.put("/api/workspace", json={"data": data, "revision": revision})

    def configure(self):
        response = self.client.put("/api/ai/settings", json={
            "baseUrl": "https://api.example.test/v1", "model": "test-model", "apiKey": KEY,
        })
        self.assertEqual(response.status_code, 200, response.text)
        return response

    def provider(self, handler):
        self.app.state.provider = AIProvider(
            self.app.state.settings, transport=httpx.MockTransport(handler),
        )

    def generate_input(self, module="one-to-one", **changes):
        return {
            "module": module, "grade": "七年级",
            "brief": brief(teachingContent="有理数运算"),
            "observations": observations(performance="能说明运算步骤"),
            **changes,
        }


class WorkspaceTests(ApiTestCase):
    def test_health_and_empty_workspace(self):
        self.assertEqual(self.client.get("/api/health").json()["ok"], True)
        state = self.client.get("/api/workspace").json()
        self.assertEqual(state["revision"], 0)
        self.assertEqual(state["data"], {
            "schemaVersion": 1, "students": [], "classes": [], "records": [],
        })

    def test_save_reload_restart_and_legacy_shape(self):
        data = workspace()
        response = self.put_workspace(data)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"data": data, "revision": 1})
        restarted = TestClient(create_app(self.directory.name), base_url="http://localhost:8000")
        try:
            self.assertEqual(restarted.get("/api/workspace").json(), response.json())
        finally:
            restarted.close()
        with closing(sqlite3.connect(Path(self.directory.name) / "nookmi.sqlite3")) as connection:
            names = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertTrue({"students", "classes", "records", "feedback_sessions", "feedback_entries"}.issubset(names))

    def test_revision_conflict_preserves_existing_data(self):
        data = workspace()
        self.assertEqual(self.put_workspace(data).status_code, 200)
        changed = deepcopy(data)
        changed["students"][0]["name"] = "另一窗口的修改"
        self.assertEqual(self.put_workspace(changed, 0).status_code, 409)
        self.assertEqual(self.client.get("/api/workspace").json(), {"data": data, "revision": 1})

    def test_concurrent_writes_cannot_overwrite_each_other(self):
        first, second = workspace(), workspace()
        first["students"][0]["name"] = "版本甲"
        second["students"][0]["name"] = "版本乙"
        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(lambda data: self.put_workspace(data), (first, second)))
        self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
        winner = next(response.json() for response in responses if response.status_code == 200)
        self.assertEqual(self.client.get("/api/workspace").json(), winner)

    def test_transaction_rolls_back_if_database_write_fails(self):
        data = workspace()
        self.assertEqual(self.put_workspace(data).status_code, 200)
        with closing(sqlite3.connect(Path(self.directory.name) / "nookmi.sqlite3")) as connection:
            connection.execute("CREATE TRIGGER reject_student BEFORE INSERT ON students BEGIN SELECT RAISE(ABORT,'test rollback'); END")
            connection.commit()
        changed = deepcopy(data)
        changed["students"][0]["name"] = "不应保存"
        response = self.put_workspace(changed, 1)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.client.get("/api/workspace").json(), {"data": data, "revision": 1})

    def test_legacy_feedback_and_new_facts_round_trip(self):
        data = workspace()
        data["feedbackSessions"] = [session()]
        self.assertEqual(self.put_workspace(data).json()["data"], data)
        entry = data["feedbackSessions"][0]["entries"][0]
        entry.update({
            "content": "",
            "observations": observations(performance="计算准确", subjects={"数学": "订正完成"}),
            "reviewed": False, "generationSource": "manual", "generatedFrom": "hash-v1",
        })
        data["feedbackSessions"][0]["brief"] = brief(teachingContent="有理数运算")
        response = self.put_workspace(data, 1)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"], data)
        self.assertEqual(self.client.get("/api/workspace").json()["data"], data)

    def test_shared_only_and_plan_only_drafts_are_saved(self):
        for draft in [
            session(brief=brief(teachingContent="本周复习内容"), entries=[{"studentId": "student-1", "content": ""}]),
            session(entries=[{"studentId": "student-1", "content": "", "observations": observations(plan="后续关注计算习惯")}]),
        ]:
            with self.subTest(draft=draft):
                data = workspace()
                data["feedbackSessions"] = [draft]
                revision = self.client.get("/api/workspace").json()["revision"]
                response = self.put_workspace(data, revision)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["data"], data)

    def test_class_common_brief_survives_removal_of_its_last_student(self):
        data = workspace()
        data["students"] = [data["students"][0]]
        data["feedbackSessions"] = [session(
            "evening", entries=[], brief=brief(teachingContent="全班共用课程内容"),
        )]
        response = self.put_workspace(data)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"], data)
        invalid = workspace()
        invalid["feedbackSessions"] = [session(entries=[], brief=brief(teachingContent="共用内容"))]
        self.assertEqual(self.put_workspace(invalid, 1).status_code, 422)

    def test_empty_metadata_only_draft_is_rejected(self):
        data = workspace()
        data["feedbackSessions"] = [session(
            brief=brief(), entries=[{"studentId": "student-1", "content": ""}],
        )]
        self.assertEqual(self.put_workspace(data).status_code, 422)

    def test_class_feedback_relationships_and_duplicate_entry_validation(self):
        for mutate in [
            lambda data: data["students"][1].update(classId="missing"),
            lambda data: data["feedbackSessions"][0].update(classId="missing"),
            lambda data: data["feedbackSessions"][0]["entries"][0].update(studentId="student-1"),
            lambda data: data["feedbackSessions"][0]["entries"].append(deepcopy(data["feedbackSessions"][0]["entries"][0])),
            lambda data: data["feedbackSessions"][0].update(id="student-1"),
        ]:
            data = workspace()
            data["feedbackSessions"] = [session("evening")]
            mutate(data)
            with self.subTest(data=data):
                self.assertEqual(self.put_workspace(data).status_code, 422)
        valid = workspace()
        valid["feedbackSessions"] = [session("evening")]
        self.assertEqual(self.put_workspace(valid).status_code, 200)

    def test_dates_lengths_strict_types_and_invalid_unicode(self):
        mutations = [
            lambda data: data.update(schemaVersion=True),
            lambda data: data["students"][0].update(phone=123),
            lambda data: data["students"][0].update(id="\ud800"),
            lambda data: data["students"][0].update(createdAt="2026-02-30T08:00:00Z"),
            lambda data: data["feedbackSessions"][0].update(lessonAt="1899-12-31T16:30"),
            lambda data: data["feedbackSessions"][0].update(lessonAt="2101-01-01T16:30"),
            lambda data: data["feedbackSessions"][0].update(lessonAt="2026-10-21T24:00"),
            lambda data: data["feedbackSessions"][0]["entries"][0].update(content="字" * 10001),
            lambda data: data["feedbackSessions"][0]["entries"][0].update(reviewed="false"),
            lambda data: data["feedbackSessions"][0]["entries"][0].update(observations=None),
            lambda data: data["feedbackSessions"][0].update(brief=brief(periodStart="2026-10-22")),
            lambda data: data["feedbackSessions"][0].update(brief=brief(subjects=["数学", " 数学 "])),
        ]
        for mutate in mutations:
            data = workspace()
            data["feedbackSessions"] = [session()]
            mutate(data)
            with self.subTest(mutation=mutate):
                # ensure_ascii preserves the intentional malformed-surrogate test input.
                response = self.client.put("/api/workspace", content=json.dumps({"data": data, "revision": 0}), headers={"Content-Type": "application/json"})
                self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.client.get("/api/workspace").json()["revision"], 0)

    def test_teaching_records_match_legacy_content_and_date_limits(self):
        data = workspace()
        record = {"id": "record-1", "studentId": "student-1", "date": "2026-10-21", "content": "字" * 5000, "createdAt": NOW}
        data["records"] = [record]
        self.assertEqual(self.put_workspace(data).status_code, 200)
        record["content"] += "字"
        self.assertEqual(self.put_workspace(data, 1).status_code, 422)
        record["content"] = "课堂记录"
        record["date"] = "1899-12-31"
        self.assertEqual(self.put_workspace(data, 1).status_code, 422)

    def test_deleting_all_data_is_atomic_and_can_preserve_empty_feedback_list(self):
        data = workspace()
        data["feedbackSessions"] = [session("evening")]
        self.assertEqual(self.put_workspace(data).status_code, 200)
        empty = {"schemaVersion": 1, "students": [], "classes": [], "records": [], "feedbackSessions": []}
        self.assertEqual(self.put_workspace(empty, 1).json(), {"data": empty, "revision": 2})


class LocalAccessTests(ApiTestCase):
    def test_rejects_foreign_host_origin_and_cross_site_calls(self):
        for headers in [
            {"Host": "evil.example"},
            {"Origin": "https://evil.example"},
            {"Origin": "null"},
            {"Origin": "http://localhost.evil.example"},
            {"Origin": "http://localhost@evil.example"},
            {"Origin": "http://127.0.0.1:bad"},
            {"Sec-Fetch-Site": "cross-site"},
        ]:
            with self.subTest(headers=headers):
                response = self.client.get("/api/ai/settings", headers=headers)
                self.assertEqual(response.status_code, 403)
                response = self.client.post("/api/ai/test", headers=headers)
                self.assertEqual(response.status_code, 403)

    def test_allows_loopback_hosts_and_local_preflight(self):
        for host in ("localhost:8000", "127.0.0.1:8000", "[::1]:8000"):
            self.assertEqual(self.client.get("/api/health", headers={"Host": host}).status_code, 200)
        response = self.client.options("/api/ai/settings", headers={
            "Origin": "http://localhost:5173", "Access-Control-Request-Method": "PUT",
        })
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://localhost:5173")
        self.assertNotEqual(response.headers["Access-Control-Allow-Origin"], "*")

    def test_payload_limit_and_no_cache(self):
        response = self.client.put("/api/workspace", content="{}", headers={"Content-Length": "20000001"})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.client.get("/api/ai/settings").headers["Cache-Control"], "no-store")


class SettingsTests(ApiTestCase):
    def test_defaults_and_missing_configuration(self):
        response = self.client.get("/api/ai/settings")
        self.assertFalse(response.json()["configured"])
        self.assertFalse(response.json()["hasApiKey"])
        self.assertNotIn("apiKey", response.json())
        self.assertEqual(self.client.post("/api/ai/test").status_code, 503)
        self.assertEqual(self.client.post("/api/ai/generate", json=self.generate_input()).status_code, 503)

    def test_key_is_private_empty_key_preserves_and_explicit_clear_removes_it(self):
        response = self.configure()
        self.assertNotIn(KEY, response.text)
        self.assertTrue(response.json()["configured"])
        response = self.client.put("/api/ai/settings", json={
            "baseUrl": "https://api.example.test/v1/", "model": "new-model", "apiKey": "",
        })
        self.assertTrue(response.json()["hasApiKey"])
        self.assertEqual(self.app.state.settings.read_private()["apiKey"], KEY)
        self.assertNotIn(KEY, self.client.get("/api/ai/settings").text)
        with open(Path(self.directory.name) / "ai-settings.json", encoding="utf-8") as file:
            self.assertEqual(json.load(file)["apiKey"], KEY)
        response = self.client.put("/api/ai/settings", json={
            "baseUrl": "https://api.example.test/v1", "model": "new-model", "clearApiKey": True,
        })
        self.assertFalse(response.json()["hasApiKey"])
        self.assertFalse(response.json()["configured"])

    def test_rejects_invalid_settings_without_echoing_secret(self):
        for payload in [
            {"baseUrl": "https://user:password@example.test", "model": "m", "apiKey": KEY},
            {"baseUrl": "https://example.test?api_key=" + KEY, "model": "m", "apiKey": KEY},
            {"baseUrl": "ftp://example.test", "model": "m", "apiKey": KEY},
            {"baseUrl": "http://example.test/v1", "model": "m", "apiKey": KEY},
            {"baseUrl": "https://example.test", "model": "m", "apiKey": KEY, "clearApiKey": True},
            {"baseUrl": "https://example.test", "model": "m", "apiKey": KEY + "\ninvalid"},
        ]:
            response = self.client.put("/api/ai/settings", json=payload)
            self.assertEqual(response.status_code, 422)
            self.assertNotIn(KEY, response.text)

    def test_malformed_settings_file_returns_safe_error(self):
        (Path(self.directory.name) / "ai-settings.json").write_text('{"apiKey":"' + KEY, encoding="utf-8")
        response = self.client.get("/api/ai/settings")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(KEY, response.text)


class ProviderTests(ApiTestCase):
    def test_local_provider_can_use_no_key_and_omits_authorization(self):
        response = self.client.put("/api/ai/settings", json={
            "baseUrl": "http://127.0.0.1:11434/v1", "model": "local-model",
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["configured"])
        self.assertFalse(response.json()["hasApiKey"])
        captured = []

        def handler(request):
            captured.append(request)
            return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

        self.provider(handler)
        self.assertEqual(self.client.post("/api/ai/test").status_code, 200)
        self.assertNotIn("authorization", captured[0].headers)

    def test_real_provider_request_contract_and_minimal_connection_test(self):
        self.configure()
        captured = []

        def handler(request):
            captured.append(request)
            return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

        self.provider(handler)
        response = self.client.post("/api/ai/test")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(captured), 1)
        request = captured[0]
        self.assertEqual(str(request.url), "https://api.example.test/v1/chat/completions")
        self.assertEqual(request.headers["Authorization"], f"Bearer {KEY}")
        payload = json.loads(request.content)
        self.assertEqual(set(payload), {"model", "messages"})
        self.assertEqual(payload["model"], "test-model")
        self.assertEqual(len(payload["messages"]), 1)
        self.assertNotIn("测试学生", json.dumps(payload, ensure_ascii=False))
        self.assertNotIn(KEY, response.text)

    def test_generation_uses_module_specific_fact_grounded_prompts_without_identifiers(self):
        self.configure()
        captured = []

        def handler(request):
            captured.append(json.loads(request.content))
            return httpx.Response(200, json={"choices": [{"message": {"content": " 本次能说明计算依据，建议继续关注符号。 "}}]})

        self.provider(handler)
        for module, label in (("one-to-one", "一对一"), ("evening", "晚辅"), ("course", "班课")):
            response = self.client.post("/api/ai/generate", json=self.generate_input(module))
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), {"content": "本次能说明计算依据，建议继续关注符号。", "model": "test-model"})
            system = captured[-1]["messages"][0]["content"]
            self.assertIn(label, system)
            self.assertIn("不得编造", system)
            self.assertIn("不得自行发明题号", system)
            self.assertIn("建议语气", system)
            user = captured[-1]["messages"][1]["content"]
            self.assertIn("能说明运算步骤", user)
            self.assertNotIn("studentId", user)
            self.assertNotIn("guardian", user)
            self.assertNotIn("测试学生", user)

    def test_rejects_no_personal_facts_and_extra_identity_fields_before_provider_call(self):
        self.configure()
        called = []
        self.provider(lambda request: called.append(request))
        for observation in (observations(), observations(plan="建议复习"), observations(tasks="完成练习")):
            response = self.client.post("/api/ai/generate", json=self.generate_input(observations=observation))
            self.assertEqual(response.status_code, 422)
        response = self.client.post("/api/ai/generate", json={**self.generate_input(), "studentName": "真实姓名不应上传"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(called, [])

    def test_subject_observations_alone_allow_evening_generation(self):
        self.configure()
        self.provider(lambda _request: httpx.Response(200, json={"choices": [{"message": {"content": "数学错题已订正。"}}]}))
        response = self.client.post("/api/ai/generate", json=self.generate_input(
            "evening", observations=observations(subjects={"数学": "错题已订正"}),
        ))
        self.assertEqual(response.status_code, 200)

    def test_remote_errors_do_not_leak_response_bodies_or_credentials(self):
        self.configure()
        for remote_status, expected in ((401, 502), (403, 502), (429, 429), (500, 502)):
            self.provider(lambda _request, status=remote_status: httpx.Response(status, text=f"secret diagnostic {KEY}"))
            response = self.client.post("/api/ai/test")
            self.assertEqual(response.status_code, expected)
            self.assertNotIn(KEY, response.text)
            self.assertNotIn("secret diagnostic", response.text)

    def test_redirect_is_not_followed_and_does_not_expose_authorization(self):
        self.configure()
        captured = []

        def handler(request):
            captured.append(str(request.url))
            return httpx.Response(307, headers={"Location": "https://attacker.example/steal"})

        self.provider(handler)
        response = self.client.post("/api/ai/test")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(captured, ["https://api.example.test/v1/chat/completions"])
        self.assertNotIn(KEY, response.text)

    def test_timeout_and_transport_errors_are_safely_reported(self):
        self.configure()
        for exception, expected in ((httpx.ReadTimeout, 504), (httpx.ConnectError, 502)):
            def handler(request, error=exception):
                raise error(f"transport diagnostic {KEY}", request=request)
            self.provider(handler)
            response = self.client.post("/api/ai/test")
            self.assertEqual(response.status_code, expected)
            self.assertNotIn(KEY, response.text)
            self.assertNotIn("transport diagnostic", response.text)

    def test_malformed_empty_oversized_and_secret_reflecting_outputs_are_rejected(self):
        self.configure()
        for body in (
            {}, {"choices": []},
            {"choices": [{"message": {"content": " "}}]},
            {"choices": [{"message": {"content": ["not text"]}}]},
            {"choices": [{"message": {"content": "字" * 10001}}]},
            {"choices": [{"message": {"content": KEY}}]},
        ):
            self.provider(lambda _request, value=body: httpx.Response(200, json=value))
            response = self.client.post("/api/ai/test")
            self.assertEqual(response.status_code, 502)
            self.assertNotIn(KEY, response.text)


if __name__ == "__main__":
    unittest.main()
