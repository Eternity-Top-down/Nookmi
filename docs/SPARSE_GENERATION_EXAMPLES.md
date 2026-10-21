# 零散短记录生成：实际调用与逐条审阅（2026-10-22）

本轮重点检查：新用户只写少量、零散的现实情况时，三个模块能否保留事实、区分掌握程度，并给出对应的建议。最终 15 个短例的编辑判断为 **10 个可采用、5 个轻改、0 个必须修**。这说明本轮已发现的严重问题得到修正，但不能据此宣称反馈已经全自动、稳定优秀。

## 样本与调用范围

15 条短记从新用户日常填写情境直接构造，均为独立虚构、匿名资料，没有从成熟反馈逆向压缩：12 条用于同输入校准，3 条预留检查。另取既有评测中的 3 条信息较丰富的匿名旧例作回归；这 3 条旧例从用户以往作品匿名逆向提炼，不能用来证明新用户只需少量输入。评测没有读取真实学生数据库。

12 条校准例用于定向调整，其中“物理只问了两题”这一歧义短语被用于提示词一般规则的主语说明；3 条预留内容没有用于调整。15 条测试输入均未作为完整的输入/输出成对范例加入提示词，新增短示例也采用不同输入。因此不能把全部 15 条都称为未见案例或盲测。

实际调用日期为 **2026-10-22（Asia/Shanghai）**，模型为 **`deepseek-flash`**。每次生成走产品的 **初稿 → 复核** 流程（`product_draft_then_review`），文中的“最终输出”均指报告 `content`，不是初稿，也没有经过编辑代写或润色。`【学生】`是评测中的匿名占位符。输入 JSON 是完整请求证据，不代表用户必须填写这些结构字段；空字段仍按原报告保留。

| 阶段 | 报告目录（均在 `.local/evals/`） | 生成结果 | 报告记录的 provider 请求 |
|---|---|---:|---:|
| 基线 | `sparse-v010-baseline` | 12 | 24 |
| 中间：12 条校准复测 | `sparse-v010-after` | 12 | 24 |
| 中间：3 条预留首测 | `sparse-v010-holdout` | 3 | 6 |
| 中间：3 条丰富旧例回归 | `sparse-v010-regression` | 3 | 6 |
| 最终：全部短例 | `sparse-v010-final` | 15 | 30 |
| 最终：丰富旧例回归 | `sparse-v010-final-rich` | 3 | 6 |
| **合计** | **12 次基线 + 18 次中间 + 18 次最终** | **48** | **96** |

数量由 12 份 `report.json` 的 `results` 和 `providerCalls` 实际计数：每个结果都记录了 1 次 `draft`、1 次 `review`，所有报告为 `complete`，48 个结果为 `generated`。48 是重复调用次数，不是 48 个不同案例；不同输入共 18 个。原 12 条校准输入在基线与最终报告间逐对象核对相同，3 条预留输入和 3 条旧例的前后请求也分别相同。最终 18 条结果的提示词哈希已与当前构建逐项比对一致。机械上的成功不代替内容判断。

## 逐条编辑判断与实际差异

“可采用”表示本次正文未发现需要先修正的事实或明显表达问题；“轻改”表示事实基本可用，但教师仍需少量整理范围、重复或措辞；“必须修”表示存在会误导家长的事实、行为建议或学科表述问题。以下是 Codex 独立对照输入、基线及实际输出进行的逐条编辑审阅，不是生成模型自评分，也不代表教师试用验收。报告原有 `humanReview` 字段没有修改，本文另行记录审阅结论。

原 12 条短例：基线为 **3 可采用 / 7 轻改 / 2 必须修**；中间版为 **9 可采用 / 2 轻改 / 1 必须修**；最终为 **8 可采用 / 4 轻改 / 0 必须修**。中间到最终的语言表现并非每例都单调改善，新增的少量重复仍计入轻改。最终 3 条预留例为 **2 可采用 / 1 轻改**。

| 案例 ID | 场景 | 基线 | 最终 | 对照结论 |
|---|---|---|---|---|
| `sparse-one-to-one-sign` | 一对一：去括号与移项 | 轻改 | 可采用 | 保留独立完成与提醒后改对的区别；删掉针对已独立完成的移项额外展开及重复课程列表；明确作业题号保留。 |
| `sparse-one-to-one-transfer` | 一对一：听懂但换题仍不会 | 轻改 | 可采用 | 听懂、跟随订正、换题不会选事件均保留；建议聚焦事件选择，没有替学生补上掌握或独立完成。 |
| `sparse-one-to-one-no-course` | 一对一：活动混在短记中 | 轻改 | 轻改 | 实际教学活动没有因课程框为空而丢失，斜率结论准确；但两道读图题及水平/竖直线结论重复，可压缩。 |
| `sparse-one-to-one-plan-only` | 一对一：只有未来计划 | 轻改 | 轻改 | 没有编造本次表现或确定作业，也没有孤立的第3节编号；但把拟重做对象写成之前的内容，宜保留错题这个范围。 |
| `sparse-evening-mixed-subjects` | 晚辅：分科缩写 | 轻改 | 可采用 | 分清数学、物理，没有补写化学表现；删掉尾段对两科建议的再次复述。 |
| `sparse-evening-single-chat` | 晚辅：一次聊天 | 必须修 | 可采用 | 保留周二单次情况与提醒后继续，不扩大成长期纪律问题；不再暗示完成一小段就可聊天。 |
| `sparse-evening-uncertain` | 晚辅：判断仍不确定 | 必须修 | 轻改 | 不再把主语不明确的问了两题写成学生主动提问；从这两题看像是会一些仍像原始便签，需稍作措辞整理。 |
| `sparse-evening-style-plan` | 晚辅：个人风格与计划 | 可采用 | 可采用 | 保留本次观察/下一步的个人格式，没有借用风格参考中的单位错误等事实；未来安排未变成已执行。 |
| `sparse-course-shared-boundary` | 班课：共用课程边界 | 可采用 | 可采用 | 共用课程可以完整概述，个人掌握只评价已记录的交并集与补集；建议落在先看全集。 |
| `sparse-course-condition-transform` | 班课：条件转化卡点 | 轻改 | 可采用 | 保留会提取条件、转化缺方向、提示后可继续；建议不再长篇重复，中间版将定值列为使用条件的错误已经修复。 |
| `sparse-course-one-incident` | 班课：一次漏选 | 可采用 | 可采用 | 一次漏选没有扩大成经常漏选、概念不清或粗心；简短反馈仍有对应建议。 |
| `sparse-course-small-change` | 班课：有限进步 | 轻改 | 轻改 | 保留本次能列式及中途仍需提醒；能先列式被说了两遍，可删掉一处。 |
| `holdout-one-to-one-opening` | 预留一对一：开口方向 | — | 轻改 | 认出顶点式、开口看反、提醒后改对均保留，建议没有混淆顶点与开口；短段中学生称呼出现三次，显得机械。 |
| `holdout-evening-repeat-gap` | 预留晚辅：隔日再卡住 | — | 可采用 | 保留当场理解与周三同类题仍卡住的区别；物理未查看没有变成掌握评价，建议针对复现困难；末尾“物理本周的作业暂未查看”事实正确，但措辞仍可更自然。 |
| `holdout-course-scope-and-task` | 预留班课：范围与任务 | — | 可采用 | 集合那组全对没有扩大为集合全面掌握；充要条件换说法判断反的困难及明确订正任务均保留。 |

### 1. 一处观察不再扩成多项同义建议

去括号案例的基线重复列举课程内容，并对已独立完成的移项继续加建议。以下两条为基线原文；最终改为一条针对去括号符号核对的建议，完整输入输出见下方精选示例。

> ② 移项时可以把“移项要变号”的步骤写完整，先写清移动哪一项、变号后是什么，再继续计算；后续可用同类题巩固。
> ③ 方程解出后，可以代回原方程检验，帮助发现去括号或移项中的符号问题。

### 2. 修正聊天建议与不确定观察的主语

聊天案例的输入是周二有一阵聊天、提醒后继续写，基线却建议分小段，并把交流留到一段完成后处理。逐条审阅认为这可能给出不合适的纪律信号。基线完整原文如下：

> 本周（10月19日至23日）晚辅期间，【学生】周二有一阵和同学聊天，经提醒后能继续写作业；这周作业都交齐了。后续可以尝试在开始写作业前先明确当天要完成的任务，分成几小段来完成；想交流时先记下来，等当前这一段完成后再处理，减少作业中途被打断的情况。

最终仍写清作业交齐及提醒后的反应，建议专注当前任务、减少中途聊天，不再给交流安排时间，见精选示例。

另一例原始短记为：

```text
物理只问了两题，看着会一点，还不确定；数学坐标图能画对
```

“问了两题”的主语并不明确，基线却写成学生问了两题，并据此建议问完题后复述。基线原文如下：

> 本周晚辅中：1. 数学方面，【学生】能画对坐标图。2. 物理方面，【学生】只问了两题，看着会一点，暂时还不确定掌握情况。
>
> 后续可以请【学生】在问完题后，把解题思路和步骤用自己的话复述一遍，或尝试一道相近的题，帮助确认是否已经会做；数学画完坐标图后，可以顺带核对坐标与图形是否对应。

最终改为“目前仅涉及两道题”，保留掌握情况仍不确定，未认定提问主体。该例仍判轻改，因为“看像是会一些”的措辞尚不够成熟。

### 3. 保留中间版的学科错误及修复

在 `sparse-course-condition-transform` 中，输入只说会提取条件、不会确定变形方向、给开头后能继续。中间版 `sparse-v010-after` 实际输出以下建议：

> 后续可以尝试先分别写出题目要求和已知条件，再从目标式倒推：要使用基本不等式，需要把式子整理成什么形式，是否具备使用条件（如各项为正、和或积能否化为定值），等号在什么条件下成立，再据此决定变形方向；做完后也可以对照讲解中的开头，复盘自己最初的判断差在哪里。

来源：`.local/evals/sparse-v010-after/feedback-20261022-003230-502134/report.json`；案例：`sparse-course-condition-transform`。

初稿提示词 SHA-256：`cf0a35682f4f8446f20d2e1a5fdcd5927e9b63b9c6396bef8ed99a1272684f12`

复核提示词 SHA-256：`4caae80b5cedd7bfd7463eed0cdc63c9918d7e2b5f7eeff2ad6360590b0ec4d8`

最终正文 SHA-256（UTF-8）：`f7d3ae8ebe8c370ba6e47987a44ef499a0125a07eee0141cf9bde4295f3f8867`

逐条审阅将这一例判为必须修：将“和或积能否化为定值”放进基本不等式的使用条件，混淆了定理适用条件与特定求最值题的构造策略。随后收紧学科建议：没有具体式子时，不强套定值题型；围绕已知条件、目标形式、第一步转化及取等可行性给建议。

最终同输入复测的建议原文为：

> 后续可以引导孩子先分别整理题目条件和目标式，再尝试把条件往目标式变形；如果第一步卡住，可以给一个开头，让孩子接着推，并核对取等条件是否可行。这样有助于把“找条件”和“选形式”逐步对应起来。

最终没有再把定值当成使用条件，也没有新增学生的掌握事实。完整最终输入输出及哈希在后面的折叠证据中保留。这个过程也说明一次提示词改动可能引入新问题，不能只看表面流畅或请求成功。

## 三个完整精选实例

以下三例按原报告直接提取完整 `request` 与最终 `content`；未改写任何模型文字。

### 一对一：去括号与移项（`sparse-one-to-one-sign`）

实际填写：

- 年级：初一；科目：数学；日期：2026-10-22。
- 教学内容：一元一次方程，去括号和移项
- 学生短记：去括号漏负号，提醒看括号前符号后自己改对；移项那两题独立做的
- 作业：讲义第2页1—3题

<details>
<summary>评测存档：完整请求、来源与哈希（无需用户填写 JSON）</summary>

来源：`.local/evals/sparse-v010-final/feedback-20261022-003458-831468/report.json`；案例：`sparse-one-to-one-sign`。

初稿提示词 SHA-256：`b7c8fd7caa188b6bc154264de815eea1082dbc7e364289de5b8ecc4e1441038f`

复核提示词 SHA-256：`b78f999846b321bc97ef00c9de0605d1f6bf39d662c85d662b34f4a722c6c6a3`

最终正文 SHA-256（UTF-8）：`4e97894d63eceb9f87cb3d74a3b38e97f825b86204c268200f10f608f9d39492`

完整输入：

```json
{
  "module": "one-to-one",
  "grade": "初一",
  "brief": {
    "periodStart": "2026-10-22",
    "periodEnd": "2026-10-22",
    "subjects": [
      "数学"
    ],
    "teachingContent": "一元一次方程，去括号和移项",
    "commonTasks": "",
    "focus": "",
    "length": "standard"
  },
  "observations": {
    "performance": "去括号漏负号，提醒看括号前符号后自己改对；移项那两题独立做的",
    "strengths": "",
    "difficulties": "",
    "plan": "",
    "tasks": "讲义第2页1—3题",
    "subjects": {}
  },
  "styleReference": ""
}
```

</details>

完整最终输出：

```text
📖 1. 课堂学习内容
本节课围绕一元一次方程中的去括号和移项展开。

✨ 2. 课堂表现与知识掌握情况
从课堂练习看，移项的两道题【学生】能独立完成。去括号时出现了漏负号的情况，提醒先看括号前的符号后，【学生】能自己改对。

🔍 3. 课后建议
后续做去括号的题目时，建议先看清括号前的符号，展开后逐项核对符号，尤其是括号前为负号的情况，减少漏写或写错符号。

📌 4. 作业安排
讲义第2页1—3题。
```

### 晚辅：一次聊天（`sparse-evening-single-chat`）

实际填写：

- 年级：初二；科目：数学、物理；日期：2026-10-19 至 2026-10-23。
- 学生短记：周二有一阵聊天，提醒后继续写；这周作业都交齐了

<details>
<summary>评测存档：完整请求、来源与哈希（无需用户填写 JSON）</summary>

来源：`.local/evals/sparse-v010-final/feedback-20261022-003458-656193/report.json`；案例：`sparse-evening-single-chat`。

初稿提示词 SHA-256：`c428de64c1cfc4ef417a62857efb2d127b0f64824a88773416e65de9be45618e`

复核提示词 SHA-256：`72e5f5496c24cbe235bb6ac644cdd81776b0b5d9d496d4a2ddf0d2f647f5c0f1`

最终正文 SHA-256（UTF-8）：`0e9c05806a4bfdd1d2265ac6a7e3583d90823863198ae633e5c1069d8504ddea`

完整输入：

```json
{
  "module": "evening",
  "grade": "初二",
  "brief": {
    "periodStart": "2026-10-19",
    "periodEnd": "2026-10-23",
    "subjects": [
      "数学",
      "物理"
    ],
    "teachingContent": "",
    "commonTasks": "",
    "focus": "",
    "length": "standard"
  },
  "observations": {
    "performance": "周二有一阵聊天，提醒后继续写；这周作业都交齐了",
    "strengths": "",
    "difficulties": "",
    "plan": "",
    "tasks": "",
    "subjects": {}
  },
  "styleReference": ""
}
```

</details>

完整最终输出：

```text
本周【学生】的作业都交齐了。周二写作业时有一阵聊天，提醒后能继续写。后续写作业时，建议先专注把当前这一项完成，减少中途聊天的情况。
```

### 班课：一次漏选（`sparse-course-one-incident`）

实际填写：

- 年级：高一；科目：数学；日期：2026-10-01 至 2026-10-31。
- 教学内容：不等式性质
- 学生短记：多选漏了一项

<details>
<summary>评测存档：完整请求、来源与哈希（无需用户填写 JSON）</summary>

来源：`.local/evals/sparse-v010-final/feedback-20261022-003457-068611/report.json`；案例：`sparse-course-one-incident`。

初稿提示词 SHA-256：`e67015ad97d39f768b182b409bd222e371fdfdf3be33060532b077725ace70a7`

复核提示词 SHA-256：`44023813935d00b91ea786587002cf46db91268bf70426a72dc55ba5419a868b`

最终正文 SHA-256（UTF-8）：`1f7d0843dc04d824d1ef7349b4b62635d0798a83e6b93f5f97b645338ffc618d`

完整输入：

```json
{
  "module": "course",
  "grade": "高一",
  "brief": {
    "periodStart": "2026-10-01",
    "periodEnd": "2026-10-31",
    "subjects": [
      "数学"
    ],
    "teachingContent": "不等式性质",
    "commonTasks": "",
    "focus": "",
    "length": "standard"
  },
  "observations": {
    "performance": "多选漏了一项",
    "strengths": "",
    "difficulties": "",
    "plan": "",
    "tasks": "",
    "subjects": {}
  },
  "styleReference": ""
}
```

</details>

完整最终输出：

```text
本阶段数学课程学习了不等式的性质。

这次多选题中，【学生】漏选了一项。后续做多选题时，建议对每个选项逐一判断，说明该选项成立或不成立的依据，最后再核对一遍有没有漏掉符合题意的选项。
```

## 其余 12 个短例的完整最终证据

每条折叠内容包含全部输入、未改写的最终正文、来源路径和哈希。精选的 3 例已在上方完整展示，不重复展开。

<details>
<summary>一对一：听懂但换题仍不会 · 可采用 · sparse-one-to-one-transfer</summary>

来源：`.local/evals/sparse-v010-final/feedback-20261022-003458-831468/report.json`；案例：`sparse-one-to-one-transfer`。

初稿提示词 SHA-256：`6992ccbcab6f8a508bafda05f4e34a35f5af339395bcdc757f17084165b9ec87`

复核提示词 SHA-256：`17e521a2539a00af2b1b6c5a6470b032388152d4dbd8774f495025e78384a51f`

最终正文 SHA-256（UTF-8）：`2be4481ea0c9810683a126be16b0e85e0dca5ab4fc7b861633bea0b994c39e5f`

完整输入：

```json
{
  "module": "one-to-one",
  "grade": "高二",
  "brief": {
    "periodStart": "2026-10-22",
    "periodEnd": "2026-10-22",
    "subjects": [
      "数学"
    ],
    "teachingContent": "概率综合题",
    "commonTasks": "",
    "focus": "",
    "length": "standard"
  },
  "observations": {
    "performance": "例题听懂，跟着订正了；换一道还是不会选事件",
    "strengths": "",
    "difficulties": "",
    "plan": "",
    "tasks": "",
    "subjects": {}
  },
  "styleReference": ""
}
```

完整最终输出：

```text
📘 1. 课堂学习内容
本节课学习概率综合题。

🧩 2. 课堂表现与知识掌握情况
【学生】能听懂课堂例题，也能跟着完成订正；换一道题后，还是不会选事件。

🧭 3. 课后建议
后续做概率题时，可以先停在“选事件”这一步：读题后，先说明随机试验和样本空间，再明确目标事件由哪些基本事件组成、它和题目中其他事件是什么关系，最后再决定用哪个概率公式。练习时可以先只练“选事件、写事件关系”，暂不急着把整道题算完，再对照例题看看自己的选择卡在哪里。
```

</details>

<details>
<summary>一对一：活动混在短记中 · 轻改 · sparse-one-to-one-no-course</summary>

来源：`.local/evals/sparse-v010-final/feedback-20261022-003458-831468/report.json`；案例：`sparse-one-to-one-no-course`。

初稿提示词 SHA-256：`76213a9f8f96e63b586488534f7143e839239c7f3e369f44bf80afebf80530b4`

复核提示词 SHA-256：`874d0d6476e0fdc60064ec60a19672549c6305674c40891aba42541b3da58abb`

最终正文 SHA-256（UTF-8）：`98dc4be92988187ae9261d6ae0ef62dbafc95257530a38da384426330cc6f961`

完整输入：

```json
{
  "module": "one-to-one",
  "grade": "高二",
  "brief": {
    "periodStart": "2026-10-22",
    "periodEnd": "2026-10-22",
    "subjects": [
      "数学"
    ],
    "teachingContent": "",
    "commonTasks": "",
    "focus": "",
    "length": "standard"
  },
  "observations": {
    "performance": "今天讲斜率，做了两道读图题；斜率会算，图上竖直线写成k=0",
    "strengths": "",
    "difficulties": "",
    "plan": "",
    "tasks": "",
    "subjects": {}
  },
  "styleReference": ""
}
```

完整最终输出：

```text
📝 1. 课堂学习内容
本节课学习斜率，并做了两道读图题。

💬 2. 课堂表现与知识掌握情况
本次做了两道读图题，【学生】会进行斜率计算；在图上遇到竖直线时，把它的斜率写成了 k=0。这里需要区分：竖直线斜率不存在，水平线斜率为0。

🎯 3. 课后建议
建议看图时先判断直线是竖直还是水平，再动手计算或判断斜率；可以回看这两道读图题，把竖直线的情形单独标出来，与水平线作对比，明确“竖直线斜率不存在、水平线斜率为0”。
```

</details>

<details>
<summary>一对一：只有未来计划 · 轻改 · sparse-one-to-one-plan-only</summary>

来源：`.local/evals/sparse-v010-final/feedback-20261022-003458-831468/report.json`；案例：`sparse-one-to-one-plan-only`。

初稿提示词 SHA-256：`fb800f8ccb058fbfc50c383108c41c4c987d3d1f761affb605d0ff8e5f05bd28`

复核提示词 SHA-256：`c46c6396afae837c7527df2643480b5063a9b17e2c27cc1aef38ff929b0f33b1`

最终正文 SHA-256（UTF-8）：`7ae340758470d1678504e2f286ff6fa0899d5757aefc5a099f0fea28cdb42b92`

完整输入：

```json
{
  "module": "one-to-one",
  "grade": "高二",
  "brief": {
    "periodStart": "2026-10-22",
    "periodEnd": "2026-10-22",
    "subjects": [
      "数学"
    ],
    "teachingContent": "",
    "commonTasks": "",
    "focus": "",
    "length": "standard"
  },
  "observations": {
    "performance": "下次准备带着复盘数列错题，作业想让孩子重做一遍，还没定",
    "strengths": "",
    "difficulties": "",
    "plan": "",
    "tasks": "",
    "subjects": {}
  },
  "styleReference": ""
}
```

完整最终输出：

```text
下次课准备带着【学生】一起复盘数列部分的错题。作业方面，目前想让孩子把之前的内容重做一遍，具体安排还没定下来。
```

</details>

<details>
<summary>晚辅：分科缩写 · 可采用 · sparse-evening-mixed-subjects</summary>

来源：`.local/evals/sparse-v010-final/feedback-20261022-003458-656193/report.json`；案例：`sparse-evening-mixed-subjects`。

初稿提示词 SHA-256：`988ad4a83df669ff6743ea4f05709d3391b2d3ce33cd7c3844cf6ad984a926d8`

复核提示词 SHA-256：`1c550727e5fa86a90d1463511133f70ac818348bc8611ece4a69d611069d819c`

最终正文 SHA-256（UTF-8）：`4a0e0dfd6364b3f2ca041b9b265dee13ae28eeea609742f37cbaa566fc04df54`

完整输入：

```json
{
  "module": "evening",
  "grade": "初三",
  "brief": {
    "periodStart": "2026-10-19",
    "periodEnd": "2026-10-23",
    "subjects": [
      "数学",
      "物理",
      "化学"
    ],
    "teachingContent": "",
    "commonTasks": "",
    "focus": "",
    "length": "standard"
  },
  "observations": {
    "performance": "作业都写完了。数：公式法会，因式分解选法不熟；物：串并联点一下能分清",
    "strengths": "",
    "difficulties": "",
    "plan": "",
    "tasks": "",
    "subjects": {}
  },
  "styleReference": ""
}
```

完整最终输出：

```text
本周【学生】的作业都写完了。数学方面，公式法会用，因式分解法的选用还不熟；物理方面，串、并联电路点一下能分清。

后续数学可以整理公式法和因式分解法各自的适用情形，做题前先观察式子结构，再决定用哪种方法。物理判断串、并联时，可以尝试先自己说出电流路径或连接特点，再对照检查，把判断依据说清楚。
```

</details>

<details>
<summary>晚辅：判断仍不确定 · 轻改 · sparse-evening-uncertain</summary>

来源：`.local/evals/sparse-v010-final/feedback-20261022-003458-656193/report.json`；案例：`sparse-evening-uncertain`。

初稿提示词 SHA-256：`cd5838841136cd2e7977b4d9c6f287b7ec87328d4aa6fa7b98b442a8785d1d71`

复核提示词 SHA-256：`6098db51ef64bda05a651d00997b3456e2ecaebd6716e950db7e070f0eda228e`

最终正文 SHA-256（UTF-8）：`d5843c52aaf608bc75f880c5e38dc4e1215581cbb52bc085355a26c0688a7bf7`

完整输入：

```json
{
  "module": "evening",
  "grade": "初二",
  "brief": {
    "periodStart": "2026-10-19",
    "periodEnd": "2026-10-23",
    "subjects": [
      "数学",
      "物理"
    ],
    "teachingContent": "",
    "commonTasks": "",
    "focus": "",
    "length": "standard"
  },
  "observations": {
    "performance": "物理只问了两题，看着会一点，还不确定；数学坐标图能画对",
    "strengths": "",
    "difficulties": "",
    "plan": "",
    "tasks": "",
    "subjects": {}
  },
  "styleReference": ""
}
```

完整最终输出：

```text
本周晚辅中：

1. 数学方面，【学生】能画对坐标图。

2. 物理方面，目前仅涉及两道题，从这两题看像是会一些，但暂时还不确定。后续可以让孩子把这两道题的思路再讲一遍，帮助判断是否已经理解。
```

</details>

<details>
<summary>晚辅：个人风格与计划 · 可采用 · sparse-evening-style-plan</summary>

来源：`.local/evals/sparse-v010-final/feedback-20261022-003458-656193/report.json`；案例：`sparse-evening-style-plan`。

初稿提示词 SHA-256：`23dd94ff191336c768ddc2872453b1f82c90e947cbdf887cfda48d8f9c9d6f20`

复核提示词 SHA-256：`5e3dbb2ab17ebe8efd9b22b198c064ba8aec9708b6c55a6a4f4b1ab4f247d12e`

最终正文 SHA-256（UTF-8）：`8581c8342a2185e827b0da5a8854443f829e8bbd4aff0f2cb2b8645d957fdcab`

完整输入：

```json
{
  "module": "evening",
  "grade": "初二",
  "brief": {
    "periodStart": "2026-10-19",
    "periodEnd": "2026-10-23",
    "subjects": [
      "数学",
      "物理"
    ],
    "teachingContent": "",
    "commonTasks": "",
    "focus": "",
    "length": "standard"
  },
  "observations": {
    "performance": "数学去括号又漏变号，提醒后能改；下周打算让孩子先圈负号再算",
    "strengths": "",
    "difficulties": "",
    "plan": "",
    "tasks": "",
    "subjects": {}
  },
  "styleReference": "本次观察：孩子能按步骤解简单方程，检查时发现一处漏写单位。\n下一步：可以在列式前把单位标在旁边，写完再对照检查。"
}
```

完整最终输出：

```text
本次观察：数学去括号时又漏变号，提醒后能改。

下一步：下周打算让孩子先圈出负号再计算。
```

</details>

<details>
<summary>班课：共用课程边界 · 可采用 · sparse-course-shared-boundary</summary>

来源：`.local/evals/sparse-v010-final/feedback-20261022-003457-068611/report.json`；案例：`sparse-course-shared-boundary`。

初稿提示词 SHA-256：`2d19d8d7099255245d01dd15a3c732d6226786bb560108a0e6671b7b4550c657`

复核提示词 SHA-256：`aaf667a6f45397da8efc869c2e63223b2f21244b82f05f6df0dc8e5f23a0d3cf`

最终正文 SHA-256（UTF-8）：`922662d279abffbc4a9d3e07851c86fccb7fb5d145b1ee4beae12f5aaed8cad6`

完整输入：

```json
{
  "module": "course",
  "grade": "高一",
  "brief": {
    "periodStart": "2026-10-01",
    "periodEnd": "2026-10-31",
    "subjects": [
      "数学"
    ],
    "teachingContent": "集合交并补、充要条件、基本不等式",
    "commonTasks": "",
    "focus": "",
    "length": "standard"
  },
  "observations": {
    "performance": "交并会自己做；补集总忘看全集，提醒后能改",
    "strengths": "",
    "difficulties": "",
    "plan": "",
    "tasks": "",
    "subjects": {}
  },
  "styleReference": ""
}
```

完整最终输出：

```text
本阶段课程围绕集合的交集、并集、补集，以及充要条件和基本不等式展开。

目前【学生】能自己完成交集、并集的题目；在补集题上会忘记先看全集，经过提醒后能够改正。后续做补集题时，可以先标出全集，明确补集是在哪个范围内取，再动笔计算，完成后回头核对结果是否落在全集范围内。
```

</details>

<details>
<summary>班课：条件转化卡点 · 可采用 · sparse-course-condition-transform</summary>

来源：`.local/evals/sparse-v010-final/feedback-20261022-003457-068611/report.json`；案例：`sparse-course-condition-transform`。

初稿提示词 SHA-256：`c85bbeffd67f1a54a877b3e15e7b7b09e480dce7f174da4a6ac8af500876e735`

复核提示词 SHA-256：`a97205040e6a05219cd3139f9892832d97d6fd931fbd9363df76d9a49c7c7ff7`

最终正文 SHA-256（UTF-8）：`8e9cd788ceac77a5a8fa8d33b252cbb62bbda8d92ca4bb147b780df01c23aa13`

完整输入：

```json
{
  "module": "course",
  "grade": "高一",
  "brief": {
    "periodStart": "2026-10-01",
    "periodEnd": "2026-10-31",
    "subjects": [
      "数学"
    ],
    "teachingContent": "基本不等式求最值",
    "commonTasks": "",
    "focus": "",
    "length": "standard"
  },
  "observations": {
    "performance": "会找题里条件，就是不知道往哪个式子变；给个开头能接着推",
    "strengths": "",
    "difficulties": "",
    "plan": "",
    "tasks": "",
    "subjects": {}
  },
  "styleReference": ""
}
```

完整最终输出：

```text
本阶段数学课围绕基本不等式求最值展开。

在求最值的题目中，【学生】能够找出题目给出的条件，但目前对“往哪个式子变”还不够清楚，也就是从已知条件到可以使用基本不等式的形式之间，第一步转化还不太有方向。给出一个开头后，能够顺着往下推导。

后续可以引导孩子先分别整理题目条件和目标式，再尝试把条件往目标式变形；如果第一步卡住，可以给一个开头，让孩子接着推，并核对取等条件是否可行。这样有助于把“找条件”和“选形式”逐步对应起来。
```

</details>

<details>
<summary>班课：有限进步 · 轻改 · sparse-course-small-change</summary>

来源：`.local/evals/sparse-v010-final/feedback-20261022-003457-068611/report.json`；案例：`sparse-course-small-change`。

初稿提示词 SHA-256：`e53747956be5d4a8f835e66f3d3b45f25b33c392f037039f3def06f3c40bdeef`

复核提示词 SHA-256：`66320774b5820f5c67f9aafba33a1777ce7bacb5335ec2c0b64caf0663058859`

最终正文 SHA-256（UTF-8）：`2c606126f71c88f849c5d070783d22db08f0625f1dbbc75fd4719983278eccbb`

完整输入：

```json
{
  "module": "course",
  "grade": "高一",
  "brief": {
    "periodStart": "2026-10-01",
    "periodEnd": "2026-10-31",
    "subjects": [
      "数学"
    ],
    "teachingContent": "一元二次不等式分类讨论",
    "commonTasks": "",
    "focus": "",
    "length": "standard"
  },
  "observations": {
    "performance": "上节同类题没思路，这次能先列式，算到一半还要提醒",
    "strengths": "",
    "difficulties": "",
    "plan": "",
    "tasks": "",
    "subjects": {}
  },
  "styleReference": ""
}
```

完整最终输出：

```text
本阶段课程学习了一元二次不等式的分类讨论。

这次做题时，【学生】能先列式，算到一半还需要提醒才能继续往下做。上一节遇到同类题时没有思路，这次能先起步列式，是可以看到的变化。

后续做这类题时，建议列式后先确定按什么标准分类，把要讨论的情况列清楚，再逐种情况求解。复盘时把列式之后的每一步写清楚，想明白这一步用到了哪个条件、为什么这样分情况，有助于从会开头逐步过渡到完整做完一道题。
```

</details>

<details>
<summary>预留一对一：开口方向 · 轻改 · holdout-one-to-one-opening</summary>

来源：`.local/evals/sparse-v010-final/feedback-20261022-003458-831468/report.json`；案例：`holdout-one-to-one-opening`。

初稿提示词 SHA-256：`12b2657c953d71061e373e700d8be5559f9a12c3f7b270a4901e91c319b7eb8e`

复核提示词 SHA-256：`3723c3153c31389db6a1a34ef675e79cf3031333020be6a64f37a8736b7ba18d`

最终正文 SHA-256（UTF-8）：`f4d2035a55fa1554ab50a0098d46d9bf5c6b17eefb01b8ee68d5bbfc9cc680db`

完整输入：

```json
{
  "module": "one-to-one",
  "grade": "初三",
  "brief": {
    "periodStart": "2026-10-22",
    "periodEnd": "2026-10-22",
    "subjects": [
      "数学"
    ],
    "teachingContent": "二次函数图像",
    "commonTasks": "",
    "focus": "",
    "length": "standard"
  },
  "observations": {
    "performance": "顶点式能认，画图时开口方向看反；提醒a的符号后改对",
    "strengths": "",
    "difficulties": "",
    "plan": "",
    "tasks": "",
    "subjects": {}
  },
  "styleReference": ""
}
```

完整最终输出：

```text
📚 1. 课堂学习内容
本节课学习二次函数图像。

🔎 2. 课堂表现与知识掌握情况
【学生】能认出二次函数的顶点式。画图时，【学生】把开口方向看反了；在提醒看二次项系数a的符号后，【学生】改对了。

💡 3. 课后建议
后续画二次函数图像时，建议先确认二次项系数a的正负，再判断开口方向；画完后可以回到顶点式核对a与开口方向是否一致，减少看反的情况。
```

</details>

<details>
<summary>预留晚辅：隔日再卡住 · 可采用 · holdout-evening-repeat-gap</summary>

来源：`.local/evals/sparse-v010-final/feedback-20261022-003458-656193/report.json`；案例：`holdout-evening-repeat-gap`。

初稿提示词 SHA-256：`c22335db945f3aa807dba7ac22f09f20404e3ccbe543dc13cea3a4ed2f5244f0`

复核提示词 SHA-256：`6d814bbd88bbe4f334a50c5249329cd217661e8eb4d41d18d0077c1add063c20`

最终正文 SHA-256（UTF-8）：`dcd02f6461f3b97d5c26bdbccedaf9d9df281c064539b7fcb135d88c6a7ddb18`

完整输入：

```json
{
  "module": "evening",
  "grade": "初二",
  "brief": {
    "periodStart": "2026-10-19",
    "periodEnd": "2026-10-23",
    "subjects": [
      "数学",
      "物理"
    ],
    "teachingContent": "",
    "commonTasks": "",
    "focus": "",
    "length": "standard"
  },
  "observations": {
    "performance": "数题讲完当场会，周三同类题又卡住；物理本周没看作业",
    "strengths": "",
    "difficulties": "",
    "plan": "",
    "tasks": "",
    "subjects": {}
  },
  "styleReference": ""
}
```

完整最终输出：

```text
本周数学方面，【学生】在题目讲完后能当场理解；周三再遇到同类题时又卡住了，后续需要继续巩固。可以请【学生】把讲过的例题和周三卡住的同类题放在一起对照，找出自己再做时卡住的那一步，再不看讲解重做一遍，做完后用自己的话说清这一步为什么这样处理。物理本周的作业暂未查看。
```

</details>

<details>
<summary>预留班课：范围与任务 · 可采用 · holdout-course-scope-and-task</summary>

来源：`.local/evals/sparse-v010-final/feedback-20261022-003457-068611/report.json`；案例：`holdout-course-scope-and-task`。

初稿提示词 SHA-256：`9e97277504f18fda3051f331a1cd806c274f2b0a6dec501da0042ac19a0fc2e0`

复核提示词 SHA-256：`4558c2f4d02f72642872bbaf88a62f6c24ae7fc60b88f33434d7cb9a616c3a1f`

最终正文 SHA-256（UTF-8）：`1502445568673efec880285ae3ea5cc231cb71dbdd9254b36df62c8b18ca34f3`

完整输入：

```json
{
  "module": "course",
  "grade": "高一",
  "brief": {
    "periodStart": "2026-10-01",
    "periodEnd": "2026-10-31",
    "subjects": [
      "数学"
    ],
    "teachingContent": "集合运算、充分条件和必要条件",
    "commonTasks": "订正这次讲义中的错题",
    "focus": "",
    "length": "standard"
  },
  "observations": {
    "performance": "集合那组都做对了，充要条件只会照例题，换个说法就反",
    "strengths": "",
    "difficulties": "",
    "plan": "",
    "tasks": "",
    "subjects": {}
  },
  "styleReference": ""
}
```

完整最终输出：

```text
本阶段课程学习了集合运算、充分条件和必要条件。

从课堂练习情况看，【学生】集合运算这一组题都做对了。充分条件和必要条件的判断目前还主要靠对照例题，题目换个说法就容易把关系判断反。

后续可以这样帮孩子：判断充要条件时，先分清题目中的条件和结论，写成“若p则q”的形式，再看p能不能推出q、q能不能推出p，两边的结果分别对应什么关系；遇到换过说法的题目，先把它翻译回这种形式，再作判断。也可以拿做过的例题练一练，把条件和结论互换，或者换一种表述，自己判断关系有没有变化，慢慢熟悉不同说法之间的对应。

这次讲义中的错题需要订正。
```

</details>

## 三条丰富旧例的回归核对

这 3 条旧例只用于核对压缩短反馈的改动是否丢掉丰富记录中的课程、表现、掌握层次和任务。下列核对不把它们计入 15 条短例的判定比例，也不展示数千字全文；完整正文仍保存在对应原始报告。以下为 Codex 对照输入进行的事实保留核对，不是生成原文的替代版本。

<details>
<summary>one-to-one-recursion：课程与事实保留核对</summary>

概率及等差/等比数列的五类课程内容保留；专注、独立思考、讲解后自己订正、三项具体困难和重点复习等比数列的作业均保留。

来源：`.local/evals/sparse-v010-final-rich/feedback-20261022-003459-888488/report.json`；案例：`one-to-one-recursion`。

初稿提示词 SHA-256：`5df47633cf3bca563137189b8e3eb5caea5a0aad6a7042352c0515a81b35e67c`

复核提示词 SHA-256：`1efca9b9f460699b6aa6a63a489d2278653bbdb6ad8e9cfa5c2ade201d6eac0b`

最终正文 SHA-256（UTF-8）：`d808cba635950c8273ba7aa17ba2dddf3bff5f6c6f490685d75993929fd0f2ec`

</details>

<details>
<summary>evening-uncertain：课程与事实保留核对</summary>

间歇聊天与作业效率不错同时保留；实数计算困难和坐标图表现分开；物理只从交流推测、作业较少的依据和不确定程度保留。

来源：`.local/evals/sparse-v010-final-rich/feedback-20261022-003459-888488/report.json`；案例：`evening-uncertain`。

初稿提示词 SHA-256：`a35152beae576c03e5089685fde7e5c521dd2361445543ade66cdf734aa8c9c7`

复核提示词 SHA-256：`ff79945f7fe2c3e9788a698d4ef5abb4bba16f019402af4e7b3e807a28cde244`

最终正文 SHA-256（UTF-8）：`5531a20fea620c75fa46b46d0a363efc90ed7d9cb6bad04c16a77e4efbba62e7`

</details>

<details>
<summary>course-classroom-balance：课程与事实保留核对</summary>

集合与不等式阶段内容及月考练习背景保留；活泼与玩笑影响听课、认真做题、速度一般但正确率高、多选问题和提示后才能完成均保留。

来源：`.local/evals/sparse-v010-final-rich/feedback-20261022-003459-888488/report.json`；案例：`course-classroom-balance`。

初稿提示词 SHA-256：`0a74c51c7bc7e008920982a7a7e8b4b6640f74e717bd02174a32592a1c38c54e`

复核提示词 SHA-256：`4ae53439314c320dcfe5f7935247e3672da26a6caa1a31dc9b69a92ad531fae0`

最终正文 SHA-256（UTF-8）：`00dce39a14448b11efd53af98def5d11efb3ab940fc0227a55ac425c9741cdd7`

</details>

## 限制与下一步判断边界

- **5 个最终短例仍需轻改**：重复语句、拟重做对象变模糊、不确定状态措辞及称呼重复都可能增加教师修改成本；不能宣称所有反馈已可直接发送。
- 样本数量有限，只有一个模型，每个案例在每个版本只有一次生成。本轮没有重复采样稳定性测量，不能把编辑判断比例外推成产品质量保证。
- 3 条预留例在中间阶段首次运行，最终又随统一版本重测；“预留”描述的是其最初分组，并不表示每轮最终结果都是此前完全未见的首次独立检验。
- 没有测量真实教师的填写时间、修改时间或发送接受度；简短输入与输出缩短不能证明实际节省了多少时间。
- 所有评测资料与学生数据库独立，真实用户的记录习惯、个人风格、学科组合和事实歧义仍需要试用验证。
- 事实很少时，合适结果可能只有一小段；不应为了达到成熟范文长度而新增表现、原因、任务或教学承诺。仍需教师在发送前确认现实事实和学科建议。

## 报告索引与追溯方法

下表列出本轮全部原始报告及文件 SHA-256。`.local/evals` 是本地评测目录，不要求上传服务设置、密钥或数据库；原始报告不随本文变更。本文已保留 15 条最终短例的完整输入输出，读者无需访问本地目录即可查看这些证据。

| 阶段 | 报告路径 | 结果数 / 请求数 | 报告文件 SHA-256 |
|---|---|---:|---|
| baseline | `.local/evals/sparse-v010-baseline/feedback-20261022-002556-985961/report.json` | 4 / 8 | `3a71c28f715dd4d725da0637bf96ea1b0ca24f64524639fd52804f8e4fbfc60d` |
| baseline | `.local/evals/sparse-v010-baseline/feedback-20261022-002616-056147/report.json` | 4 / 8 | `a66f831727f15fe08231ec52b838dee33fccb13ed015d34e6b8de087ca9532ba` |
| baseline | `.local/evals/sparse-v010-baseline/feedback-20261022-002618-254822/report.json` | 4 / 8 | `ad7a79bfe1db1fc8410c73cc7267582c36f55b58bf56e3f67596cad624338d90` |
| after | `.local/evals/sparse-v010-after/feedback-20261022-003230-502134/report.json` | 4 / 8 | `e7e95bd7f1918736b79dff1d8d1453b889d39b5e0768439883f1e2ccb6871f7d` |
| after | `.local/evals/sparse-v010-after/feedback-20261022-003230-906264/report.json` | 4 / 8 | `bc28654f154ec1f9a06fe68891cd0f05a2d7f171596663b14e51b22b409c2437` |
| after | `.local/evals/sparse-v010-after/feedback-20261022-003232-782359/report.json` | 4 / 8 | `a95e3fa5c49f25d1ca7eb9db60c66a120faf8ef1ada4746d0a851496f37f7aca` |
| holdout | `.local/evals/sparse-v010-holdout/feedback-20261022-003319-178886/report.json` | 3 / 6 | `f06d54b6eb6b7598bfa53c16da50f04c39ae81f6456ec895d3a4708192d6de4a` |
| regression | `.local/evals/sparse-v010-regression/feedback-20261022-003333-056869/report.json` | 3 / 6 | `a8c35c91c081cd8fe77fb6808a982290ea97cdc88b784a665fe838195ebffdeb` |
| final | `.local/evals/sparse-v010-final/feedback-20261022-003457-068611/report.json` | 5 / 10 | `347ecba5724f41dac744faeaa55ebccded5dc718a265a9465f222d203f174246` |
| final | `.local/evals/sparse-v010-final/feedback-20261022-003458-656193/report.json` | 5 / 10 | `977a8b8e10162f11dc4f149735ee15a3d70c21e569f3b66bb91b06499713b14f` |
| final | `.local/evals/sparse-v010-final/feedback-20261022-003458-831468/report.json` | 5 / 10 | `456f22b7aadac5927bb519572a0726597e8118920464601b0a63ac60f325ab39` |
| final-rich | `.local/evals/sparse-v010-final-rich/feedback-20261022-003459-888488/report.json` | 3 / 6 | `66c7a20c23260099ddddc4878368ee495b46e8375442d123a159af4a58370a07` |

各案例的初稿与复核提示词哈希直接来自报告的 `providerCalls[*].promptSha256`。正文哈希按报告 `content` 的原始字符串以 UTF-8 编码计算 SHA-256，不包含 Markdown 代码块围栏或额外换行。报告文件哈希对原文件字节计算；`request` 的排版仅用于阅读，字段值未改变。
