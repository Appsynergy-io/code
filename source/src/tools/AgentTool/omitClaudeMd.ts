/** Explore/Plan drop instruction-file context; the parent interprets their output. */
export const EXPLORE_OMIT_CLAUDE_MD = true
export const PLAN_OMIT_CLAUDE_MD = true

/** Same predicate runAgent uses to strip claudeMd from userContext. */
export function shouldOmitClaudeMd(
  agentDefinition: { omitClaudeMd?: boolean },
  opts: {
    hasUserContextOverride: boolean
    slimSubagentClaudeMd: boolean
  },
): boolean {
  return Boolean(
    agentDefinition.omitClaudeMd &&
      !opts.hasUserContextOverride &&
      opts.slimSubagentClaudeMd,
  )
}
