import { expect, test } from 'bun:test'
import {
  forkContextMessagesForSpawn,
  initialSpawnMessages,
  nonForkPromptMessages,
} from './spawnMessages.ts'

test('non-fork Agent tool spawn does not pass the parent transcript', () => {
  const parent = [
    { role: 'user', content: 'parent turn 1' },
    { role: 'assistant', content: 'parent reply' },
  ]
  expect(forkContextMessagesForSpawn(false, parent)).toBeUndefined()
  expect(forkContextMessagesForSpawn(true, parent)).toEqual(parent)

  const promptMessages = nonForkPromptMessages('do the nested work')
  expect(promptMessages).toEqual([{ content: 'do the nested work' }])

  expect(
    initialSpawnMessages({
      isForkPath: false,
      parentMessages: parent,
      promptMessages,
    }),
  ).toEqual(promptMessages)

  expect(
    initialSpawnMessages({
      isForkPath: true,
      parentMessages: parent,
      promptMessages,
    }),
  ).toEqual([...parent, ...promptMessages])
})
