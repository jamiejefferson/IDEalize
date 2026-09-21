# Additions to electron-builder's NSIS installer. electron-builder includes
# `installer.nsh` from the build resources directory by that name, and
# package.json names it under `nsis.include` so the wiring is on the page.
#
# Every write goes to SHELL_CONTEXT, the hive the template's own registry
# writes use: HKCU for the per-user install the installer defaults to, HKLM
# when the user picks "anyone who uses this computer" on the install-mode page.

# Explorer's "Idealize this" verb, the counterpart of the macOS Finder Quick
# Action in src/finder-quick-action.ts (PC test drive, 18 Sep 2026: "No
# Explorer 'Idealize this'"). `Directory\shell` is a right-click on a folder,
# `Directory\Background\shell` a right-click inside one, and `%V` is the folder
# in both. The folder travels as a switch because the registry cannot
# percent-encode it into an `idealize://` URL; src/idealize-url.ts reads the
# switch from the argument list of a first launch and of a second instance.
!define IDEALIZE_THIS_VERB "IdealizeThis"
!define IDEALIZE_THIS_LABEL "Idealize this"

!macro idealizeThisWrite PARENT
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PARENT}\shell\${IDEALIZE_THIS_VERB}" "" "${IDEALIZE_THIS_LABEL}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PARENT}\shell\${IDEALIZE_THIS_VERB}" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PARENT}\shell\${IDEALIZE_THIS_VERB}\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--idealize-project=%V"'
!macroend

!macro customInstall
  # The template writes InstallLocation under its own `Software\<guid>` key
  # only, and inventory tools read it from the uninstall entry, where it was
  # blank (PC test drive, 18 Sep 2026). UNINSTALL_REGISTRY_KEY is the
  # template's define for that entry, so the key name is never spelled here.
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"

  !insertmacro idealizeThisWrite "Directory"
  !insertmacro idealizeThisWrite "Directory\Background"
!macroend

!macro customUnInstall
  # The uninstall entry goes with the template's own DeleteRegKey. The verb
  # keys are ours, so they are removed here. An update runs this too, and the
  # install that follows writes them back.
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Directory\shell\${IDEALIZE_THIS_VERB}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Directory\Background\shell\${IDEALIZE_THIS_VERB}"
!macroend
