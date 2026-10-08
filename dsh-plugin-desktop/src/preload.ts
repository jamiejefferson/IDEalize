/** Minimal context-isolated bridges: operating-system drag payloads, and Powell's window controls. */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { DESKTOP_FILE_PATH_BRIDGE } from './file-path-bridge-contract.ts'

contextBridge.exposeInMainWorld(DESKTOP_FILE_PATH_BRIDGE, {
  /** Resolve only genuine disk-backed Web File objects selected by the operator. */
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },
})

// Powell's window (powell-window.ts). The main process honours these only
// from Powell's own webContents, so the main window gains nothing by them.
contextBridge.exposeInMainWorld('idealizePowell', {
  hit(over: boolean): void { ipcRenderer.send('powell:hit', over === true) },
  dragStart(): void { ipcRenderer.send('powell:drag-start') },
  dragEnd(): void { ipcRenderer.send('powell:drag-end') },
  focus(focus: boolean): void { ipcRenderer.send('powell:focus', focus === true) },
  openMain(): void { ipcRenderer.send('powell:open-main') },
  hide(): void { ipcRenderer.send('powell:hide') },
  layoutApplied(): void { ipcRenderer.send('powell:layout-applied') },
  onLayout(listener: (layout: { owlX: number; flip: boolean }) => void): () => void {
    const handler = (_event: unknown, layout: unknown): void => {
      const value = layout as { owlX?: unknown; flip?: unknown } | null
      if (typeof value?.owlX === 'number' && typeof value.flip === 'boolean') listener({ owlX: value.owlX, flip: value.flip })
    }
    ipcRenderer.on('powell:layout', handler)
    return () => { ipcRenderer.off('powell:layout', handler) }
  },
  onCommand(listener: (command: 'listen' | 'type') => void): () => void {
    const handler = (_event: unknown, command: unknown): void => {
      if (command === 'listen' || command === 'type') listener(command)
    }
    ipcRenderer.on('powell:command', handler)
    return () => { ipcRenderer.off('powell:command', handler) }
  },
})
