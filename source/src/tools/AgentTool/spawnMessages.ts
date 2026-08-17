/** Parent transcript is only attached on the fork path. */
export function forkContextMessagesForSpawn<T>(
  isForkPath: boolean,
  parentMessages: T[],
): T[] | undefined {
  return isForkPath ? parentMessages : undefined
}

export function nonForkPromptMessages(prompt: string): { content: string }[] {
  return [{ content: prompt }]
}

/** Messages the child actually sees: optional fork prefix + prompt messages. */
export function initialSpawnMessages<T>(input: {
  isForkPath: boolean
  parentMessages: T[]
  promptMessages: T[]
}): T[] {
  const fork = forkContextMessagesForSpawn(
    input.isForkPath,
    input.parentMessages,
  )
  return [...(fork ?? []), ...input.promptMessages]
}
