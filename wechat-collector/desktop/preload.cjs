'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = name => (...args) => ipcRenderer.invoke(name, ...args);
contextBridge.exposeInMainWorld('collector', Object.freeze({
  tenantLogin: call('tenant-login'), tenantLogout: call('tenant-logout'), tenantState: call('tenant-state'), tenantGroups: call('tenant-groups'),
  tenantBind: call('tenant-bind'), tenantFlush: call('tenant-flush'), tenantReview: call('tenant-review'), tenantDiscard: call('tenant-discard'), tenantMore: call('tenant-more'),
  info: call('info'), controlStatus: call('control-status'), sources: call('sources'), select: call('select'), stop: call('stop'),
  wechatSources: call('wechat-sources'), openScreenSettings: call('open-screen-settings'), setupLayout: call('setup-layout'), rebindGroup: call('rebind-group'), exportRaw: call('export-raw'),
  permissionStatus: call('permission-status'), openControlSettings: call('open-control-settings'), revealControl: call('reveal-control'),
  capture: call('capture'), state: call('state'), getCapture: call('get-capture'), review: call('review'), export: call('export'),
  clear: call('clear'), send: call('send'), importImage: call('import-image'),
  dock: call('dock'), currentStart: call('current-start'), currentCapture: call('current-capture'), currentStop: call('current-stop'), currentScroll: call('current-scroll'),
  onDockState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('dock-state', listener); return () => ipcRenderer.removeListener('dock-state', listener); },
  saveGroup: call('save-group'), monitorStart: call('monitor-start'), monitorStop: call('monitor-stop'),
  monitorAction: call('monitor-action'), monitorCapture: call('monitor-capture'), monitorProgress: call('monitor-progress'),
  onMonitorStopped: callback => { const listener = () => callback(); ipcRenderer.on('monitor-stopped', listener); return () => ipcRenderer.removeListener('monitor-stopped', listener); }
}));
