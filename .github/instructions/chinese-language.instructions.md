---
applyTo: "**"
description: "Use when generating code comments, commit messages, PR titles, change summaries, or review notes. Always output in Chinese unless the user explicitly requests another language."
---

# Chinese output requirement

- 任何新生成的代码注释、说明文字、docstring、TODO、提交消息、PR 标题、变更说明、审查备注都必须使用中文。
- 只有在用户明确要求英文或其他语言时，才允许输出非中文。
- 技术标识符、API 名称、库名、命令名、变量名等保持原样，不强制翻译。
- 不要混用中文和英文的说明文本；一旦需要修改，统一为中文。
- 生成提交摘要、变更描述、Release note 和 review note 时，默认使用中文而不是英文。
