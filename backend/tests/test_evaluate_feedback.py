"""Evaluation selection and evidence recording without settings or network access."""
from contextlib import redirect_stderr, redirect_stdout
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from backend.evals import evaluate_feedback as evaluate
from backend.app.services.feedback import REVIEW_WARNING
from backend.app.services.provider import ProviderError


SPARSE_CASES = evaluate.CASES_PATH.with_name("sparse_feedback_cases.json")
TEST_TEMP = evaluate.ROOT / ".local" / "test-temp"


class EvaluationRunnerTests(unittest.TestCase):
    def setUp(self):
        TEST_TEMP.mkdir(parents=True, exist_ok=True)

    def invoke(self, *args):
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(evaluate.sys, "argv", ["evaluate_feedback.py", *args]), \
                redirect_stdout(output), redirect_stderr(errors):
            result = evaluate.main()
        return result, output.getvalue(), errors.getvalue()

    def test_original_and_sparse_suites_remain_independent_and_valid(self):
        original = evaluate.load_cases()
        sparse = evaluate.load_cases(SPARSE_CASES)
        self.assertEqual(len(original["cases"]), 13)
        self.assertEqual(len(sparse["cases"]), 15)
        self.assertTrue({case["id"] for case in original["cases"]}.isdisjoint(
            case["id"] for case in sparse["cases"]
        ))

    def test_dry_run_filters_before_limit_and_never_opens_settings(self):
        with patch.object(evaluate, "SettingsStore") as settings, \
                patch.object(evaluate, "EvaluationProvider") as provider:
            status, output, _ = self.invoke(
                "--cases-file", str(SPARSE_CASES), "--module", "evening",
                "--case", "sparse-evening-uncertain",
                "--case", "sparse-evening-single-chat", "--limit", "1",
            )
        self.assertEqual(status, 0)
        self.assertIn("sparse-evening-single-chat | evening", output)
        self.assertNotIn("sparse-evening-uncertain |", output)
        self.assertNotIn("sparse-one-to-one-sign |", output)
        settings.assert_not_called()
        provider.assert_not_called()

    def test_empty_selection_and_unknown_ids_fail_before_settings_even_in_run_mode(self):
        for filters in (
            ["--module", "course", "--case", "sparse-evening-single-chat"],
            ["--case", "not-a-real-case"],
        ):
            with self.subTest(filters=filters), \
                    patch.object(evaluate, "SettingsStore") as settings, \
                    patch.object(evaluate, "EvaluationProvider") as provider:
                with self.assertRaises(SystemExit) as error:
                    self.invoke("--run", "--cases-file", str(SPARSE_CASES), *filters)
                self.assertEqual(error.exception.code, 2)
                settings.assert_not_called()
                provider.assert_not_called()

    def test_invalid_request_and_duplicate_ids_are_rejected_without_reading_settings(self):
        suite = evaluate.load_cases(SPARSE_CASES)
        invalid = copy.deepcopy(suite)
        invalid["cases"][0]["request"]["brief"]["periodStart"] = "not-a-date"
        duplicate = copy.deepcopy(suite)
        duplicate["cases"].append(copy.deepcopy(duplicate["cases"][0]))
        with tempfile.TemporaryDirectory(dir=TEST_TEMP) as temporary:
            path = Path(temporary) / "invalid.json"
            for content in (invalid, duplicate):
                with self.subTest(duplicate=content is duplicate):
                    path.write_text(json.dumps(content, ensure_ascii=False), encoding="utf-8")
                    with patch.object(evaluate, "SettingsStore") as settings:
                        status, _, errors = self.invoke("--run", "--cases-file", str(path))
                    self.assertEqual(status, 2)
                    self.assertIn("未调用模型", errors)
                    settings.assert_not_called()

    def test_recorded_product_pipeline_keeps_draft_final_and_review_failure_distinct(self):
        # All values are fake. Mocking the base provider bypasses HTTP entirely.
        for review in (
            {"content": "经过提醒后能继续推导。", "model": "fake-model"},
            ProviderError("safe review failure", 504),
        ):
            with self.subTest(review_failed=isinstance(review, Exception)), \
                    tempfile.TemporaryDirectory(dir=TEST_TEMP) as temporary:
                fake_settings = Mock()
                fake_settings.read_private.return_value = {
                    "model": "fake-model", "apiKey": "FAKE_SECRET_SENTINEL",
                    "baseUrl": "https://fake-private-endpoint.invalid/v1",
                }
                fake_settings.public.return_value = {"configured": True}
                draft = {"content": "最初反馈。", "model": "fake-model"}
                with patch.object(evaluate, "SettingsStore", return_value=fake_settings), \
                        patch.object(evaluate.AIProvider, "complete", side_effect=[draft, review]) as complete:
                    status, output, _ = self.invoke(
                        "--run", "--cases-file", str(SPARSE_CASES),
                        "--case", "sparse-course-condition-transform", "--output-dir", temporary,
                    )
                self.assertEqual(status, 0)
                self.assertEqual(complete.call_count, 2)
                reports = list(Path(temporary).glob("*/report.json"))
                self.assertEqual(len(reports), 1)
                raw = reports[0].read_text(encoding="utf-8")
                report = json.loads(raw)
                self.assertEqual(report["casesFile"], SPARSE_CASES.name)
                self.assertEqual(report["runState"], "complete")
                self.assertEqual(report["pipeline"], "product_draft_then_review")
                item = report["results"][0]
                calls = item["providerCalls"]
                self.assertEqual([call["phase"] for call in calls], ["draft", "review"])
                self.assertEqual(calls[0]["content"], draft["content"])
                self.assertEqual([call["networkTimeoutSeconds"] for call in calls], [40, 25])
                self.assertNotEqual(calls[0]["promptSha256"], calls[1]["promptSha256"])
                self.assertEqual(item["humanReview"]["status"], "pending")
                if isinstance(review, Exception):
                    self.assertEqual(item["content"], draft["content"])
                    self.assertEqual(item["reviewWarning"], REVIEW_WARNING)
                    self.assertNotIn("content", calls[1])
                else:
                    self.assertEqual(item["content"], review["content"])
                    self.assertEqual(calls[1]["content"], review["content"])
                    self.assertNotIn("reviewWarning", item)
                for sentinel in ("FAKE_SECRET_SENTINEL", "fake-private-endpoint.invalid"):
                    self.assertNotIn(sentinel, raw + output)
                    self.assertNotIn(sentinel, reports[0].with_suffix(".md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
