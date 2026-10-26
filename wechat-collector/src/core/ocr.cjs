'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { fork } = require('node:child_process');

function nodeProcess(entry) {
  const child = fork(entry, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced', execArgv: [] });
  return { events: child, send: message => child.send(message, error => { if (error) child.emit('error', error); }), kill: () => child.kill() };
}

/** Supervise initialization AND recognition. Terminating the process also ends
 * Tesseract's worker threads, even when createWorker has not returned a handle. */
class Ocr {
  constructor(resourceDir, { spawn = nodeProcess, timeoutMs = 60000, stopTimeoutMs = 3000 } = {}) {
    this.resourceDir = resourceDir;
    this.spawn = spawn;
    this.timeoutMs = timeoutMs;
    this.stopTimeoutMs = stopTimeoutMs;
    this.child = null;
    this.job = null;
    this.sequence = 0;
  }

  async recognize(bytes) {
    if (this.job) throw new Error('正在识别上一张截图');
    if (this.child?.closing) throw new Error('旧 OCR 进程尚未退出，请稍后重试；持续失败请重启应用');
    for (const lang of ['chi_sim', 'eng']) {
      if (!fs.existsSync(path.join(this.resourceDir, `${lang}.traineddata.gz`))) throw new Error('本地 OCR 语言包缺失，请重新安装完整应用');
    }
    if (!this.child) this.start();
    const state = this.child;
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.finish(new Error('OCR 超过时限，请缩小区域后重试'), null, id);
        this.stop(state).catch(() => {});
      }, this.timeoutMs);
      this.job = { id, resolve, reject, timer, state };
      try { state.process.send({ id, resourceDir: this.resourceDir, bytes }); }
      catch { this.finish(new Error('无法发送截图到本地 OCR 进程'), null, id); this.stop(state).catch(() => {}); }
    });
  }

  start() {
    const state = { process: this.spawn(path.join(__dirname, 'ocr-process.cjs')), closing: false, exited: false, stopped: null };
    this.child = state;
    state.process.events.on('spawn', () => {
      // A stop can arrive before the OS has assigned the child a PID.
      if (state.closing && !state.exited) { try { state.process.kill(); } catch {} }
    });
    state.process.events.on('message', message => {
      if (state.closing || !this.job || this.job.state !== state || message?.id !== this.job.id) return;
      if (message.type !== 'result' || typeof message.ocrText !== 'string' || message.ocrText.length > 20000 || !Number.isFinite(message.confidence) || message.confidence < 0 || message.confidence > 100) {
        this.finish(new Error('本地 OCR 未返回有效结果，请缩小区域后重试'));
        this.stop(state).catch(() => {});
        return;
      }
      this.finish(null, { ocrText: message.ocrText, confidence: message.confidence, ...(Array.isArray(message.lines) ? { lines: message.lines.slice(0, 500) } : {}) });
    });
    state.process.events.on('error', () => {
      if (this.job?.state === state) this.finish(new Error('本地 OCR 进程异常，请重试'));
      this.stop(state).catch(() => {});
    });
    state.process.events.once('exit', () => {
      state.exited = true;
      if (this.job?.state === state) this.finish(new Error('本地 OCR 进程已退出，请重试'));
      if (this.child === state) this.child = null;
      state.onExit?.();
    });
  }

  finish(error, value, id = this.job?.id) {
    if (!this.job || this.job.id !== id) return;
    const job = this.job;
    this.job = null;
    clearTimeout(job.timer);
    if (error) job.reject(error); else job.resolve(value);
  }

  stop(state) {
    if (!state || state.exited) return Promise.resolve();
    if (state.stopped) return state.stopped;
    state.closing = true;
    state.stopped = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('旧 OCR 进程尚未退出，请重启应用后重试')), this.stopTimeoutMs);
      state.onExit = () => { clearTimeout(timer); resolve(); };
      try { state.process.kill(); }
      catch { clearTimeout(timer); reject(new Error('无法停止 OCR 进程，请重启应用')); }
    });
    return state.stopped;
  }

  async close() {
    this.finish(new Error('OCR 已停止，本次结果未保存'));
    return this.stop(this.child);
  }
}
module.exports = { Ocr };
