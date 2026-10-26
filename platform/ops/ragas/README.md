# 租户 Ragas 评测

安装（项目根目录，Python 3.11）：

```sh
uv venv --python 3.11 .runtime/ragas-py311
uv pip install --python .runtime/ragas-py311/bin/python -r ops/ragas/requirements.txt
.runtime/ragas-py311/bin/python ops/ragas/evaluate.py --check
```

后端也可用 RAGAS_PYTHON 指定 Python 路径。Python 进程只通过私有标准输入/输出调用平台模型网关，不持有密钥；沿用租户模型授权、重试、备用模型及 Token 统计。关闭 Ragas 遥测。

租户入口 /t/evaluations。添加人工标准答案和测试身份，运行真实授权检索。传入 Ragas 的上下文是本轮实际送给回答模型的证据（包括 Wiki 和已执行只读工具），不是最终引用文档的数量。

指标：Faithfulness、FactualCorrectness（F1）、LLMContextPrecisionWithReference、LLMContextRecall。均为 0–1，越高越好；无有效分值显示部分完成，不伪造为零。未接入需要向量模型的 ResponseRelevancy。

结果保存配置、问题、身份、回答、证据、评分和版本。阈值仅作调优建议。提示词草案可编辑并在独立会话中复测，比较相同用例的分值，再保存到机器人未发布草稿。线上配置仍需要原机器人发布操作。检索或切片问题不会被提示词自动“修好”；模型辅助评测应配合人工抽查。

当前部署为单后端评测工作进程，每租户最多同时一个，全局最多四个。每次评测最多十分钟；重启将运行中的任务标为中断，租户可重试。横向扩容前需迁移到持久队列与任务租约，不能启动多个评测工作进程。
