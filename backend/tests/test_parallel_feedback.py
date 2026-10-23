"""Concurrent batch requests keep each student's draft/review chain isolated."""
from concurrent.futures import ThreadPoolExecutor
import json
from threading import Barrier, Lock
import unittest

from backend.app.services.feedback import REVIEW_WARNING
from backend.app.services.provider import ProviderError
from backend.tests.test_api import ApiTestCase, brief, observations


class ParallelProvider:
    """Require all first passes to overlap; never call an external AI service."""

    def __init__(self, markers, *, first_failure=None, review_failure=None):
        self.markers = markers
        self.first_failure = first_failure
        self.review_failure = review_failure
        self.barrier = Barrier(len(markers), timeout=10)
        self.lock = Lock()
        self.active_drafts = 0
        self.max_active_drafts = 0
        self.finished_drafts = set()
        self.calls = []

    def complete(self, messages, *, timeout_seconds):
        facts = json.loads(messages[-1]["content"].split("\n", 1)[1])
        marker = facts["这位学生的实际观察"]["performance"]
        if marker not in self.markers:
            raise AssertionError("A request lost its own student observations")
        for other in self.markers:
            if other != marker and other in messages[-1]["content"]:
                raise AssertionError("Another student's observations entered the prompt")
        is_review = messages[1]["content"].startswith("待复核的初稿")
        with self.lock:
            self.calls.append((marker, "review" if is_review else "draft", timeout_seconds))

        if is_review:
            with self.lock:
                if marker not in self.finished_drafts:
                    raise AssertionError("Review started before this student's draft completed")
            candidate = json.loads(messages[1]["content"].split("\n", 1)[1])["初稿"]
            if candidate != f"AI 初稿：{marker}":
                raise AssertionError("Review received another student's draft")
            if marker == self.review_failure:
                raise ProviderError("模拟复核超时", 504)
            return {"content": f"已复核：{marker}", "model": "parallel-test-model"}

        with self.lock:
            self.active_drafts += 1
            self.max_active_drafts = max(self.max_active_drafts, self.active_drafts)
        try:
            # This fails a serialized route without relying on timing/speed assertions.
            self.barrier.wait()
            if marker == self.first_failure:
                raise ProviderError("模拟服务限流", 429)
            with self.lock:
                self.finished_drafts.add(marker)
            return {"content": f"AI 初稿：{marker}", "model": "parallel-test-model"}
        finally:
            with self.lock:
                self.active_drafts -= 1


class ParallelFeedbackTests(ApiTestCase):
    def request_batch(self, module, provider):
        self.app.state.provider = provider
        requests = {
            marker: self.generate_input(
                module,
                brief=brief(teachingContent="共同学习二次函数"),
                observations=observations(performance=marker),
            )
            for marker in provider.markers
        }

        # One context creates one shared app event loop. Separate TestClients per
        # thread could hide a blocking/serialized route behind independent loops.
        with self.client:
            with ThreadPoolExecutor(max_workers=len(requests)) as executor:
                futures = {
                    marker: executor.submit(self.client.post, "/api/ai/generate", json=body)
                    for marker, body in requests.items()
                }
                responses = {marker: future.result(timeout=20) for marker, future in futures.items()}
        self.assertEqual(provider.max_active_drafts, len(requests))
        self.assertEqual(provider.active_drafts, 0)
        # Generating a batch alone must not archive candidates in the workspace.
        self.assertEqual(self.client.get("/api/workspace").json()["revision"], 0)
        return responses

    def test_three_students_overlap_and_receive_their_own_reviewed_feedback(self):
        for module in ("evening", "course"):
            with self.subTest(module=module):
                provider = ParallelProvider(("记录甲", "记录乙", "记录丙"))
                responses = self.request_batch(module, provider)
                self.assertEqual(len(provider.calls), 6)
                for marker, response in responses.items():
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json(), {
                        "content": f"已复核：{marker}", "model": "parallel-test-model",
                    })
                    self.assertEqual(
                        [(stage, timeout) for owner, stage, timeout in provider.calls if owner == marker],
                        [("draft", 40.0), ("review", 25.0)],
                    )

    def test_first_pass_and_review_failures_do_not_abort_other_students(self):
        for module in ("evening", "course"):
            with self.subTest(module=module):
                provider = ParallelProvider(
                    ("初稿失败的记录", "复核失败的记录", "正常完成的记录"),
                    first_failure="初稿失败的记录", review_failure="复核失败的记录",
                )
                responses = self.request_batch(module, provider)
                self.assertEqual(responses[provider.first_failure].status_code, 429)
                self.assertEqual(responses[provider.first_failure].json(), {"detail": "模拟服务限流"})
                self.assertEqual(responses[provider.review_failure].status_code, 200)
                self.assertEqual(responses[provider.review_failure].json(), {
                    "content": f"AI 初稿：{provider.review_failure}",
                    "model": "parallel-test-model", "reviewWarning": REVIEW_WARNING,
                })
                self.assertEqual(responses["正常完成的记录"].status_code, 200)
                self.assertEqual(responses["正常完成的记录"].json(), {
                    "content": "已复核：正常完成的记录", "model": "parallel-test-model",
                })
                self.assertEqual(len(provider.calls), 5)
                self.assertEqual(
                    [stage for owner, stage, _ in provider.calls if owner == provider.first_failure],
                    ["draft"],
                )
                for marker in (provider.review_failure, "正常完成的记录"):
                    self.assertEqual(
                        [stage for owner, stage, _ in provider.calls if owner == marker],
                        ["draft", "review"],
                    )


if __name__ == "__main__":
    unittest.main()
