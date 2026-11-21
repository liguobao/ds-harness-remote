import { z } from 'zod'

export const WORKSPACE_GIT_CAPABILITY = 'workspace.git.read.v1' as const

export const WORKSPACE_GIT_METHODS = [
  'workspace.git.status',
  'workspace.git.diff',
] as const

export const WORKSPACE_GIT_SCOPES = ['all', 'staged', 'unstaged'] as const
export type WorkspaceGitScope = typeof WORKSPACE_GIT_SCOPES[number]

export const WORKSPACE_GIT_FILE_STATUSES = [
  'modified',
  'added',
  'deleted',
  'renamed',
  'copied',
  'untracked',
  'unmerged',
] as const
export type WorkspaceGitFileStatus = typeof WORKSPACE_GIT_FILE_STATUSES[number]

export const WORKSPACE_GIT_MAX_FILES = 200
export const WORKSPACE_GIT_MAX_STATUS_STDOUT_BYTES = 512 * 1024
export const WORKSPACE_GIT_MAX_DIFF_BYTES = 256 * 1024
export const WORKSPACE_GIT_MAX_DIFF_LINES = 2_500
export const WORKSPACE_GIT_DEFAULT_CONTEXT_LINES = 3
export const WORKSPACE_GIT_MAX_CONTEXT_LINES = 20
export const WORKSPACE_GIT_TIMEOUT_MS = 10_000
export const WORKSPACE_GIT_MAX_CONCURRENT = 4
export const WORKSPACE_GIT_MAX_PATH_LENGTH = 1_024

/**
 * Lexical validation for a workspace-relative POSIX path passed to read-only Git RPCs.
 * Rejects control characters, drive/ADS colons, backslashes, leading dashes (flag injection),
 * absolute paths, and `.` / `..` / empty segments.
 */
export function isSafeWorkspaceGitRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > WORKSPACE_GIT_MAX_PATH_LENGTH) return false
  if (/[\0\r\n\\:]/.test(value)) return false
  if (value.startsWith('/') || value.startsWith('-')) return false
  const segments = value.split('/')
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.' || segment === '..') return false
  }
  return true
}

export const workspaceGitScopeSchema = z.enum(WORKSPACE_GIT_SCOPES)
export const workspaceGitFileStatusSchema = z.enum(WORKSPACE_GIT_FILE_STATUSES)

export const workspaceGitStatusParamsSchema = z.object({
  sessionId: z.string().min(1).max(512),
  scope: workspaceGitScopeSchema.optional(),
}).strict()

export type WorkspaceGitStatusParams = z.infer<typeof workspaceGitStatusParamsSchema>

export const workspaceGitFileEntrySchema = z.object({
  path: z.string().min(1).max(WORKSPACE_GIT_MAX_PATH_LENGTH),
  oldPath: z.string().min(1).max(WORKSPACE_GIT_MAX_PATH_LENGTH).optional(),
  status: workspaceGitFileStatusSchema,
  staged: z.boolean(),
  unstaged: z.boolean(),
  additions: z.number().int().min(0).nullable(),
  deletions: z.number().int().min(0).nullable(),
  isBinary: z.boolean(),
}).strict()

export type WorkspaceGitFileEntry = z.infer<typeof workspaceGitFileEntrySchema>

export const workspaceGitStatusResultSchema = z.object({
  isGitRepo: z.boolean(),
  branch: z.string().max(256).optional(),
  headShortSha: z.string().max(64).optional(),
  hasHead: z.boolean(),
  scope: workspaceGitScopeSchema,
  files: z.array(workspaceGitFileEntrySchema).max(WORKSPACE_GIT_MAX_FILES),
  totalFiles: z.number().int().min(0),
  truncated: z.boolean(),
  totalAdditions: z.number().int().min(0),
  totalDeletions: z.number().int().min(0),
}).strict()

export type WorkspaceGitStatusResult = z.infer<typeof workspaceGitStatusResultSchema>

export const workspaceGitDiffParamsSchema = z.object({
  sessionId: z.string().min(1).max(512),
  path: z.string().min(1).max(WORKSPACE_GIT_MAX_PATH_LENGTH).optional(),
  scope: workspaceGitScopeSchema.optional(),
  contextLines: z.number().int().min(0).max(WORKSPACE_GIT_MAX_CONTEXT_LINES).optional(),
}).strict()

export type WorkspaceGitDiffParams = z.infer<typeof workspaceGitDiffParamsSchema>

export const workspaceGitDiffResultSchema = z.object({
  isGitRepo: z.boolean(),
  path: z.string().min(1).max(WORKSPACE_GIT_MAX_PATH_LENGTH).optional(),
  scope: workspaceGitScopeSchema,
  diff: z.string(),
  bytes: z.number().int().min(0),
  lines: z.number().int().min(0),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  isBinary: z.boolean(),
  truncated: z.boolean(),
  truncatedReason: z.enum(['max-bytes', 'max-lines']).optional(),
}).strict()

export type WorkspaceGitDiffResult = z.infer<typeof workspaceGitDiffResultSchema>
