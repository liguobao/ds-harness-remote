import { describe, expect, it } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import {
  applyChangeQuoteDraft,
  formatDiffReference,
  hunkQuoteRange,
  parseUnifiedDiff,
  type ParsedDiffHunk,
} from '../src/lib/unified-diff'
import { applyLanguagePreference, getActiveLanguage, strings } from '../src/locales/i18n'
import { sessionToolsError } from '../src/screens/session-tools-error'

describe('parseUnifiedDiff', () => {
  it('parses single-file, multi-hunk, new, deleted, renamed, binary, no-newline, and truncated diffs', async () => {
    await runScenarios([
      {
        name: 'multi-hunk modification tracks old/new line numbers and context',
        run: () => {
          const diff = [
            'diff --git a/src/app.ts b/src/app.ts',
            'index 1111111..2222222 100644',
            '--- a/src/app.ts',
            '+++ b/src/app.ts',
            '@@ -10,4 +10,5 @@ export function run() {',
            ' const a = 1',
            '-const b = 2',
            '+const b = 3',
            '+const c = 4',
            ' return a + b',
            '@@ -30,3 +31,2 @@ export function stop() {',
            ' cleanup()',
            '-legacy()',
            ' done()',
            '',
          ].join('\n')

          const files = parseUnifiedDiff(diff)
          expect(files).toHaveLength(1)
          const file = files[0]!
          expect(file.path).toBe('src/app.ts')
          expect(file.isNew).toBe(false)
          expect(file.isDeleted).toBe(false)
          expect(file.isRenamed).toBe(false)
          expect(file.isBinary).toBe(false)
          expect(file.additions).toBe(2)
          expect(file.deletions).toBe(2)
          expect(file.hunks).toHaveLength(2)

          const first = file.hunks[0]!
          expect(first.oldStart).toBe(10)
          expect(first.oldCount).toBe(4)
          expect(first.newStart).toBe(10)
          expect(first.newCount).toBe(5)
          expect(first.context).toBe('export function run() {')
          expect(first.lines).toEqual([
            { kind: 'context', content: 'const a = 1', oldLine: 10, newLine: 10 },
            { kind: 'del', content: 'const b = 2', oldLine: 11 },
            { kind: 'add', content: 'const b = 3', newLine: 11 },
            { kind: 'add', content: 'const c = 4', newLine: 12 },
            { kind: 'context', content: 'return a + b', oldLine: 12, newLine: 13 },
          ])

          const second = file.hunks[1]!
          expect(second.oldStart).toBe(30)
          expect(second.newStart).toBe(31)
          expect(second.lines).toEqual([
            { kind: 'context', content: 'cleanup()', oldLine: 30, newLine: 31 },
            { kind: 'del', content: 'legacy()', oldLine: 31 },
            { kind: 'context', content: 'done()', oldLine: 32, newLine: 32 },
          ])
        },
      },
      {
        name: 'new file, deleted file, and renamed file with edits',
        run: () => {
          const diff = [
            'diff --git a/src/new.ts b/src/new.ts',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/src/new.ts',
            '@@ -0,0 +1,2 @@',
            '+line 1',
            '+line 2',
            'diff --git a/src/old.ts b/src/old.ts',
            'deleted file mode 100644',
            '--- a/src/old.ts',
            '+++ /dev/null',
            '@@ -1,2 +0,0 @@',
            '-gone 1',
            '-gone 2',
            'diff --git a/src/before.ts b/src/after.ts',
            'similarity index 80%',
            'rename from src/before.ts',
            'rename to src/after.ts',
            '--- a/src/before.ts',
            '+++ b/src/after.ts',
            '@@ -1 +1 @@',
            '-oldName()',
            '+newName()',
          ].join('\n')

          const files = parseUnifiedDiff(diff)
          expect(files).toHaveLength(3)

          expect(files[0]).toMatchObject({
            path: 'src/new.ts',
            isNew: true,
            isDeleted: false,
            isRenamed: false,
            additions: 2,
            deletions: 0,
          })
          expect(files[0]!.hunks[0]!.lines).toEqual([
            { kind: 'add', content: 'line 1', newLine: 1 },
            { kind: 'add', content: 'line 2', newLine: 2 },
          ])

          expect(files[1]).toMatchObject({
            path: 'src/old.ts',
            isNew: false,
            isDeleted: true,
            isRenamed: false,
            additions: 0,
            deletions: 2,
          })
          expect(files[1]!.hunks[0]!.lines).toEqual([
            { kind: 'del', content: 'gone 1', oldLine: 1 },
            { kind: 'del', content: 'gone 2', oldLine: 2 },
          ])

          expect(files[2]).toMatchObject({
            path: 'src/after.ts',
            oldPath: 'src/before.ts',
            newPath: 'src/after.ts',
            isRenamed: true,
            additions: 1,
            deletions: 1,
          })
          expect(files[2]!.hunks[0]!.oldCount).toBe(1)
          expect(files[2]!.hunks[0]!.newCount).toBe(1)
        },
      },
      {
        name: 'binary files and GIT binary patch',
        run: () => {
          const diff = [
            'diff --git a/assets/icon.png b/assets/icon.png',
            'index 1234567..89abcdef 100644',
            'Binary files a/assets/icon.png and b/assets/icon.png differ',
            'diff --git a/assets/raw.bin b/assets/raw.bin',
            'GIT binary patch',
            'literal 4',
            'LcmZQzU|<0R00031',
          ].join('\n')

          const files = parseUnifiedDiff(diff)
          expect(files).toHaveLength(2)
          expect(files[0]).toMatchObject({ path: 'assets/icon.png', isBinary: true, hunks: [] })
          expect(files[1]).toMatchObject({ path: 'assets/raw.bin', isBinary: true, hunks: [] })
        },
      },
      {
        name: 'no-newline meta marker does not advance line numbers',
        run: () => {
          const diff = [
            'diff --git a/README.md b/README.md',
            '--- a/README.md',
            '+++ b/README.md',
            '@@ -1,2 +1,2 @@',
            ' title',
            '-old tail',
            '\\ No newline at end of file',
            '+new tail',
            '\\ No newline at end of file',
          ].join('\n')

          const files = parseUnifiedDiff(diff)
          expect(files[0]!.hunks[0]!.lines).toEqual([
            { kind: 'context', content: 'title', oldLine: 1, newLine: 1 },
            { kind: 'del', content: 'old tail', oldLine: 2 },
            { kind: 'meta', content: '\\ No newline at end of file' },
            { kind: 'add', content: 'new tail', newLine: 2 },
            { kind: 'meta', content: '\\ No newline at end of file' },
          ])
        },
      },
      {
        name: 'handles truncated diff tail and deleted --- lines cleanly',
        run: () => {
          const diff = [
            'diff --git a/notes.md b/notes.md',
            '--- a/notes.md',
            '+++ b/notes.md',
            '@@ -5,4 +5,5 @@',
            ' keep',
            '--- horizontal rule',
            '+added first',
            '+added partial without trailing newline',
          ].join('\n')

          const files = parseUnifiedDiff(diff)
          expect(files).toHaveLength(1)
          const lines = files[0]!.hunks[0]!.lines
          expect(lines).toEqual([
            { kind: 'context', content: 'keep', oldLine: 5, newLine: 5 },
            { kind: 'del', content: '-- horizontal rule', oldLine: 6 },
            { kind: 'add', content: 'added first', newLine: 6 },
            { kind: 'add', content: 'added partial without trailing newline', newLine: 7 },
          ])
        },
      },
      {
        name: 'parses merge conflict combined diff (diff --cc / @@@) with accurate new-file line numbers',
        run: () => {
          const diff = [
            'diff --cc conflict.txt',
            'index 5f4a248,d342720..0000000',
            '--- a/conflict.txt',
            '+++ b/conflict.txt',
            '@@@ -1,3 -1,3 +1,7 @@@',
            '  line1',
            '++<<<<<<< HEAD',
            ' +main-change',
            '++=======',
            '+ feat-change',
            '++>>>>>>> feat',
            '  line3',
          ].join('\n')

          const files = parseUnifiedDiff(diff)
          expect(files).toHaveLength(1)
          const file = files[0]!
          expect(file.path).toBe('conflict.txt')
          expect(file.additions).toBe(5)
          expect(file.deletions).toBe(0)
          expect(file.hunks).toHaveLength(1)
          expect(file.hunks[0]!.lines).toEqual([
            { kind: 'context', content: 'line1', oldLine: 1, newLine: 1 },
            { kind: 'add', content: '<<<<<<< HEAD', newLine: 2 },
            { kind: 'add', content: 'main-change', newLine: 3 },
            { kind: 'add', content: '=======', newLine: 4 },
            { kind: 'add', content: 'feat-change', newLine: 5 },
            { kind: 'add', content: '>>>>>>> feat', newLine: 6 },
            { kind: 'context', content: 'line3', oldLine: 2, newLine: 7 },
          ])
          expect(hunkQuoteRange(file.hunks[0]!)).toEqual({ start: 2, end: 6 })
        },
      },
      {
        name: 'parses empty file with " b/" in name, mixed-quoted diff --git, C-quoted tab path, and headerless file after binary',
        run: () => {
          const diff = [
            'diff --git a/foo b/bar.txt b/foo b/bar.txt',
            'new file mode 100644',
            'diff --git a/plain.sh "b/weird\\"name.sh"',
            'similarity index 100%',
            'diff --git "a/col1\\tcol2.txt" "b/col1\\tcol2.txt"',
            'new file mode 100644',
            '--- /dev/null',
            '+++ "b/col1\\tcol2.txt"\t2026-01-01',
            '@@ -0,0 +1,1 @@',
            '+tabbed',
            'Binary files a/img.png and b/img.png differ',
            '--- a/next.txt',
            '+++ b/next.txt',
            '@@ -1 +1 @@',
            '-before',
            '+after',
          ].join('\n')

          const files = parseUnifiedDiff(diff)
          expect(files).toHaveLength(5)
          expect(files[0]).toMatchObject({ path: 'foo b/bar.txt', isNew: true, isRenamed: false })
          expect(files[1]).toMatchObject({ path: 'weird"name.sh', oldPath: 'plain.sh', newPath: 'weird"name.sh', isRenamed: true })
          expect(files[2]).toMatchObject({ path: 'col1\tcol2.txt', isNew: true, additions: 1 })
          expect(files[3]).toMatchObject({ path: 'img.png', isBinary: true, hunks: [] })
          expect(files[4]).toMatchObject({ path: 'next.txt', isBinary: false, additions: 1, deletions: 1 })
          expect(files[4]!.hunks).toHaveLength(1)
        },
      },
    ])
  })
})

describe('hunkQuoteRange', () => {
  it('selects add span, context fallback, pure deletion anchor, and deleted file old span', () => {
    const withAdds: ParsedDiffHunk = {
      header: '@@ -10,4 +10,6 @@',
      oldStart: 10,
      oldCount: 4,
      newStart: 10,
      newCount: 6,
      lines: [
        { kind: 'context', content: 'a', oldLine: 10, newLine: 10 },
        { kind: 'add', content: 'b', newLine: 11 },
        { kind: 'context', content: 'c', oldLine: 11, newLine: 12 },
        { kind: 'add', content: 'd', newLine: 13 },
        { kind: 'add', content: 'e', newLine: 14 },
      ],
    }
    expect(hunkQuoteRange(withAdds)).toEqual({ start: 11, end: 14 })

    const contextOnly: ParsedDiffHunk = {
      header: '@@ -20,4 +20,3 @@',
      oldStart: 20,
      oldCount: 4,
      newStart: 20,
      newCount: 3,
      lines: [
        { kind: 'context', content: 'a', oldLine: 20, newLine: 20 },
        { kind: 'del', content: 'removed', oldLine: 21 },
        { kind: 'context', content: 'b', oldLine: 22, newLine: 21 },
        { kind: 'context', content: 'c', oldLine: 23, newLine: 22 },
      ],
    }
    expect(hunkQuoteRange(contextOnly)).toEqual({ start: 20, end: 22 })

    const pureDeletionInExistingFile: ParsedDiffHunk = {
      header: '@@ -15,3 +14,0 @@',
      oldStart: 15,
      oldCount: 3,
      newStart: 14,
      newCount: 0,
      lines: [
        { kind: 'del', content: 'x', oldLine: 15 },
        { kind: 'del', content: 'y', oldLine: 16 },
        { kind: 'del', content: 'z', oldLine: 17 },
      ],
    }
    expect(hunkQuoteRange(pureDeletionInExistingFile, false)).toEqual({ start: 14, end: 14 })

    const deletedWholeFile: ParsedDiffHunk = {
      header: '@@ -1,5 +0,0 @@',
      oldStart: 1,
      oldCount: 5,
      newStart: 0,
      newCount: 0,
      lines: [
        { kind: 'del', content: 'line 1', oldLine: 1 },
      ],
    }
    expect(hunkQuoteRange(deletedWholeFile, true)).toEqual({ start: 1, end: 5 })
    expect(hunkQuoteRange(deletedWholeFile, false)).toBeUndefined()
  })
})

describe('formatDiffReference', () => {
  it('formats file-only, single-line, multi-line, and whitespace paths', () => {
    expect(formatDiffReference('src/index.ts')).toBe('src/index.ts')
    expect(formatDiffReference('src/index.ts', { start: 42, end: 42 })).toBe('src/index.ts:L42')
    expect(formatDiffReference('src/index.ts', { start: 42, end: 58 })).toBe('src/index.ts:L42-L58')
    expect(formatDiffReference('src/index.ts', { start: 58, end: 42 })).toBe('src/index.ts:L42-L58')
    expect(formatDiffReference('docs/my notes.md', { start: 3, end: 9 })).toBe('`docs/my notes.md:L3-L9`')
    expect(formatDiffReference('docs/my notes.md')).toBe('`docs/my notes.md`')
  })
})

describe('applyChangeQuoteDraft', () => {
  const template = (ref: string) => `请修改 ${ref}：`

  it('uses promptTemplate for empty or whitespace drafts and smart-appends for non-empty drafts', () => {
    const empty = applyChangeQuoteDraft('', 'src/a.ts:L10-L15', template)
    expect(empty).toEqual({
      draft: '请修改 src/a.ts:L10-L15：',
      cursor: '请修改 src/a.ts:L10-L15：'.length,
    })

    const whitespaceOnly = applyChangeQuoteDraft('   \n\t ', 'src/a.ts:L10', template)
    expect(whitespaceOnly).toEqual({
      draft: '请修改 src/a.ts:L10：',
      cursor: '请修改 src/a.ts:L10：'.length,
    })

    const appendWithSpace = applyChangeQuoteDraft('帮我检查这段逻辑', 'src/a.ts:L10-L15', template)
    expect(appendWithSpace).toEqual({
      draft: '帮我检查这段逻辑 src/a.ts:L10-L15 ',
      cursor: '帮我检查这段逻辑 src/a.ts:L10-L15 '.length,
    })

    const appendAfterTrailingSpace = applyChangeQuoteDraft('帮我检查 ', 'src/a.ts:L10', template)
    expect(appendAfterTrailingSpace).toEqual({
      draft: '帮我检查 src/a.ts:L10 ',
      cursor: '帮我检查 src/a.ts:L10 '.length,
    })

    const appendAfterNewline = applyChangeQuoteDraft('第一点：\n', 'src/a.ts:L10', template)
    expect(appendAfterNewline).toEqual({
      draft: '第一点：\nsrc/a.ts:L10 ',
      cursor: '第一点：\nsrc/a.ts:L10 '.length,
    })
  })
})

describe('sessionToolsError workspace git codes', () => {
  it('maps workspace git codes and scopes shared error codes to changes tab only', () => {
    const previous = getActiveLanguage()
    applyLanguagePreference('zh-CN')
    try {
      const globalGitCases = [
        ['WORKSPACE_GIT_UNAVAILABLE', strings.tools.changesGitUnavailable],
        ['WORKSPACE_GIT_UNSAFE_REPO', strings.tools.changesUnsafeRepo],
      ] as const
      for (const [code, expected] of globalGitCases) {
        expect(expected.length).toBeGreaterThan(0)
        expect(sessionToolsError({ code })).toBe(expected)
        expect(sessionToolsError({ code }, 'changes')).toBe(expected)
      }
      const changesOnlyCases = [
        ['WORKSPACE_UNAVAILABLE', strings.tools.changesWorkspaceUnavailable],
        ['WORKSPACE_PATH_DENIED', strings.tools.accessDenied],
        ['RATE_LIMITED', strings.tools.changesRateLimited],
      ] as const
      for (const [code, expected] of changesOnlyCases) {
        expect(expected.length).toBeGreaterThan(0)
        expect(sessionToolsError({ code }, 'changes')).toBe(expected)
        expect(sessionToolsError({ code })).toBe(strings.tools.failed)
        expect(sessionToolsError({ code }, 'general')).toBe(strings.tools.failed)
      }
    } finally {
      applyLanguagePreference(previous)
    }
  })
})
