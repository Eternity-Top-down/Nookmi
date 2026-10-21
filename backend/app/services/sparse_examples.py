"""Synthetic sparse-note examples, separate from held-out evaluation cases.

These complement the teacher's rich examples without supplying current facts.
"""

SPARSE_EXAMPLES: dict[str, dict] = {
    "one-to-one": {
        "input": {
            "teachingContent": "整式乘法：平方差公式与完全平方公式",
            "performance": "平方差能独立做对；完全平方漏中间项，提醒后补对",
            "tasks": "",
        },
        "output": """📖 1. 课堂学习内容
本节课学习了整式乘法中的平方差公式与完全平方公式。

✨ 2. 课堂表现与知识掌握情况
平方差公式的题目，【学生】能独立完成并做对；运用完全平方公式时漏了中间项，经过提醒后能补充正确。

🔍 3. 课后建议
针对完全平方公式，建议展开后检查是否写出了两项乘积的两倍，并结合原式核对这一项的正负号，减少漏项。""",
    },
    "evening": {
        "input": {
            "performance": "周四物理作业单位写错，提醒后改了，其他科没看",
        },
        "output": """本周四的物理作业中，【学生】出现了单位写错的情况，提醒后已改正。后续写出结果时，可以把所求的物理量和对应单位一起核对，帮助减少这类错误。""",
    },
    "course": {
        "input": {
            "teachingContent": "平面直角坐标系，点的坐标",
            "performance": "横纵坐标顺序写反了一次，提醒后改对",
        },
        "output": """本阶段课程学习了平面直角坐标系与点的坐标。

练习中，【学生】有一次把横、纵坐标的顺序写反，经过提醒后能改正。后续表示点的坐标时，建议按“先横坐标、后纵坐标”的顺序书写，再与图中的位置对应检查。""",
    },
}
