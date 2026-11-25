import { expect, it } from 'vitest'
import { toAttachments } from './repository'

it('adds each folder of the files one time', () => {
  expect(toAttachments(['a.ts', 'src/main/b.ts', 'src/c.ts']).map((item) => item.label)).toEqual([
    'src/',
    'src/main/',
    'a.ts',
    'src/main/b.ts',
    'src/c.ts'
  ])
})
