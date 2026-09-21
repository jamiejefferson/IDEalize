/** The macOS menu bar. Windows and Linux windows carry no menu bar, so their route to a new window is the tray. */

import type { MenuItemConstructorOptions } from 'electron'

/** Native copy and actions the menu bar needs from its owner. */
export interface ApplicationMenuOptions {
  readonly fileLabel: string
  readonly newWindowLabel: string
  readonly websiteLabel: string
  readonly openNewWindow: () => void
  readonly openWebsite: () => void
}

/**
 * Electron's stock menu with a File menu that opens windows (JJ, 21 Sep 2026:
 * "there isnt a 'New Window' command in the 'File' menu") and a Help menu
 * that leads to the product's site; the stock one linked Electron's pages.
 * @param options - resolved labels and the two actions.
 * @returns the template for `Menu.setApplicationMenu`.
 */
export function applicationMenuTemplate(options: ApplicationMenuOptions): MenuItemConstructorOptions[] {
  return [
    { role: 'appMenu' },
    // A plain labelled menu: macOS ignores the submenu of an item that carries a role.
    {
      label: options.fileLabel,
      submenu: [
        { label: options.newWindowLabel, accelerator: 'CmdOrCtrl+N', click: options.openNewWindow },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: options.websiteLabel, click: options.openWebsite }] },
  ]
}
