import Foundation

/// Installs shell-integration scripts that make zsh/bash emit semantic markers
/// (OSC) at command boundaries, so IDEalize can build "blocks": discrete
/// command + output units with exit codes — Warp's signature feature.
///
/// Protocol (custom OSC 1771, terminated by BEL):
///   event=prompt;cwd=<b64>          a new prompt is being shown
///   event=exec;cmd=<b64>;cwd=<b64>  a command started running
///   event=done;exit=<n>             the command finished with exit code n
///
/// We also emit standard OSC 133 A/B/C/D for interop with other tools.
enum ShellIntegration {
    static var rootDir: String {
        NSHomeDirectory() + "/Library/Application Support/IDEalize/shell-integration"
    }
    static var zdotdir: String { rootDir + "/zdotdir" }

    /// Write the integration scripts to disk (idempotent). Returns the ZDOTDIR
    /// to hand zsh, or nil on failure.
    @discardableResult
    static func install() -> Bool {
        let fm = FileManager.default
        do {
            try fm.createDirectory(atPath: zdotdir, withIntermediateDirectories: true)
            try zshrc.write(toFile: zdotdir + "/.zshrc", atomically: true, encoding: .utf8)
            try bashrc.write(toFile: rootDir + "/idealize.bash", atomically: true, encoding: .utf8)
            return true
        } catch {
            NSLog("IDEalize: shell integration install failed: \(error)")
            return false
        }
    }

    /// Environment additions for a zsh session (redirect ZDOTDIR to ours).
    static func zshEnvironment(currentEnv: [String: String]) -> [String] {
        let userZ = currentEnv["ZDOTDIR"] ?? NSHomeDirectory()
        return [
            "ZDOTDIR=\(zdotdir)",
            "IDEALIZE_USER_ZDOTDIR=\(userZ)",
        ]
    }

    static let zshrc = """
    # IDEalize shell integration (zsh) — auto-generated.
    IDEALIZE_USER_ZDOTDIR="${IDEALIZE_USER_ZDOTDIR:-$HOME}"
    export ZDOTDIR="$IDEALIZE_USER_ZDOTDIR"

    # Load the user's real configuration first.
    for __f in .zshenv .zprofile .zshrc; do
      [ -f "$IDEALIZE_USER_ZDOTDIR/$__f" ] && source "$IDEALIZE_USER_ZDOTDIR/$__f"
    done
    unset __f

    __idealize_osc() { printf '\\033]1771;%s\\007' "$1"; }
    __idealize_b64() { printf '%s' "$1" | base64 | tr -d '\\n'; }

    zmodload zsh/datetime 2>/dev/null
    __idealize_t0=0
    __idealize_ran=0
    __idealize_dur=""
    __idealize_stat=""

    __idealize_preexec() {
      __idealize_t0=$EPOCHREALTIME
      __idealize_ran=1
      printf '\\033]133;C\\007'
      __idealize_osc "event=exec;cmd=$(__idealize_b64 "$1");cwd=$(__idealize_b64 "$PWD")"
    }
    __idealize_precmd() {
      local __ec=$?
      printf '\\033]133;D;%s\\007' "$__ec"
      __idealize_osc "event=done;exit=$__ec"
      if [ "$__idealize_ran" = "1" ]; then
        local __now=$EPOCHREALTIME
        local __d=$(( __now - __idealize_t0 ))
        __idealize_dur=$(printf '%.2fs' "$__d")
        if [ "$__ec" = "0" ]; then __idealize_stat="%F{green}✓%f"
        else __idealize_stat="%F{red}✗ ${__ec}%f"; fi
      else
        __idealize_dur=""; __idealize_stat=""
      fi
      __idealize_ran=0
      printf '\\033]133;A\\007'
      __idealize_osc "event=prompt;cwd=$(__idealize_b64 "$PWD")"
      return $__ec
    }

    autoload -Uz add-zsh-hook 2>/dev/null
    if whence add-zsh-hook >/dev/null 2>&1; then
      add-zsh-hook preexec __idealize_preexec
      add-zsh-hook precmd __idealize_precmd
    else
      preexec_functions+=(__idealize_preexec)
      precmd_functions+=(__idealize_precmd)
    fi

    # Warp-style prompt: a block header line (cwd · git branch · status · time)
    # then a clean input chevron. Opt out with IDEALIZE_PROMPT=0.
    if [ "${IDEALIZE_PROMPT:-1}" = "1" ]; then
      setopt prompt_subst 2>/dev/null
      autoload -Uz vcs_info 2>/dev/null
      __idealize_git() {
        local b
        b=$(command git symbolic-ref --short HEAD 2>/dev/null || command git rev-parse --short HEAD 2>/dev/null)
        [ -n "$b" ] && print -n " %F{246}on%f %F{magenta} ${b}%f"
      }
      PROMPT=$'\\n''%F{39}%~%f$(__idealize_git)%F{240}${__idealize_dur:+  ${__idealize_dur}}%f${__idealize_stat:+  ${__idealize_stat}}'$'\\n''%F{39}❯%f '
      RPROMPT=''
    fi

    __idealize_osc "event=prompt;cwd=$(__idealize_b64 "$PWD")"
    """

    static let bashrc = """
    # IDEalize shell integration (bash) — auto-generated.
    [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"

    __idealize_osc() { printf '\\033]1771;%s\\007' "$1"; }
    __idealize_b64() { printf '%s' "$1" | base64 | tr -d '\\n'; }

    __idealize_preexec() {
      [ -n "$COMP_LINE" ] && return
      [ "$BASH_COMMAND" = "$PROMPT_COMMAND" ] && return
      printf '\\033]133;C\\007'
      __idealize_osc "event=exec;cmd=$(__idealize_b64 "$BASH_COMMAND");cwd=$(__idealize_b64 "$PWD")"
    }
    __idealize_precmd() {
      local __ec=$?
      printf '\\033]133;D;%s\\007' "$__ec"
      __idealize_osc "event=done;exit=$__ec"
      printf '\\033]133;A\\007'
      __idealize_osc "event=prompt;cwd=$(__idealize_b64 "$PWD")"
    }
    trap '__idealize_preexec' DEBUG
    PROMPT_COMMAND="__idealize_precmd;${PROMPT_COMMAND}"
    __idealize_osc "event=prompt;cwd=$(__idealize_b64 "$PWD")"
    """
}
