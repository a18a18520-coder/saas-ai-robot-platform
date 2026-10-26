'use strict';
const { createWorker, PSM } = require('tesseract.js');
const port = process.parentPort;
let worker, busy = false;
const send = message => port ? port.postMessage(message) : process.send?.(message);

async function recognize(message) {
  if (busy || !Number.isSafeInteger(message?.id)) return;
  busy = true;
  try {
    if (!worker) {
      worker = await createWorker(['chi_sim', 'eng'], 1, { langPath: message.resourceDir, cacheMethod: 'none', gzip: true, errorHandler: () => {} });
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
    }
    const result = await worker.recognize(Buffer.from(message.bytes), {}, { text: true, blocks: true });
    const lines = (result.data.blocks || []).flatMap(b => b.paragraphs || []).flatMap(p => p.lines || []).slice(0, 500).map(l => ({ text: l.text, confidence: l.confidence, bbox: l.bbox }));
    send({ id: message.id, type: 'result', ocrText: result.data.text, confidence: result.data.confidence, lines });
  } catch {
    // Never include the image, transcript, filesystem path or library error in IPC diagnostics.
    send({ id: message.id, type: 'error' });
  } finally { busy = false; }
}
if (port) port.on('message', event => { recognize(event.data).catch(() => process.exit(1)); });
else {
  process.on('message', message => { recognize(message).catch(() => process.exit(1)); });
  process.on('disconnect', () => process.exit(0));
}
