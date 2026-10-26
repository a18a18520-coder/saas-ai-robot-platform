'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Ocr } = require('../src/core/ocr.cjs');

async function setup(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'collector-ocr-test-'));
  await Promise.all(['eng', 'chi_sim'].map(lang => fs.writeFile(path.join(dir, `${lang}.traineddata.gz`), 'synthetic placeholder')));
  const children = [];
  const ocr = new Ocr(dir, { timeoutMs: 1000, stopTimeoutMs: 50, ...options, spawn: () => {
    const events = new EventEmitter();
    const child = { events, sent: [], kills: 0, exitOnKill: true, send(message) { this.sent.push(message); }, kill() { this.kills++; if (this.exitOnKill) queueMicrotask(() => events.emit('exit', 0)); } };
    children.push(child); return child;
  } });
  t.after(async () => {
    const closing = ocr.close();
    for (const child of children) child.events.emit('exit', 0);
    await closing.catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  });
  const result = (child, data = {}) => child.events.emit('message', { id: child.sent.at(-1).id, type: 'result', ocrText: '合成金额：1.2万元；已确认：否。', confidence: 94, ...data });
  return { dir, ocr, children, result };
}

test('OCR reuses the isolated process only after the previous result settles', async t => {
  const { ocr, children, result } = await setup(t);
  const first = ocr.recognize(Buffer.from('synthetic'));
  await assert.rejects(ocr.recognize(Buffer.from('synthetic')), /上一张/);
  result(children[0]); assert.equal((await first).confidence, 94);
  const second = ocr.recognize(Buffer.from('synthetic'));
  result(children[0]); await second;
  assert.equal(children.length, 1); assert.notEqual(children[0].sent[0].id, children[0].sent[1].id);
});

test('OCR deadline includes startup and releases a never-initialized process for retry', async t => {
  const { ocr, children, result } = await setup(t, { timeoutMs: 20 });
  await assert.rejects(ocr.recognize(Buffer.from('synthetic')), /超过时限/);
  assert.equal(children[0].kills, 1);
  const next = ocr.recognize(Buffer.from('synthetic'));
  result(children[1]); assert.equal((await next).confidence, 94);
});

test('stop rejects an active OCR job and discards all late results', async t => {
  const { ocr, children, result } = await setup(t);
  const rejected = assert.rejects(ocr.recognize(Buffer.from('synthetic')), /已停止/);
  const old = children[0]; await ocr.close(); await rejected;
  const next = ocr.recognize(Buffer.from('synthetic'));
  result(old, { ocrText: 'stale' });
  result(children[1]); assert.notEqual((await next).ocrText, 'stale');
});

test('a child that has not exited blocks replacement instead of accumulating workers', async t => {
  const { ocr, children } = await setup(t, { timeoutMs: 20 });
  const task = ocr.recognize(Buffer.from('synthetic')); children[0].exitOnKill = false;
  await assert.rejects(task, /超过时限/);
  await assert.rejects(ocr.close(), /尚未退出/);
  await assert.rejects(ocr.recognize(Buffer.from('synthetic')), /尚未退出/);
  assert.equal(children.length, 1);
});

test('stop before spawn is retried once the child becomes killable', async t => {
  const { ocr, children } = await setup(t);
  const rejected = assert.rejects(ocr.recognize(Buffer.from('synthetic')), /已停止/);
  const child = children[0]; child.exitOnKill = false;
  const closing = ocr.close(); child.exitOnKill = true; child.events.emit('spawn');
  await closing; await rejected; assert.equal(child.kills, 2);
});

test('unexpected OCR process exit rejects immediately and allows a clean retry', async t => {
  const { ocr, children, result } = await setup(t);
  const rejected = assert.rejects(ocr.recognize(Buffer.from('synthetic')), /进程已退出/);
  children[0].events.emit('exit', 1); await rejected;
  const next = ocr.recognize(Buffer.from('synthetic')); result(children[1]); await next;
});

for (const data of [{ type: 'error', detail: 'PRIVATE TRANSCRIPT' }, { confidence: NaN }, { ocrText: 'x'.repeat(20001) }, { confidence: 101 }]) {
  test('invalid OCR result is rejected without exposing worker diagnostics: ' + Object.keys(data).join(','), async t => {
    const { ocr, children, result } = await setup(t);
    const task = ocr.recognize(Buffer.from('synthetic')); result(children[0], data);
    await assert.rejects(task, error => /未返回有效结果/.test(error.message) && !error.message.includes('PRIVATE'));
    assert.equal(children[0].kills, 1);
  });
}

test('wrong job IDs do not fulfill a pending OCR request', async t => {
  const { ocr, children, result } = await setup(t);
  const task = ocr.recognize(Buffer.from('synthetic'));
  result(children[0], { id: -1, ocrText: 'wrong' });
  result(children[0]); assert.notEqual((await task).ocrText, 'wrong');
});

test('missing language data fails before starting a process', async t => {
  const { ocr, children } = await setup(t); ocr.resourceDir = path.join(ocr.resourceDir, 'missing');
  await assert.rejects(ocr.recognize(Buffer.from('synthetic')), /语言包缺失/);
  assert.equal(children.length, 0);
});
