import { contextBridge, ipcRenderer } from 'electron';
import type { AppEvent, DesktopAPI } from '../shared/types.js';

const api: DesktopAPI = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  syncConfig: () => ipcRenderer.invoke('app:config-sync'),
  chooseProject: () => ipcRenderer.invoke('project:choose'),
  addProject: (path) => ipcRenderer.invoke('project:add', path),
  newSession: (projectId) => ipcRenderer.invoke('session:new', projectId),
  getSession: (id) => ipcRenderer.invoke('session:get', id),
  sendMessage: (input) => ipcRenderer.invoke('session:send', input),
  stopSession: (id) => ipcRenderer.invoke('session:stop', id),
  updateSession: (id, patch) => ipcRenderer.invoke('session:update', id, patch),
  answerPermission: (answer) => ipcRenderer.invoke('permission:answer', answer),
  pendingPermissions: () => ipcRenderer.invoke('permission:pending'),
  search: (query) => ipcRenderer.invoke('session:search', query),
  listHistory: (projectId) => ipcRenderer.invoke('history:list', projectId),
  importHistory: (projectId, ids) => ipcRenderer.invoke('history:import', projectId, ids),
  updateNotes: (projectId, notes, enabled) =>
    ipcRenderer.invoke('project:notes', projectId, notes, enabled),
  setTheme: (theme) => ipcRenderer.invoke('app:theme', theme),
  setPermissionMode: (mode) => ipcRenderer.invoke('app:permission-mode', mode),
  exportSession: (id) => ipcRenderer.invoke('session:export', id),
  showProject: (id) => ipcRenderer.invoke('project:show', id),
  openExternal: (url) => ipcRenderer.invoke('app:external', url),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  onEvent: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, event: AppEvent) => callback(event);
    ipcRenderer.on('app:event', handler);
    return () => ipcRenderer.removeListener('app:event', handler);
  },
};

contextBridge.exposeInMainWorld('desktop', api);
