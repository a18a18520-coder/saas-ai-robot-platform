'use strict';
// The driver owns platform actions. This scheduler never guesses chat identity,
// splits OCR into messages, or uploads records.
class GroupMonitor {
  constructor(driver, onChange = () => {}) { this.driver = driver; this.onChange = onChange; this.active = false; this.generation = 0; this.states = {}; }
  update(id, change) { this.states[id] = { ...this.states[id], ...change }; this.onChange(structuredClone(this.states)); }
  stop() { this.active = false; this.generation++; this.wake?.(); }
  assertCurrent(generation) { if (!this.active || generation !== this.generation) throw new Error('轮巡已停止'); }
  async wait(ms, generation) { this.assertCurrent(generation); await new Promise(resolve => { const timer = setTimeout(resolve, ms); this.wake = () => { clearTimeout(timer); resolve(); }; }); this.wake = null; this.assertCurrent(generation); }
  async visit(group, generation) {
    const state = this.states[group.id];
    const check = () => this.assertCurrent(generation);
    const read = async phase => {
      check(); const frame = await this.driver.frame(group); check();
      const result = await this.driver.capture(group, frame, phase); check();
      this.update(group.id, { saved: state.saved + (result.saved ? 1 : 0), unchanged: state.unchanged + (result.saved ? 0 : 1) });
      Object.assign(state, this.states[group.id]);
      return result.hash;
    };
    const scroll = async direction => { check(); const frame = await this.driver.frame(group); check(); await this.driver.scroll(group, direction, frame); check(); };
    this.update(group.id, { phase: 'switching', error: '' });
    await this.driver.activate(group); check();
    let hash = await read(state.historyDone ? 'new' : 'history');
    if (!state.historyDone) {
      this.update(group.id, { phase: 'history' });
      let moves = 0;
      for (let page = 1; page < group.historyScreens; page++) {
        await scroll('up'); moves++;
        const next = await read('history');
        if (next === hash) break;
        hash = next;
      }
      this.update(group.id, { phase: 'returning' });
      // Return the same number of bounded steps; collect intervening new frames.
      for (let page = 0; page < moves; page++) { await scroll('down'); hash = await read('history-return'); }
      state.historyDone = true;
      await this.driver.progress(group, { historyDone: true }); check();
    }
    this.update(group.id, { phase: 'new' });
    // A busy group is bounded so another group cannot starve indefinitely.
    for (let page = 0; page < 10; page++) {
      await scroll('down'); const next = await read('new');
      if (next === hash) break;
      hash = next;
    }
    this.update(group.id, { phase: 'waiting', checkedAt: new Date().toISOString(), nextDue: Date.now() + group.intervalSeconds * 1000, historyDone: true });
  }
  async start(groups) {
    if (this.active) throw new Error('轮巡已在运行');
    if (!Array.isArray(groups) || !groups.length) throw new Error('请先校准并保存至少一个群');
    this.active = true; const generation = ++this.generation;
    this.states = Object.fromEntries(groups.map(group => [group.id, { phase: 'waiting', saved: 0, unchanged: 0, historyDone: !!group.progress?.historyDone, nextDue: 0, error: '' }]));
    this.onChange(structuredClone(this.states));
    try {
      while (this.active && this.generation === generation) {
        const pending = groups.filter(group => this.states[group.id].phase !== 'paused');
        if (!pending.length) break;
        for (const group of pending) {
          this.assertCurrent(generation);
          if (Date.now() < this.states[group.id].nextDue) continue;
          try { await this.visit(group, generation); }
          catch (error) { this.assertCurrent(generation); this.update(group.id, { phase: 'paused', error: error.message || '采集失败，请重新校准' }); }
        }
        const due = groups.filter(group => this.states[group.id].phase !== 'paused').map(group => this.states[group.id].nextDue);
        if (!due.length) break;
        await this.wait(Math.max(50, Math.min(...due) - Date.now()), generation);
      }
    } catch (error) { if (this.active && generation === this.generation) throw error; }
    finally { if (generation === this.generation) this.active = false; this.onChange(structuredClone(this.states)); }
  }
}
if (typeof module !== 'undefined') module.exports = { GroupMonitor };
else window.GroupMonitor = GroupMonitor;
