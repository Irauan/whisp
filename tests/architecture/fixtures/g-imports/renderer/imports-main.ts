// Fixture for restricted imports: renderer code imports Electron, Node and main code.
import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { listGithubAccounts } from '../../../../../src/main/github'

export const all = [app, readFileSync, listGithubAccounts]
