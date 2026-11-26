// Fixture for the other import rules: renderer code that imports a domain file and a handler.
import { list } from '../features/sessions/list/list.handler'
import { session } from '../features/sessions/session'

export const View = () => <div>{list.length + Object.keys(session).length}</div>
