"""Run anonymous feedback cases, then review quality manually.

Default mode is a local dry run: no settings read and no network requests.
This module intentionally does not import the ASGI app or the student database.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from time import perf_counter

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.app.schemas import GenerateRequest  # noqa: E402
from backend.app.services.feedback import generate_feedback  # noqa: E402
from backend.app.services.prompts import build_messages  # noqa: E402
from backend.app.services.provider import AIProvider, ProviderError  # noqa: E402
from backend.app.services.settings import SettingsStore, SettingsUnavailable  # noqa: E402

SHANGHAI = timezone(timedelta(hours=8))
CASES_PATH = Path(__file__).with_name("feedback_cases.json")


def now() -> str:
    return datetime.now(SHANGHAI).isoformat(timespec="seconds")


def positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("数量须大于 0。")
    return number


def load_cases() -> dict:
    suite = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    identifiers = [case["id"] for case in suite["cases"]]
    if len(set(identifiers)) != len(identifiers):
        raise ValueError("用例 ID 重复。")
    for case in suite["cases"]:
        GenerateRequest.model_validate(case["request"])
        if not case.get("reviewPoints"):
            raise ValueError("用例缺少人工评估要点。")
    return suite


def prompt_digest(messages: list[dict[str, str]]) -> str:
    encoded = json.dumps(messages, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def mechanical_observations(content: str) -> dict:
    """Describe shape only. No keyword heuristic declares teaching quality passed."""
    return {
        "characterCount": len(content),
        "nonempty": bool(content.strip()),
        "withinApiLimit": len(content) <= 10_000,
        "containsCodeFence": "```" in content,
        "startsLikeJson": content.lstrip().startswith(("{", "[")),
        "paragraphCount": len([part for part in re.split(r"\n\s*\n", content) if part.strip()]),
        "studentPlaceholderCount": content.count("【学生】"),
        "note": "这些仅为机械信息，不能证明事实正确、建议有效或文风合格。",
    }


class EvaluationProvider(AIProvider):
    """Record only request hashes and sizes, never configuration or raw headers."""

    def __init__(self, settings: SettingsStore):
        super().__init__(settings)
        self.calls: list[dict] = []

    def complete(self, messages: list[dict[str, str]], **options) -> dict[str, str]:
        self.calls.append({
            "phase": "draft" if not self.calls else "review",
            "promptSha256": prompt_digest(messages),
            "promptCharacterCount": sum(len(message["content"]) for message in messages),
            "networkTimeoutSeconds": options.get("timeout_seconds", 60.0),
        })
        return super().complete(messages, **options)


def markdown_report(report: dict) -> str:
    lines = [
        "# Nookmi 反馈生成效果记录", "",
        f"时间：{report['startedAt']}（Asia/Shanghai）", "",
        f"运行状态：{report['runState']}；模型：{report['model']}", "",
        "生成流程与产品一致：先生成初稿，再自动检查；自动检查不等于人工质量验收。", "",
        report["sourceNote"], "",
        "本报告不会自动宣布文案质量通过；需对照以下标准和各例要点人工检查。", "",
        "## 人工评价标准", "",
    ]
    lines.extend(f"- {point}" for point in report["rubric"])
    for item in report["results"]:
        lines.extend([
            "", f"## {item['caseId']} · {item['label']}", "",
            f"状态：{item['status']}；耗时：{item['durationSeconds']:.2f} 秒", "",
            f"提示词 SHA-256：`{item['promptSha256']}`", "",
            "### 输入", "", "```json",
            json.dumps(item["request"], ensure_ascii=False, indent=2), "```", "",
            "### 输出", "", item.get("content") or item.get("error") or "未生成。", "",
        ])
        if item.get("reviewWarning"):
            lines.extend([f"自动检查提示：{item['reviewWarning']}", ""])
        lines.extend(["### 核对要点", ""])
        lines.extend(f"- [ ] {point}" for point in item["reviewPoints"])
        if item.get("providerCalls"):
            lines.extend(["", "实际请求摘要（包含自动检查请求）：", "", "```json",
                          json.dumps(item["providerCalls"], ensure_ascii=False, indent=2), "```"])
        if item.get("mechanicalObservations"):
            lines.extend(["", "机械信息（不等于质量结论）：", "", "```json",
                          json.dumps(item["mechanicalObservations"], ensure_ascii=False, indent=2), "```"])
        lines.extend(["", "人工结论：待核对。", "", "需要修改的内容与原因：", ""])
    return "\n".join(lines)


def write_report(directory: Path, report: dict) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    (directory / "report.md").write_text(markdown_report(report), encoding="utf-8")


def main() -> int:
    # PowerShell pipe capture otherwise defaults to a legacy Windows code page.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--run", action="store_true", help="调用现有配置的服务，每案例正常 2 次请求，可能产生费用。")
    mode.add_argument("--dry-run", action="store_true", help="仅校验用例和构建提示词（默认）。")
    parser.add_argument("--case", action="append", dest="case_ids", help="按 ID 选择，可重复指定。")
    parser.add_argument("--limit", type=positive_int, help="最多运行前 N 个已选案例（不是 API 请求数）。")
    parser.add_argument("--settings-dir", type=Path,
                        default=Path(os.environ.get("NOOKMI_DATA_DIR") or ROOT / ".local"),
                        help="只读 AI 设置目录，默认与本地工作台相同。")
    parser.add_argument("--output-dir", type=Path, default=ROOT / ".local" / "evals",
                        help="本地报告父目录（实际运行时写入）。")
    args = parser.parse_args()
    try:
        suite = load_cases()
    except (OSError, ValueError, KeyError, TypeError):
        print("用例文件无效，请检查固定测试资料；未调用模型。", file=sys.stderr)
        return 2
    known_ids = {case["id"] for case in suite["cases"]}
    if args.case_ids and any(identifier not in known_ids for identifier in args.case_ids):
        parser.error("存在未知用例 ID；先不带参数运行查看可用列表。")
    cases = [case for case in suite["cases"] if not args.case_ids or case["id"] in args.case_ids]
    if args.limit:
        cases = cases[:args.limit]
    prepared = [(case, build_messages(GenerateRequest.model_validate(case["request"]))) for case in cases]
    if not args.run:
        print(f"DRY RUN：{len(prepared)} 个案例校验通过，未读取 AI 配置、未调用模型、未修改学生数据。")
        for case, messages in prepared:
            print(f"- {case['id']} | {case['request']['module']} | 提示词 {sum(len(m['content']) for m in messages)} 字符 | {prompt_digest(messages)[:12]}")
        print("需要真实生成时加 --run；--case ID（可重复）或 --limit N 限定案例数，每案例通常 2 次请求。")
        return 0

    settings = SettingsStore(args.settings_dir)
    try:
        configured = settings.read_private()
        if not settings.public(configured)["configured"]:
            print("尚未配置可用模型服务；未发起请求。请先在工作台设置服务。", file=sys.stderr)
            return 2
    except SettingsUnavailable:
        print("AI 设置无法读取；未发起请求。请检查本地设置。", file=sys.stderr)
        return 2
    directory = args.output_dir / datetime.now(SHANGHAI).strftime("feedback-%Y%m%d-%H%M%S-%f")
    report = {
        "version": 1, "startedAt": now(), "finishedAt": None, "timezone": "Asia/Shanghai",
        "runState": "running", "model": configured["model"],
        "pipeline": "product_draft_then_review",
        "sourceNote": suite["sourceNote"], "rubric": suite["rubric"], "results": [],
        "evaluationStatus": "人工质量评价待完成；请求成功和机械检查不等于生成质量通过。",
    }
    # Never retain the API key or endpoint in reports or printed diagnostics.
    del configured
    provider = EvaluationProvider(settings)
    write_report(directory, report)
    try:
        for index, (case, messages) in enumerate(prepared, start=1):
            started = perf_counter()
            provider.calls = []
            item = {
                "caseId": case["id"], "label": case["label"], "sourceKind": case["sourceKind"],
                "request": case["request"], "reviewPoints": case["reviewPoints"],
                "promptSha256": prompt_digest(messages), "promptCharacterCount": sum(len(m["content"]) for m in messages),
                "startedAt": now(), "status": "error", "durationSeconds": 0.0,
                "humanReview": {"status": "pending", "verdict": None, "requiredEdits": None},
            }
            print(f"[{index}/{len(prepared)}] {case['id']}：生成中…", flush=True)
            try:
                result = generate_feedback(GenerateRequest.model_validate(case["request"]), provider)
                item.update(status="generated", content=result["content"], model=result["model"],
                            mechanicalObservations=mechanical_observations(result["content"]))
                if result.get("reviewWarning"):
                    item["reviewWarning"] = result["reviewWarning"]
            except ProviderError as error:
                item.update(error=error.message, errorStatus=error.status)
            except Exception:
                # Raw transport/parser exceptions may contain an endpoint or credential.
                item.update(error="评估执行异常，未记录原始异常以避免暴露配置。")
            item["durationSeconds"] = round(perf_counter() - started, 3)
            item["providerCalls"] = provider.calls
            report["results"].append(item)
            write_report(directory, report)
            warning = "自动检查未完成，已保留初稿；" if item.get("reviewWarning") else ""
            print(f"  {item['status']} · {item['durationSeconds']:.2f} 秒；{warning}人工评价待完成。", flush=True)
    except KeyboardInterrupt:
        report["runState"] = "interrupted"
    else:
        report["runState"] = "complete"
    finally:
        report["finishedAt"] = now()
        write_report(directory, report)
    print(f"报告已写入：{directory}")
    if report["runState"] == "interrupted":
        return 130
    return 0 if all(item["status"] == "generated" for item in report["results"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
