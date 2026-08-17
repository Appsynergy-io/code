import { readFile } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'
import {
  getProjectInstructionPaths,
  instructionLocalFileName,
} from '../product/identity.js'

export type InstructionType = 'Project' | 'Local'

export type InstructionCandidate = {
  path: string
  type: InstructionType
}

export type LoadedInstruction = {
  path: string
  type: InstructionType
  content: string
}

/** Project + local instruction paths in one directory (identity names only). */
export function listInstructionFilesInDir(dir: string): InstructionCandidate[] {
  const out: InstructionCandidate[] = []
  for (const path of getProjectInstructionPaths(dir)) {
    out.push({ path, type: 'Project' })
  }
  out.push({ path: join(dir, instructionLocalFileName), type: 'Local' })
  return out
}

export function walkDirsToRoot(startDir: string): string[] {
  const dirs: string[] = []
  let currentDir = startDir
  while (currentDir !== parse(currentDir).root) {
    dirs.push(currentDir)
    currentDir = dirname(currentDir)
  }
  return dirs.reverse()
}

/** Load project/local instruction files from startDir up to root. */
export async function loadInstructionFilesFromTree(
  startDir: string,
): Promise<LoadedInstruction[]> {
  const loaded: LoadedInstruction[] = []
  for (const dir of walkDirsToRoot(startDir)) {
    for (const candidate of listInstructionFilesInDir(dir)) {
      try {
        const content = await readFile(candidate.path, 'utf8')
        if (content.trim()) {
          loaded.push({
            path: candidate.path,
            type: candidate.type,
            content,
          })
        }
      } catch {
        // missing / unreadable
      }
    }
  }
  return loaded
}

export function agentInheritsInstructionFiles(agent: {
  omitClaudeMd?: boolean
}): boolean {
  return !agent.omitClaudeMd
}
