/**
 * The words on Powell's status tag while it works. The tag names the
 * surface, never the tool call (spec §16): "Working in Paper", not
 * `mcp__paper__write_html`.
 * @module @idealize/powell/status
 */

/** Apps reached through MCP, by server name, and how the tag names them. */
const APP_NAMES: Readonly<Record<string, string>> = {
  paper: 'Paper',
  hatch: 'Hatch',
  figma: 'Figma',
  miro: 'Miro',
  airtable: 'Airtable',
  supabase: 'Supabase',
  vercel: 'Vercel',
  higgsfield: 'Higgsfield',
}

/**
 * The display name for an MCP server, from a tool name like
 * `mcp__paper__get_basic_info` or `mcp__claude_ai_Figma__use_figma`.
 * @param tool - the tool name.
 * @returns the app's name, or undefined when the tool is not an MCP tool.
 */
export function appOfTool(tool: string): string | undefined {
  const match = /^mcp__(.+?)__/.exec(tool)
  if (match === null) return undefined
  const server = (match[1] ?? '').toLowerCase()
  for (const [key, label] of Object.entries(APP_NAMES)) {
    if (server.includes(key)) return label
  }
  const last = server.split(/[_-]/).filter(part => part !== '').pop() ?? server
  return last.charAt(0).toUpperCase() + last.slice(1)
}

/**
 * The status tag for one tool call.
 * @param tool - the tool's name.
 * @param args - the call's JSON arguments, as streamed.
 * @param project - the active project's name, for search wording.
 * @returns the tag text.
 */
export function statusOfTool(tool: string, args: string, project: string | undefined): string {
  const app = appOfTool(tool)
  if (app !== undefined) return `Working in ${app}`
  const where = project === undefined ? '' : ` ${project}`
  switch (tool) {
    case 'docs_search':
      return 'Searching the docs'
    case 'grep':
    case 'glob':
      return `Searching${where}`.trim()
    case 'read':
    case 'read_image':
      return 'Reading'
    case 'write':
    case 'edit':
      return 'Writing it up'
    case 'web_search':
    case 'web_fetch':
      return 'Searching the web'
    case 'powell_project':
      return 'Finding the project'
    case 'subagent':
    case 'subagent_fork':
      return 'Handing it to an agent'
    case 'bash': {
      if (/\bidealize\s+(spawn|send)\b/.test(args)) return 'Handing it to an agent'
      if (/\b(rg|grep|find|fd|ls)\b/.test(args)) return `Searching${where}`.trim()
      if (/\bopen\b/.test(args)) return 'Opening it'
      return 'Working'
    }
    default:
      return 'Working'
  }
}
