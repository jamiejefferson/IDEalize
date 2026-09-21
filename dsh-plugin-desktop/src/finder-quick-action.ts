/**
 * The macOS Finder Quick Action "Idealize this": right-click a folder, and the
 * app registers it as a project and opens a chat in it (JJ, 13 Sep 2026).
 *
 * Finder's right-click menu takes entries from Services, and an app cannot
 * contribute one from its own bundle unless it handles Cocoa service messages,
 * which Electron does not. The entry is therefore an Automator workflow
 * installed into the user's `~/Library/Services`, running one shell line that
 * sends the folder to the app over the `idealize://` scheme. Installing it is
 * the app's job rather than an installer's, because the app is copied into
 * /Applications by hand and there is no installer to do it.
 * Windows does have an installer, so Explorer's entry of the same name is
 * written by `build/installer.nsh` (PC test drive, 18 Sep 2026).
 *
 * The bundle is rewritten whenever the shipped text differs from what is on
 * disk, so a change here reaches an existing install on its next launch.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IDEALIZE_SCHEME } from './idealize-url.ts'

/** The workflow bundle's directory name, which is also the menu entry's name. */
export const QUICK_ACTION_NAME = 'Idealize this'

/**
 * The shell line the workflow runs. `inputMethod` 1 passes the selected paths
 * as arguments, so `$1` is the folder. The path is percent-encoded through
 * JavaScriptCore rather than the shell, because a folder name may hold any
 * byte but `/` and NUL, `#` and `?` among them.
 */
const COMMAND = `u=$(V="$1" osascript -l JavaScript -e 'ObjC.import("stdlib"); function run(){return encodeURIComponent($.getenv("V"))}'); open "${IDEALIZE_SCHEME}://project?path=$u"`

/** The service registration: one Finder entry, labelled and pointing at the workflow runner. */
function infoPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>NSServices</key>
\t<array>
\t\t<dict>
\t\t\t<key>NSBackgroundColorName</key>
\t\t\t<string>background</string>
\t\t\t<key>NSIconName</key>
\t\t\t<string>NSActionTemplate</string>
\t\t\t<key>NSMenuItem</key>
\t\t\t<dict>
\t\t\t\t<key>default</key>
\t\t\t\t<string>${QUICK_ACTION_NAME}</string>
\t\t\t</dict>
\t\t\t<key>NSMessage</key>
\t\t\t<string>runWorkflowAsService</string>
\t\t</dict>
\t</array>
</dict>
</plist>
`
}

/**
 * The workflow document: one Run Shell Script action, taking folders from
 * Finder and returning nothing. The keys are Automator's own and are copied
 * from a workflow Automator wrote, not invented here.
 */
function documentWflow(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>AMApplicationBuild</key>
\t<string>534</string>
\t<key>AMApplicationVersion</key>
\t<string>2.10</string>
\t<key>AMDocumentVersion</key>
\t<string>2</string>
\t<key>actions</key>
\t<array>
\t\t<dict>
\t\t\t<key>action</key>
\t\t\t<dict>
\t\t\t\t<key>AMAccepts</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>Container</key>
\t\t\t\t\t<string>List</string>
\t\t\t\t\t<key>Optional</key>
\t\t\t\t\t<true/>
\t\t\t\t\t<key>Types</key>
\t\t\t\t\t<array>
\t\t\t\t\t\t<string>com.apple.cocoa.string</string>
\t\t\t\t\t</array>
\t\t\t\t</dict>
\t\t\t\t<key>AMActionVersion</key>
\t\t\t\t<string>2.0.3</string>
\t\t\t\t<key>AMApplication</key>
\t\t\t\t<array>
\t\t\t\t\t<string>Automator</string>
\t\t\t\t</array>
\t\t\t\t<key>AMParameterProperties</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>COMMAND_STRING</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>CheckedForUserDefaultShell</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>inputMethod</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>shell</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>source</key>
\t\t\t\t\t<dict/>
\t\t\t\t</dict>
\t\t\t\t<key>AMProvides</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>Container</key>
\t\t\t\t\t<string>List</string>
\t\t\t\t\t<key>Types</key>
\t\t\t\t\t<array>
\t\t\t\t\t\t<string>com.apple.cocoa.string</string>
\t\t\t\t\t</array>
\t\t\t\t</dict>
\t\t\t\t<key>ActionBundlePath</key>
\t\t\t\t<string>/System/Library/Automator/Run Shell Script.action</string>
\t\t\t\t<key>ActionName</key>
\t\t\t\t<string>Run Shell Script</string>
\t\t\t\t<key>ActionParameters</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>COMMAND_STRING</key>
\t\t\t\t\t<string>${COMMAND.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</string>
\t\t\t\t\t<key>CheckedForUserDefaultShell</key>
\t\t\t\t\t<true/>
\t\t\t\t\t<key>inputMethod</key>
\t\t\t\t\t<integer>1</integer>
\t\t\t\t\t<key>shell</key>
\t\t\t\t\t<string>/bin/zsh</string>
\t\t\t\t\t<key>source</key>
\t\t\t\t\t<string></string>
\t\t\t\t</dict>
\t\t\t\t<key>BundleIdentifier</key>
\t\t\t\t<string>com.apple.RunShellScript</string>
\t\t\t\t<key>CFBundleVersion</key>
\t\t\t\t<string>2.0.3</string>
\t\t\t\t<key>CanShowSelectedItemsWhenRun</key>
\t\t\t\t<false/>
\t\t\t\t<key>CanShowWhenRun</key>
\t\t\t\t<true/>
\t\t\t\t<key>Category</key>
\t\t\t\t<array>
\t\t\t\t\t<string>AMCategoryUtilities</string>
\t\t\t\t</array>
\t\t\t\t<key>Class Name</key>
\t\t\t\t<string>RunShellScriptAction</string>
\t\t\t\t<key>InputUUID</key>
\t\t\t\t<string>2B1B2F1E-4B4B-4E8E-9C6B-1D8E0B2A5C11</string>
\t\t\t\t<key>Keywords</key>
\t\t\t\t<array>
\t\t\t\t\t<string>Shell</string>
\t\t\t\t\t<string>Script</string>
\t\t\t\t\t<string>Command</string>
\t\t\t\t\t<string>Run</string>
\t\t\t\t\t<string>Unix</string>
\t\t\t\t</array>
\t\t\t\t<key>OutputUUID</key>
\t\t\t\t<string>6C0A9D32-9F4E-4D5A-8C3B-7A2E5F1D4B90</string>
\t\t\t\t<key>UUID</key>
\t\t\t\t<string>9E7D6C55-2A31-4F0C-B6D9-3C8F1E4A7B22</string>
\t\t\t\t<key>UnlocalizedApplications</key>
\t\t\t\t<array>
\t\t\t\t\t<string>Automator</string>
\t\t\t\t</array>
\t\t\t\t<key>arguments</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>0</key>
\t\t\t\t\t<dict>
\t\t\t\t\t\t<key>default value</key>
\t\t\t\t\t\t<integer>0</integer>
\t\t\t\t\t\t<key>name</key>
\t\t\t\t\t\t<string>inputMethod</string>
\t\t\t\t\t\t<key>required</key>
\t\t\t\t\t\t<string>0</string>
\t\t\t\t\t\t<key>type</key>
\t\t\t\t\t\t<string>0</string>
\t\t\t\t\t\t<key>uuid</key>
\t\t\t\t\t\t<string>0</string>
\t\t\t\t\t</dict>
\t\t\t\t\t<key>1</key>
\t\t\t\t\t<dict>
\t\t\t\t\t\t<key>default value</key>
\t\t\t\t\t\t<false/>
\t\t\t\t\t\t<key>name</key>
\t\t\t\t\t\t<string>CheckedForUserDefaultShell</string>
\t\t\t\t\t\t<key>required</key>
\t\t\t\t\t\t<string>0</string>
\t\t\t\t\t\t<key>type</key>
\t\t\t\t\t\t<string>0</string>
\t\t\t\t\t\t<key>uuid</key>
\t\t\t\t\t\t<string>1</string>
\t\t\t\t\t</dict>
\t\t\t\t\t<key>2</key>
\t\t\t\t\t<dict>
\t\t\t\t\t\t<key>default value</key>
\t\t\t\t\t\t<string></string>
\t\t\t\t\t\t<key>name</key>
\t\t\t\t\t\t<string>source</string>
\t\t\t\t\t\t<key>required</key>
\t\t\t\t\t\t<string>0</string>
\t\t\t\t\t\t<key>type</key>
\t\t\t\t\t\t<string>0</string>
\t\t\t\t\t\t<key>uuid</key>
\t\t\t\t\t\t<string>2</string>
\t\t\t\t\t</dict>
\t\t\t\t\t<key>3</key>
\t\t\t\t\t<dict>
\t\t\t\t\t\t<key>default value</key>
\t\t\t\t\t\t<string></string>
\t\t\t\t\t\t<key>name</key>
\t\t\t\t\t\t<string>COMMAND_STRING</string>
\t\t\t\t\t\t<key>required</key>
\t\t\t\t\t\t<string>0</string>
\t\t\t\t\t\t<key>type</key>
\t\t\t\t\t\t<string>0</string>
\t\t\t\t\t\t<key>uuid</key>
\t\t\t\t\t\t<string>3</string>
\t\t\t\t\t</dict>
\t\t\t\t\t<key>4</key>
\t\t\t\t\t<dict>
\t\t\t\t\t\t<key>default value</key>
\t\t\t\t\t\t<string>/bin/sh</string>
\t\t\t\t\t\t<key>name</key>
\t\t\t\t\t\t<string>shell</string>
\t\t\t\t\t\t<key>required</key>
\t\t\t\t\t\t<string>0</string>
\t\t\t\t\t\t<key>type</key>
\t\t\t\t\t\t<string>0</string>
\t\t\t\t\t\t<key>uuid</key>
\t\t\t\t\t\t<string>4</string>
\t\t\t\t\t</dict>
\t\t\t\t</dict>
\t\t\t\t<key>conversionLabel</key>
\t\t\t\t<integer>0</integer>
\t\t\t\t<key>isViewVisible</key>
\t\t\t\t<integer>1</integer>
\t\t\t\t<key>location</key>
\t\t\t\t<string>309.000000:305.000000</string>
\t\t\t\t<key>nibPath</key>
\t\t\t\t<string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
\t\t\t</dict>
\t\t\t<key>isViewVisible</key>
\t\t\t<integer>1</integer>
\t\t</dict>
\t</array>
\t<key>connectors</key>
\t<dict/>
\t<key>workflowMetaData</key>
\t<dict>
\t\t<key>applicationBundleID</key>
\t\t<string>com.apple.finder</string>
\t\t<key>applicationBundleIDsByPath</key>
\t\t<dict>
\t\t\t<key>/System/Library/CoreServices/Finder.app</key>
\t\t\t<string>com.apple.finder</string>
\t\t</dict>
\t\t<key>applicationPath</key>
\t\t<string>/System/Library/CoreServices/Finder.app</string>
\t\t<key>applicationPaths</key>
\t\t<array>
\t\t\t<string>/System/Library/CoreServices/Finder.app</string>
\t\t</array>
\t\t<key>inputTypeIdentifier</key>
\t\t<string>com.apple.Automator.fileSystemObject.folder</string>
\t\t<key>outputTypeIdentifier</key>
\t\t<string>com.apple.Automator.nothing</string>
\t\t<key>presentationMode</key>
\t\t<integer>15</integer>
\t\t<key>processesInput</key>
\t\t<false/>
\t\t<key>serviceApplicationBundleID</key>
\t\t<string>com.apple.finder</string>
\t\t<key>serviceApplicationPath</key>
\t\t<string>/System/Library/CoreServices/Finder.app</string>
\t\t<key>serviceInputTypeIdentifier</key>
\t\t<string>com.apple.Automator.fileSystemObject.folder</string>
\t\t<key>serviceOutputTypeIdentifier</key>
\t\t<string>com.apple.Automator.nothing</string>
\t\t<key>serviceProcessesInput</key>
\t\t<false/>
\t\t<key>systemImageName</key>
\t\t<string>NSActionTemplate</string>
\t\t<key>useAutomaticInputType</key>
\t\t<false/>
\t\t<key>workflowTypeIdentifier</key>
\t\t<string>com.apple.Automator.servicesMenu</string>
\t</dict>
</dict>
</plist>
`
}

/** What {@link installFinderQuickAction} did, for the caller's log line. */
export type QuickActionOutcome = 'written' | 'unchanged'

/**
 * Install or refresh the Quick Action in a Services directory.
 * @param servicesDir - the directory to install into, normally `~/Library/Services`.
 * @returns `written` when a file changed on disk, `unchanged` when both already matched.
 */
export async function installFinderQuickAction(servicesDir: string): Promise<QuickActionOutcome> {
  const contents = join(servicesDir, `${QUICK_ACTION_NAME}.workflow`, 'Contents')
  const files: [string, string][] = [
    [join(contents, 'Info.plist'), infoPlist()],
    [join(contents, 'document.wflow'), documentWflow()],
  ]
  const stale: [string, string][] = []
  for (const [path, wanted] of files) {
    let held: string | undefined
    try {
      held = await readFile(path, 'utf8')
    } catch {
      // Absent or unreadable: write it below either way.
    }
    if (held !== wanted) stale.push([path, wanted])
  }
  if (stale.length === 0) return 'unchanged'
  await mkdir(contents, { recursive: true })
  for (const [path, wanted] of stale) await writeFile(path, wanted)
  return 'written'
}
