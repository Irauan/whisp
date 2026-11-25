import type { AgentInfo, AgentRun } from './agent'
import type { Workspace } from './model'

export interface AgentMessage {
  itemId: string
  agentId: string
  /** The project folder, where the agent works. */
  cwd: string
  text: string
}

export interface AetherBridge {
  platform: string
  loadWorkspace(): Promise<Workspace>
  saveWorkspace(workspace: Workspace): Promise<void>
  /** Asks the user for a folder. Resolves with null when they cancel. */
  chooseFolder(): Promise<string | null>
  listAgents(): Promise<AgentInfo[]>
  getAgentRun(itemId: string): Promise<AgentRun>
  /** Resolves when the agent finishes the turn. */
  sendToAgent(message: AgentMessage): Promise<void>
  cancelAgent(itemId: string): Promise<void>
  answerAgent(itemId: string, choiceId: string | null): Promise<void>
  forgetAgentRun(itemId: string): Promise<void>
  /** Calls back with each change of any run. Returns a function that stops it. */
  onAgentRun(callback: (run: AgentRun) => void): () => void
}
