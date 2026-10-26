"""Dify code node: preserve parent paragraphs and emit one sentence per child.

Only extremely long sentences are split at clauses/whitespace, then at the cap.
No model-generated text is used as the source of indexed evidence.
"""
import re

MAX_CHILD_CHARS = 512
CLOSERS = '”’"\'」』）)]】》'
ABBREVIATIONS = {'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'e.g', 'i.e'}


def sentences(text):
    result, start, i = [], 0, 0
    while i < len(text):
        char = text[i]
        boundary = char in '。！？!?'
        if char == '.':
            prefix = re.search(r'([A-Za-z.]+)$', text[:i])
            word = prefix.group(1).lower() if prefix else ''
            boundary = (i + 1 == len(text) or text[i + 1].isspace() or text[i + 1] in CLOSERS)
            if word in ABBREVIATIONS or (prefix and len(word) == 1 and prefix.group(1).isupper()):
                boundary = False
        if char == '…' and i + 1 < len(text) and text[i + 1] == '…':
            boundary = True
        if boundary:
            end = i + 1
            while end < len(text) and text[end] in '。！？!?.…' + CLOSERS:
                end += 1
            value = text[start:end].strip()
            if value:
                result.append(value)
            start, i = end, end
        else:
            i += 1
    if text[start:].strip():
        result.append(text[start:].strip())
    return result


def bounded(sentence):
    parts = []
    while len(sentence) > MAX_CHILD_CHARS:
        window = sentence[:MAX_CHILD_CHARS]
        breaks = [m.end() for m in re.finditer(r'[，,；;：:\s]', window)]
        cut = max((p for p in breaks if p >= MAX_CHILD_CHARS // 2), default=MAX_CHILD_CHARS)
        if sentence[:cut].strip():
            parts.append(sentence[:cut].strip())
        sentence = sentence[cut:].lstrip()
    if sentence:
        parts.append(sentence)
    return parts


def main(chunks: dict) -> dict:
    if not isinstance(chunks, dict) or not isinstance(chunks.get('parent_child_chunks'), list):
        raise ValueError('Parent-child Chunker result is required')
    parents, count, long_count = [], 0, 0
    for parent in chunks['parent_child_chunks']:
        text = parent.get('parent_content', '')
        if not isinstance(text, str):
            raise ValueError('Invalid parent content')
        children = []
        for sentence in sentences(text):
            if len(sentence) > MAX_CHILD_CHARS:
                long_count += 1
            children.extend(bounded(sentence))
        if children:
            parents.append({'parent_content': text, 'child_contents': children})
            count += len(children)
    if not parents:
        raise ValueError('No non-empty sentences to index')
    return {'result': {'parent_mode': 'paragraph', 'parent_child_chunks': parents},
            'sentence_count': count, 'long_sentence_count': long_count}
