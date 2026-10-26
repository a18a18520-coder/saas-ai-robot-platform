'use strict';

function dockBounds(target, workArea, width = 380) {
  const valid = rect => rect && ['x','y','width','height'].every(key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0;
  if (!valid(target) || !valid(workArea)) throw new Error('无法确认微信窗口位置');
  const gap = 8, right = target.x + target.width + gap, left = target.x - gap - width;
  let x;
  if (right >= workArea.x && right + width <= workArea.x + workArea.width) x = right;
  else if (left >= workArea.x && left + width <= workArea.x + workArea.width) x = left;
  else throw new Error('微信两侧空间不足。请手动缩窄或移动微信，再点击“贴靠微信”；助手不会覆盖聊天或调整微信窗口。');
  const height = Math.min(Math.max(580, Math.round(target.height)), workArea.height);
  const y = Math.max(workArea.y, Math.min(target.y, workArea.y + workArea.height - height));
  return { x: Math.round(x), y: Math.round(y), width, height: Math.round(height) };
}
module.exports = { dockBounds };
