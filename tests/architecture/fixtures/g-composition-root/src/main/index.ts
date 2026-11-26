// Fixture: src/main/index.ts is the composition root of the current layout. It may import a provider.
import { gh } from '../providers/github-cli/gh'

export const start = gh
