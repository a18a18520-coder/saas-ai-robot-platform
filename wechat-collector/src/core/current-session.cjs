'use strict';
const { randomUUID } = require('node:crypto');

// A capture session is bound to one immutable conversation, never to just a window.
class CurrentSession {
  constructor(driver) { this.driver = driver; this.active = null; this.epoch = 0; }
  stop() { this.epoch++; this.active = null; }
  async start({ id, confirmed, frame, scroll = 'none', scrollConfirmed = false, historyScreens = 10 } = {}) {
    if (confirmed !== true) throw new Error('请确认当前会话及采集范围');
    if (!['none', 'up', 'down'].includes(scroll)) throw new Error('滚动方式无效');
    if (scroll !== 'none' && scrollConfirmed !== true) throw new Error('请确认允许滚动此会话');
    if (!Number.isInteger(historyScreens) || historyScreens < 1 || historyScreens > 30) throw new Error('历史上限须为 1–30 屏');
    if (this.active) throw new Error('请先暂停当前会话采集');
    const group = this.driver.group(id);
    if (!group?.titleImageHash || group.sourceId !== this.driver.source()) throw new Error('请连接微信，并校准当前会话的完整标题与消息区域');
    const epoch = ++this.epoch;
    const info = await this.driver.inspect(group);
    if (scroll !== 'none') this.driver.trust(info);
    await this.driver.verify(group, frame);
    if (epoch !== this.epoch || group.sourceId !== this.driver.source()) throw new Error('启动已取消，请重新确认会话');
    if (scroll !== 'none') await this.driver.focus(group);
    if (epoch !== this.epoch || group.sourceId !== this.driver.source()) throw new Error('启动已取消，请重新确认会话');
    const token = randomUUID();
    this.active = { token, group, epoch, scroll, remaining: scroll === 'up' ? historyScreens - 1 : Infinity };
    return { token, id: group.id };
  }
  async capture({ token, id, frame } = {}) {
    const session = this.active;
    const valid = () => this.active === session && session?.epoch === this.epoch && session.group.sourceId === this.driver.source();
    if (!session || token !== session.token || id !== session.group.id || !valid()) throw new Error('会话授权已失效，请重新确认后开始');
    try {
      await this.driver.inspect(session.group);
      await this.driver.verify(session.group, frame);
      if (!valid()) throw new Error('采集已暂停，本张结果未保存');
      const capture = await this.driver.recognize(session.group, frame);
      if (!valid()) throw new Error('采集已暂停，本张结果未保存');
      return await this.driver.save(capture, session.group.id, valid);
    } catch (error) {
      if (this.active === session) this.stop();
      throw error;
    }
  }
  async scroll({ token, id, frame, direction } = {}) {
    const session = this.active;
    const valid = () => this.active === session && session?.epoch === this.epoch && session.group.sourceId === this.driver.source();
    if (!session || token !== session.token || id !== session.group.id || !valid()) throw new Error('会话授权已失效，请重新确认后开始');
    if (session.scroll === 'none' || direction !== session.scroll) throw new Error('本轮未授权此滚动方向');
    if (session.remaining <= 0) throw new Error('本轮历史上限已到，未继续滚动');
    try {
      const info = await this.driver.inspect(session.group);
      this.driver.trust(info);
      await this.driver.verify(session.group, frame);
      if (!valid()) throw new Error('已暂停，未执行滚动');
      session.remaining--;
      const result = await this.driver.scroll(session.group, direction);
      if (!valid()) throw new Error('滚动已取消，请重新确认会话');
      return result;
    } catch (error) { if (this.active === session) this.stop(); throw error; }
  }
}
module.exports = { CurrentSession };
