'use strict';
class CurrentMonitor {
  constructor(driver, changed = () => {}) {
    this.driver = driver; this.changed = changed; this.active = false; this.epoch = 0;
    this.timer = null; this.watch = null; this.wake = null; this.stopping = null;
  }
  stop(reason = '已暂停；继续前请重新确认会话') {
    this.active = false; this.epoch++; clearInterval(this.watch); clearTimeout(this.timer); this.wake?.();
    this.changed({ phase: 'paused', reason });
    if (!this.stopping) this.stopping = Promise.resolve(this.driver.stop()).catch(() => {});
    return this.stopping;
  }
  async start(group, { intervalSeconds, count, scroll = 'none', historyScreens = 10, scrollConfirmed = false }) {
    if (this.active) throw new Error('采集已在运行');
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < 2 || intervalSeconds > 3600 || !Number.isInteger(count) || count < 0 || count > 50) throw new Error('间隔须为 2–3600 秒；次数须为 0–50 的整数，0 为持续');
    if (!['none','up','down'].includes(scroll) || (scroll !== 'none' && scrollConfirmed !== true) || !Number.isInteger(historyScreens) || historyScreens < 1 || historyScreens > 30) throw new Error('请确认滚动方式；历史上限须为 1–30 屏');
    this.active = true; this.stopping = null;
    const epoch = ++this.epoch, valid = () => this.active && this.epoch === epoch;
    let attempts = 0, saved = 0, probing = false, lastClock, lastHash, lastChange = Date.now();
    const limit = scroll === 'up' ? Math.min(count || historyScreens, historyScreens) : count;
    try {
      this.changed({ phase: 'checking', attempts, saved });
      const baseline = await this.driver.frame(group);
      if (!valid()) return;
      const session = await this.driver.start(group, baseline, { scroll, scrollConfirmed, historyScreens });
      if (!valid()) return;
      lastClock = baseline.clock;
      const probe = async () => {
        if (!valid() || probing) return;
        probing = true;
        try {
          const frame = await this.driver.probe(group);
          if (!valid()) return;
          if (frame.titleImage !== baseline.titleImage || frame.width !== baseline.width || frame.height !== baseline.height) throw new Error('会话标题或窗口布局发生变化，已暂停；请核对并重新校准');
          if (frame.clock !== lastClock) { lastClock = frame.clock; lastChange = Date.now(); }
          else if (Date.now() - lastChange > 5000) throw new Error('微信画面不再更新，已暂停；请检查锁屏、窗口与录屏权限');
        } catch (error) { if (valid()) await this.stop(error.message); }
        finally { probing = false; }
      };
      this.watch = setInterval(probe, 500);
      while (valid()) {
        this.changed({ phase: 'capturing', attempts, saved });
        const frame = await this.driver.frame(group);
        if (!valid()) break;
        const result = await this.driver.capture(group, session, frame);
        if (!valid()) break;
        attempts++; if (result.saved) saved++;
        this.changed({ phase: 'waiting', attempts, saved });
        if (scroll === 'up' && attempts > 1 && result.hash && result.hash === lastHash) { await this.stop(`本轮完成：历史画面未再变化，已检查 ${attempts} 屏；未上传。`); break; }
        lastHash = result.hash;
        if (limit && attempts >= limit) { await this.stop(`本轮完成：检查 ${attempts} 次，新增 ${saved} 张截图；未上传。`); break; }
        await new Promise(resolve => { this.wake = resolve; this.timer = setTimeout(resolve, intervalSeconds * 1000); });
        this.wake = null;
        if (scroll !== 'none' && valid()) {
          this.changed({ phase: 'scrolling', attempts, saved });
          const before = await this.driver.frame(group);
          if (!valid()) break;
          await this.driver.scroll(group, session, before, scroll);
          if (!valid()) break;
        }
      }
    } catch (error) { if (valid()) await this.stop(error.message); }
    finally { if (valid()) await this.stop(); else await this.stopping; }
  }
}
if (typeof module !== 'undefined') module.exports = { CurrentMonitor };
