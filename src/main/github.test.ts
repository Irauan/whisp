import { expect, it } from 'vitest'
import { parseLogins, parseRemote } from './github'

it('lists the working accounts of github.com', () => {
  const status = {
    hosts: {
      'github.com': [
        { login: 'home', state: 'success' },
        { login: 'expired', state: 'error' },
        { login: 'work', state: 'success' }
      ],
      'github.example.com': [{ login: 'other', state: 'success' }]
    }
  }
  expect(parseLogins(JSON.stringify(status))).toEqual(['home', 'work'])
})

it('reads the repository from a remote address', () => {
  expect(parseRemote('git@github.com:me/app.git\n')).toBe('me/app')
  expect(parseRemote('https://github.com/me/my.app')).toBe('me/my.app')
  expect(parseRemote('git@github.com-work:me/app.git')).toBe('me/app')
  expect(parseRemote('https://gitlab.com/me/app')).toBeNull()
  expect(parseRemote('')).toBeNull()
})

it('lists nothing for other output', () => {
  expect(parseLogins('')).toEqual([])
  expect(parseLogins('{}')).toEqual([])
})
