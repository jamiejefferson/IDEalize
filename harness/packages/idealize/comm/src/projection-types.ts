/**
 * Types of the agent-name session event and projection, kept free of host
 * imports so the client face can merge them (`@idealize/comm/client`).
 */

/** What the agent-name event records. */
export interface AgentNameEventData {
  /** The chat's name, unique within its project. */
  name: string
  /** Which of the twelve pools it came from. */
  pool: number
}

/** What clients read: the current name, once assigned. */
export interface AgentNameProjection {
  name?: string | undefined
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The chat's assigned agent name; latest wins. Model-visible through the
     * session-start notice. Appended with the envelope's `ignorable` marker:
     * the comm store is the name's source of truth, so a harness without this
     * vocabulary still reads the log.
     */
    'idealize/agent-name': AgentNameEventData
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** The chat's agent name, for the sidebar card and the CLI roster. */
    agentName: AgentNameProjection
  }
}
