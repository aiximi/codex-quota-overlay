import { contextBridge, ipcRenderer } from 'electron';
import type { OverlayBridge, OverlayState } from '../shared/contracts';

const bridge: OverlayBridge = {
  getState: () => ipcRenderer.invoke('quota:state'),
  onState(listener) {
    const receive = (_event: Electron.IpcRendererEvent, state: OverlayState) => listener(state);
    ipcRenderer.on('quota:updated', receive);
    return () => ipcRenderer.removeListener('quota:updated', receive);
  },
  refresh: () => ipcRenderer.invoke('quota:refresh'),
  toggleExpanded: () => ipcRenderer.invoke('quota:toggle'),
  requestReset: (id) => ipcRenderer.invoke('quota:reset', id),
  openSettings: () => ipcRenderer.invoke('quota:settings'),
  saveSettings: (patch) => ipcRenderer.invoke('quota:save-settings', patch),
  setManualSubscription: (value) => ipcRenderer.invoke('quota:subscription', value),
  resetPosition: () => ipcRenderer.invoke('quota:position'),
  openProject: () => ipcRenderer.invoke('quota:project'),
  quit: () => ipcRenderer.invoke('quota:quit'),
};
contextBridge.exposeInMainWorld('quota', Object.freeze(bridge));
