'use strict';
const path = require('node:path');
const { execFile } = require('node:child_process');
const { rectangle } = require('./validation.cjs');
const nativeErrors = {
  invalid_request: '窗口操作参数无效', invalid_window: '目标窗口不可见、已关闭或尺寸不支持，请重新选择微信窗口',
  not_wechat: '目标不是微信窗口，不能操作其他应用', control_blocked: '窗口控制被系统权限阻止，已暂停；请勿使用提权或关闭系统保护的方式绕过',
  geometry_changed: '微信窗口尺寸已改变，请重新校准', window_changed: '微信窗口位置、尺寸或归属已改变，已暂停',
  entry_not_left: '只允许点击微信左侧会话入口', not_foreground: '微信不在前台，已暂停', window_covered: '微信被其他窗口遮挡，已暂停',
  user_input_active: '检测到鼠标或按键操作，已暂停；请释放按键后重试', input_blocked: '系统未接受窗口操作，已暂停；请检查权限或联系设备管理员',
  dpi_unavailable: '无法启用 Windows 屏幕缩放校验，已暂停', native_failure: '本机窗口组件运行失败，未继续操作'
};
class WindowControl {
  constructor(directory, { platform = process.platform, execute = execFile } = {}) { this.directory = directory; this.platform = platform; this.execute = execute; this.child = null; this.epoch = 0; }
  stop() { this.epoch++; this.child?.kill(); }
  get componentPath() { return path.join(this.directory, this.platform === 'darwin' ? `wechat-control-${process.arch}` : 'wechat-control.exe'); }
  assertTrusted(info) {
    if (info?.trusted !== true) throw new Error(this.platform === 'win32' ? nativeErrors.control_blocked : `窗口控制组件未获系统授权，轮巡未启动。请在 macOS“隐私与安全 → 辅助功能”（部分版本为“设备控制和数据访问”）中添加并开启此组件，然后重新检查：${this.componentPath}`);
  }
  async run(sourceId, action, geometry, region) {
    const id = /^window:([1-9]\d{0,19}):\d+$/.exec(sourceId)?.[1];
    if (!id || !['inspect','focus','activate','up','down'].includes(action)) throw new Error('窗口操作无效');
    if (BigInt(id) > (this.platform === 'darwin' ? 0xffffffffn : 0xffffffffffffffffn)) throw new Error('窗口编号无效');
    if (this.child) throw new Error('窗口操作尚未结束');
    const request = { windowId: id, action };
    if (action !== 'inspect') {
      if (!geometry || !region) throw new Error('请先校准窗口');
      rectangle(region, geometry.width, geometry.height);
      if (action === 'activate' && region.x + region.width > geometry.width * 0.5) throw new Error('群入口必须在窗口左侧');
      Object.assign(request, { x: (region.x + region.width / 2) / geometry.width, y: (region.y + region.height / 2) / geometry.height, ratio: geometry.width / geometry.height, scrollFraction: Math.min(0.8, region.height / geometry.height * 0.65) });
    }
    if (!['darwin','win32'].includes(this.platform)) throw new Error('当前系统不支持窗口控制');
    return this.request(request, result => result.windowId === id && typeof result.trusted === 'boolean' && ['x','y','width','height'].every(key => Number.isFinite(result[key])) && result.width >= 300 && result.height >= 300 && result.width <= 32768 && result.height <= 32768 && Math.abs(result.x) <= 1000000 && Math.abs(result.y) <= 1000000);
  }
  async permissions() {
    if (this.platform !== 'darwin') throw new Error('此检查仅用于 macOS 控制授权');
    return this.request({ action: 'permissions' }, result => result.kind === 'permissions' && typeof result.trusted === 'boolean');
  }
  async request(request, validate) {
    if (this.child) throw new Error('窗口操作尚未结束');
    const epoch = this.epoch;
    return new Promise((resolve, reject) => {
      const child = this.execute(this.componentPath, [], { timeout: 8000, maxBuffer: 16384, windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
        if (this.child === child) this.child = null;
        if (epoch !== this.epoch) return reject(new Error('窗口控制不可用：操作已取消'));
        let result; try { result = JSON.parse(String(stdout).replace(/^\uFEFF/u, '').trim()); } catch {}
        if (result?.ok !== true || error) {
          const missing = error?.code === 'ENOENT' ? '缺少本机窗口组件，请重新安装完整安装包' : null;
          const message = typeof result?.error === 'string' && result.error.length <= 256 ? (nativeErrors[result.error] || (this.platform === 'darwin' ? result.error : null)) : null;
          return reject(new Error(missing || message || '窗口控制不可用，请检查系统权限及本机组件'));
        }
        if (result.protocolVersion !== 1 || !validate(result)) return reject(new Error('窗口组件返回的数据不完整或版本不兼容，已暂停'));
        resolve(result);
      });
      this.child = child;
      child.stdin?.on('error', () => {});
      child.stdin?.end(JSON.stringify(request));
    });
  }
}
module.exports = { WindowControl };
