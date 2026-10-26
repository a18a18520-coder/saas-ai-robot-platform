'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {Ocr}=require('../src/core/ocr.cjs');
const fs=require('node:fs/promises');
(async () => {
  const ocr = new Ocr(path.resolve(__dirname, '../resources/ocr'));
  try {
    const bytes = await fs.readFile(path.resolve(__dirname, '../test/fixtures/ocr-synthetic.png'));
    // Stop while createWorker has not even returned. Observe actual process exit.
    const canceled = assert.rejects(ocr.recognize(bytes), /已停止/);
    await ocr.close(); await canceled; assert.equal(ocr.child, null);
    // A deliberately short deadline exercises real startup termination, not a
    // mocked Promise.race. Production recognition still has a 60-second limit.
    ocr.timeoutMs = 1;
    await assert.rejects(ocr.recognize(bytes), /超过时限/);
    await ocr.close(); assert.equal(ocr.child, null);
    ocr.timeoutMs = 60000;
    const result = await ocr.recognize(bytes);
    assert.match(result.ocrText, /1\.2/);
    assert.match(result.ocrText, /否/);
    assert.match(result.ocrText, /DEVICE-DEMO-17/);
    console.log('PASS: actual OCR startup cancellation, timeout, process exit and fresh-process recovery.');
    console.log('Local bilingual OCR recognized synthetic amount, negation and device ID:', Math.round(result.confidence));
  } finally { await ocr.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
