'use strict';
// Conservative light-theme text-bubble recognizer. No model guesses a sender.
// Unknown layouts, clipped bubbles, cards, weak OCR and missing nicknames stay local.
function extractMessages({ bitmap, width, height, lines, selfNickname = '' }) {
  if (!Buffer.isBuffer(bitmap) || !Number.isInteger(width) || !Number.isInteger(height) || width < 160 || height < 100 || width * height > 16000000 || bitmap.length !== width * height * 4 || !Array.isArray(lines) || lines.length > 500) return [];
  const usable = lines.filter(l => typeof l.text === 'string' && l.text.trim() && l.text.length < 2000 && Number.isFinite(l.confidence) && l.bbox && Object.values(l.bbox).every(Number.isFinite));
  const step = 2, w = Math.floor(width / step), h = Math.floor(height / step), mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * step * width + x * step) * 4, a = bitmap[p], g = bitmap[p + 1], b = bitmap[p + 2];
    // White and green tests are invariant under BGRA/RGBA red/blue order.
    mask[y * w + x] = bitmap[p + 3] < 250 ? 0 : a > 248 && g > 248 && b > 248 ? 1 : g > 205 && g > a + 35 && g > b + 35 && a > 70 && b > 70 ? 2 : 0;
  }
  const queue = new Int32Array(w * h), boxes = [];
  for (let p = 0; p < mask.length; p++) {
    const kind = mask[p]; if (!kind) continue;
    let head = 0, tail = 1, minX = w, minY = h, maxX = 0, maxY = 0; queue[0] = p; mask[p] = 0;
    while (head < tail) {
      const q = queue[head++], x = q % w, y = Math.floor(q / w);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const n of [x ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y ? q - w : -1, y < h - 1 ? q + w : -1]) if (n >= 0 && mask[n] === kind) { mask[n] = 0; queue[tail++] = n; }
    }
    const bw = (maxX - minX + 1) * step, bh = (maxY - minY + 1) * step;
    if (bw < 42 || bh < 24 || bh > Math.min(180, height * .4) || bw > width * .75 || minX < 3 || minY < 3 || maxX > w - 4 || maxY > h - 4 || tail / ((maxX - minX + 1) * (maxY - minY + 1)) < .82) continue;
    if (kind === 1 && minX * step > width * .35 || kind === 2 && maxX * step < width * .65) continue;
    boxes.push({ x0: minX * step, y0: minY * step, x1: (maxX + 1) * step, y1: (maxY + 1) * step, kind });
  }
  const output = [];
  for (const box of boxes.sort((a, b) => a.y0 - b.y0)) {
    const inside = usable.filter(l => l.bbox.x0 >= box.x0 + 2 && l.bbox.x1 <= box.x1 - 2 && l.bbox.y0 >= box.y0 + 2 && l.bbox.y1 <= box.y1 - 2).sort((a,b) => a.bbox.y0 - b.bbox.y0);
    if (!inside.length || inside.length > 5) continue;
    const content = inside.map(l => l.text.trim()).join('\n');
    const candidates = usable.filter(l => l.bbox.x0 >= 4 && l.bbox.y0 >= 4 && l.bbox.x1 <= width - 4 && l.bbox.y1 <= height - 4 && l.bbox.y1 < box.y0 && box.y0 - l.bbox.y1 <= 42 && Math.abs(l.bbox.x0 - box.x0) <= 12 && l.text.trim().length <= 128);
    const nickname = box.kind === 2 ? selfNickname : candidates.length === 1 ? candidates[0].text.trim() : '';
    const confidence = Math.min(...inside.map(l => l.confidence), ...(box.kind === 1 ? candidates.map(l => l.confidence) : [100]));
    const intersects = usable.some(l => l.bbox.x0 < box.x1 && l.bbox.x1 > box.x0 && l.bbox.y0 < box.y1 && l.bbox.y1 > box.y0 && !inside.includes(l));
    const card = /\[图片\]|\[视频\]|\[语音\]|撤回|聊天记录|转账|红包|https?:\/\//.test(content);
    // Large empty areas or irregular line positions may be image/file/quote cards.
    const textHeight = inside.at(-1).bbox.y1 - inside[0].bbox.y0;
    const simple = !intersects && !card && textHeight >= (box.y1 - box.y0) * .3 && inside.every(l => Math.abs(l.bbox.x0 - inside[0].bbox.x0) <= 6);
    output.push({ content, senderNickname: nickname, isSelf: box.kind === 2, confidence,
      reliable: !!nickname && confidence >= 96 && simple,
      reason: !nickname ? '未识别昵称；右侧消息需填写本人的微信昵称' : confidence < 96 ? 'OCR 识别质量不足' : !simple ? '可能包含卡片、引用或图文，请核对单条原文' : '' });
  }
  return output;
}
module.exports = { extractMessages };
