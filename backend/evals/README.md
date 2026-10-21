# 反馈质量回归

这里的资料与学生数据库完全独立。前五例由未被内置范文采用的用户作品匿名逆向提炼，随后三例为虚构边界情形、四例为虚构个人风格案例，最后一例仅改变第一例日期以检查图标搭配，共 13 例。这些输入不代表教师当时的原始短记录，因此只能用于首轮校准，不能据此证明真实填写时间下降。风格案例中的示例称呼、成绩和课程也是构造数据，用于检查模型是否错误地把旧范文事实迁入当前反馈。

默认只检查请求格式并构建当前提示词，不读取 AI 设置、不联网：

```powershell
.venv\Scripts\python.exe backend/evals/evaluate_feedback.py
```

`sparse_feedback_cases.json` 另含 15 条独立构造的新用户日常短记录：前 12 条用于发现问题和前后对照，后 3 条预留检查其他场景。覆盖混写学科、主语省略、提示后掌握、单次错误、少量变化、未来计划和个人短风格。它们不是从完整成稿逆向提炼，也不是实际用户使用数据；不作为完整输入输出范例。校准阶段的一处歧义短语用于规则说明，预留案例内容未用于调整。v0.10.0 的实际过程及边界见 [短记录实测](../../docs/SPARSE_GENERATION_EXAMPLES.md)。

```powershell
# 校验全部短记录，不联网
.venv\Scripts\python.exe backend/evals/evaluate_feedback.py --cases-file backend/evals/sparse_feedback_cases.json
# 真实生成班课的前四条（不含预留案例）
.venv\Scripts\python.exe backend/evals/evaluate_feedback.py --run --cases-file backend/evals/sparse_feedback_cases.json --module course --limit 4
```

`--cases-file` 选择固定输入文件；`--case` 和 `--module` 取交集，再应用 `--limit`。选择为空、ID 无效或请求校验失败时，在读取模型设置前退出。

需要真实生成时显式添加 `--run`，脚本会使用工作台已有的兼容 OpenAI 配置，可能产生服务费用。下面三个案例分别覆盖一对一、晚辅和班课：

```powershell
.venv\Scripts\python.exe backend/evals/evaluate_feedback.py --run --case one-to-one-recursion --case evening-uncertain --case course-classroom-balance
```

检查个人风格优先时，可选以下四例，分别覆盖一对一自然段无图标、晚辅简短分点、班课自定义标题和一对一两个图标标题。它们用于观察是否遵循个人结构和篇幅，不能靠检查出现了某个标题就自动宣布风格达标：

```powershell
.venv\Scripts\python.exe backend/evals/evaluate_feedback.py --run --case style-one-to-one-prose --case style-evening-short-points --case style-course-custom-headings --case style-one-to-one-two-icons
```

核对时同时检查：没有强加默认四板块或图标，没有复制示例姓名、成绩和旧知识点；当前记录中的事实、掌握层次与未来计划仍准确保留。没有课程或作业记录时，不因个人范文出现相应部分而填造内容。

`default-one-to-one-icon-variation` 与 `one-to-one-recursion` 只有日期不同（10月5日与10月4日），用于对照默认一对一标题的图标搭配。两例应保持标题含义和教学事实，不因日期变化新增课次、进步或学习内容；这是合成的日期变化测试，并非两次真实课程记录。运行时可用两个 `--case` 一起选择，已有同版本10月4日报告时也可只生成新增日期例。

`--case` 可以重复指定；`--limit N` 进一步限制案例数量，不是 API 请求数量。配置默认从 `NOOKMI_DATA_DIR` 或项目 `.local` 读取，也可指定 `--settings-dir`。脚本不会修改设置或学生资料，不输出服务地址和密钥，不读取真实学生档案或已保存的个人范文。

实际运行通过产品使用的 `feedback.generate_feedback` 服务，**每案例正常调用同一模型两次：生成初稿、检查修改**。初稿请求失败时没有第二次调用；检查失败则保留初稿，并在报告写入 `reviewWarning`，不能视为已通过检查。脚本不增加重试或第三次评分调用。当前服务的初稿、检查单次网络等待分别为 40 秒和 25 秒；这不是整个流程的总时限保证。

报告保存为 `.local/evals/feedback-日期时间/report.json` 与 `report.md`，每次独立目录，包含匿名输入、初稿与复核后的输出、模型、耗时、实际两次请求各自的提示词摘要，以及人工核对要点；可用 `--output-dir` 分开保留基线、中间版本和最终版本。v2 报告还记录用例文件名和每次成功调用的生成文本，便于判断复核有没有改错。该目录已在 Git 忽略范围内。旧报告若没有 `pipeline: product_draft_then_review`，表示当时直接单次生成，不能视为当前产品完整流程的结果。

报告中的字符数、代码块、段落和占位符统计属于机械信息。**请求成功或格式合格不代表反馈质量合格。** 请逐条检查事实、独立完成程度、困难定位、建议对应、语气及实际需要修改的内容。在 Markdown 中勾选核对项、记录必要修改，或在 JSON 的 `humanReview` 中填写结论。比较不同提示词版本时使用同一批输入，并保留历史报告。
