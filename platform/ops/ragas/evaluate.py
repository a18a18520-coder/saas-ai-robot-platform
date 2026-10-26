"""Ragas worker. Model calls go back through the tenant's metered model gateway.

stdin/stdout are private JSON-lines pipes, never HTTP or credential-bearing args.
"""
import os
os.environ['RAGAS_DO_NOT_TRACK'] = 'true'
import asyncio
import json
import math
import sys
from importlib.metadata import version
from langchain_core.outputs import Generation, LLMResult
from ragas import SingleTurnSample
from ragas.llms import BaseRagasLLM
from ragas.run_config import RunConfig
from ragas.metrics import Faithfulness, FactualCorrectness, LLMContextPrecisionWithReference, LLMContextRecall


def emit(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)


class PlatformLLM(BaseRagasLLM):
    def is_finished(self, response):
        return True

    def generate_text(self, prompt, n=1, temperature=None, stop=None, callbacks=None):
        generations = []
        for _ in range(n):
            emit({'type': 'generate', 'prompt': prompt.to_string()})
            reply = json.loads(sys.stdin.readline())
            if 'error' in reply:
                raise RuntimeError(reply['error'])
            generations.append(Generation(text=reply['text']))
        return LLMResult(generations=[generations])

    async def agenerate_text(self, prompt, n=1, temperature=None, stop=None, callbacks=None):
        return self.generate_text(prompt, n, temperature, stop, callbacks)


async def main():
    if '--check' in sys.argv:
        emit({'engine': 'ragas', 'version': version('ragas')})
        return
    data = json.loads(sys.stdin.readline())
    sample = SingleTurnSample(**data)
    llm = PlatformLLM(run_config=RunConfig(max_retries=1, timeout=180))
    metrics = {
        'faithfulness': Faithfulness(llm=llm),
        'factual_correctness': FactualCorrectness(llm=llm),
        'context_precision': LLMContextPrecisionWithReference(llm=llm),
        'context_recall': LLMContextRecall(llm=llm),
    }
    scores, errors = {}, {}
    for name, metric in metrics.items():
        emit({'type': 'progress', 'metric': name})
        try:
            value = float(await metric.single_turn_ascore(sample))
            if not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError('No finite score')
            scores[name] = value
        except Exception:
            scores[name] = None
            errors[name] = '指标未完成，请检查模型响应或证据内容后重试'
    emit({'type': 'result', 'engine': 'ragas', 'version': version('ragas'), 'scores': scores, 'errors': errors})


if __name__ == '__main__':
    asyncio.run(main())
