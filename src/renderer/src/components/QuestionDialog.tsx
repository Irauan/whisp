import type { Answer } from '../../../features/repositories/answer-question/answer-question.contract'
import type { Question } from '../../../features/repositories/list-questions/list-questions.contract'
import { Modal } from './Dialogs'

type Found = Pick<Question, 'hooks' | 'mcpServers' | 'files' | 'unreadable'>

/** What the agent runs in the folder when a session starts, as the main process found it. */
function Findings({ found, emptyText }: { found: Found; emptyText: string | null }) {
  const { hooks, mcpServers, files, unreadable } = found
  const none = hooks.length === 0 && mcpServers.length === 0 && files.length === 0 && unreadable.length === 0
  return (
    <>
      {hooks.length > 0 && (
        <>
          <h3>Hooks</h3>
          <ul aria-label="Hooks">
            {hooks.map((hook) => (
              <li key={`${hook.event}\u0000${hook.command}`}>
                <code>{hook.event}</code> <code>{hook.command}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      {mcpServers.length > 0 && (
        <>
          <h3>MCP servers</h3>
          <ul aria-label="MCP servers">
            {mcpServers.map((server) => (
              <li key={server.name}>
                <code>{server.name}</code>
                {server.command !== null && (
                  <>
                    {' '}
                    <code>{server.command}</code>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {files.length > 0 && (
        <>
          <h3>Files that Claude Code reads</h3>
          <ul aria-label="Files">
            {files.map((file) => (
              <li key={file.name}>
                <code>{file.name}</code>
                {file.keys.length > 0 && (
                  <>
                    {' '}
                    <span className="muted">Other keys:</span> <code>{file.keys.join(', ')}</code>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {unreadable.map((file) => (
        <p key={file} className="muted">
          Aether could not read <code>{file}</code>. Claude Code can still read it.
        </p>
      ))}
      {none && emptyText !== null && <p className="muted">{emptyText}</p>}
    </>
  )
}

function Buttons({ answers, onAnswer }: { answers: { answer: Answer; label: string; primary?: boolean }[]; onAnswer(answer: Answer): void }) {
  return (
    <div className="dialog-actions">
      <button type="button" className="button" autoFocus onClick={() => onAnswer('cancel')}>
        Cancel
      </button>
      {answers.map(({ answer, label, primary }) => (
        <button key={answer} type="button" className={primary ? 'button primary' : 'button'} onClick={() => onAnswer(answer)}>
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * One question of the main process (architecture, Directories and trust). The window shows the oldest
 * open question. Escape and a click outside the dialog answer Cancel, which is the safe answer. The
 * dialog sends one answer. It cannot name a path or a profile: the main process knows what each answer means.
 */
export function QuestionDialog({ question, onAnswer }: { question: Question; onAnswer(answer: Answer): void }) {
  const cancel = () => onAnswer('cancel')
  switch (question.kind) {
    case 'trust':
      return (
        <Modal label="Trust this repository?" onClose={cancel}>
          <h2>Trust this repository?</h2>
          <p className="muted">
            Claude Code reads the settings, the hooks and the MCP servers of a repository when a session starts, before it asks anything. Trust only a repository that you know.
          </p>
          <dl className="facts">
            <div>
              <dt className="muted">Repository</dt>
              <dd>{question.repository}</dd>
            </div>
            {question.repositoryRoot !== null && (
              <div>
                <dt className="muted">Repository root</dt>
                <dd>{question.repositoryRoot}</dd>
              </div>
            )}
            <div>
              <dt className="muted">Folder</dt>
              <dd>{question.folder}</dd>
            </div>
            <div>
              <dt className="muted">Profile</dt>
              <dd>{question.profileName}</dd>
            </div>
          </dl>
          {question.holdsWorkspace && question.workspaceDirectory !== null && (
            <p className="warning" role="note">
              {`This repository holds the workspace directory ${question.workspaceDirectory}. Trust covers every plain folder under ${question.workspaceDirectory} for the profile ${question.profileName}.`}
            </p>
          )}
          <Findings found={question} emptyText="Aether found no .claude/settings*.json file and no .mcp.json file here." />
          <Buttons answers={[{ answer: 'trust', label: 'Trust', primary: true }]} onAnswer={onAnswer} />
        </Modal>
      )
    case 'outside':
      return (
        <Modal label="Use a folder outside the workspace directory?" onClose={cancel}>
          <h2>Use a folder outside the workspace directory?</h2>
          <p className="muted">
            The profile {question.profileName} keeps its repositories in its workspace directory. This session wants to work in a folder outside it.
          </p>
          <p>
            <code>{question.folder}</code>
          </p>
          <Findings found={question} emptyText={null} />
          <Buttons
            answers={[
              { answer: 'allow-once', label: 'Allow once' },
              { answer: 'allow-always', label: 'Always allow for this profile', primary: true }
            ]}
            onAnswer={onAnswer}
          />
        </Modal>
      )
    case 'other-profile':
      return (
        <Modal label="Use a folder of another profile?" onClose={cancel}>
          <h2>Use a folder of another profile?</h2>
          <p className="muted">
            This session belongs to the profile {question.profileName}. The folder lies in the workspace directory of the profile {question.otherProfileName}.
          </p>
          <p>
            <code>{question.folder}</code>
          </p>
          <p className="muted">
            The Claude account that reads these files uses the Claude folder{' '}
            {question.claudeFolder === null ? 'that Claude Code uses by default' : <code>{question.claudeFolder}</code>}.
          </p>
          <Findings found={question} emptyText={null} />
          <Buttons
            answers={[
              { answer: 'allow-once', label: 'Allow once' },
              { answer: 'allow-always', label: 'Always allow for this profile', primary: true }
            ]}
            onAnswer={onAnswer}
          />
        </Modal>
      )
  }
}
