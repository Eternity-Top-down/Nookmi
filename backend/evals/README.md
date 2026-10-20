# 反馈质量回归

这里的资料与学生数据库完全独立。前五例由未被内置范文采用的用户作品匿名逆向提炼，后三例为虚构边界情形；这些输入不代表教师当时的原始短记录，因此只能用于首轮校准，不能据此证明真实填写时间下降。

默认只检查请求格式并构建当前提示词，不读取 AI 设置、不联网：

```powershell
.venv\Scripts\python.exe backend/evals/evaluate_feedback.py
```

需要真实生成时显式添加 `--run`，脚本会使用工作台已有的兼容 OpenAI 配置，可能产生服务费用。下面三个案例分别覆盖一对一、晚辅和班课：

```powershell
.venv\Scripts\python.exe backend/evals/evaluate_feedback.py --run --case one-to-one-recursion --case evening-uncertain --case course-classroom-balance
```

`--case` 可以重复指定；`--limit N` 进一步限制案例数量，不是 API 请求数量。配置默认从 `NOOKMI_DATA_DIR` 或项目 `.local` 读取，也可指定 `--settings-dir`。脚本不会修改设置或学生资料，不输出服务地址和密钥，不读取真实学生档案或已保存的个人范文。

实际运行通过产品使用的 `feedback.generate_feedback` 服务，**每案例正常调用同一模型两次：生成初稿、检查修改**。初稿请求失败时没有第二次调用；检查失败则保留初稿，并在报告写入 `reviewWarning`，不能视为已通过检查。脚本不增加重试或第三次评分调用。当前服务的初稿、检查单次网络等待分别为 40 秒和 25 秒；这不是整个流程的总时限保证。

报告保存为 `.local/evals/feedback-日期时间/report.json` 与 `report.md`，每次独立目录，包含匿名输入、最终输出、模型、耗时、实际两次请求各自的提示词摘要，以及人工核对要点。该目录已在 Git 忽略范围内。旧报告若没有 `pipeline: product_draft_then_review`，表示当时直接单次生成，不能视为当前产品完整流程的结果。

报告中的字符数、代码块、段落和占位符统计属于机械信息。**请求成功或格式合格不代表反馈质量合格。** 请逐条检查事实、独立完成程度、困难定位、建议对应、语气及实际需要修改的内容。在 Markdown 中勾选核对项、记录必要修改，或在 JSON 的 `humanReview` 中填写结论。比较不同提示词版本时使用同一批输入，并保留历史报告。
