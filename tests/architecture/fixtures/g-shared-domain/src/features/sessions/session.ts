// Fixture: a domain file that imports a store. The store imports Node, so the domain
// reaches Node through the store.
import { load } from './session.store'

export const session = load
