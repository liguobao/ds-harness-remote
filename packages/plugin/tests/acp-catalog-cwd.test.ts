import { describe, expect, it } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { catalogCwdCandidates } from '../src/acp/catalog-cwd.js'

describe('catalogCwdCandidates', () => {
  it('normalizes Windows URI pathnames and file URIs while preserving POSIX paths and failing closed', async () => {
    await runScenarios([
      {
        name: 'win32 encoded drive pathname (/d%3A/...)',
        input: '/d%3A/Users/dev/Documents/sample-editor',
        platform: 'win32' as const,
        expected: ['d:\\Users\\dev\\Documents\\sample-editor'],
      },
      {
        name: 'win32 lowercase %3a with spaces and UTF-8 segments',
        input: '/c%3a/Users/my%20app/%E4%B8%AD%E6%96%87/proj',
        platform: 'win32' as const,
        expected: ['c:\\Users\\my app\\中文\\proj'],
      },
      {
        name: 'win32 bare encoded drive root (/d%3A)',
        input: '/d%3A',
        platform: 'win32' as const,
        expected: ['d:\\'],
      },
      {
        name: 'win32 bare encoded drive root with trailing slash (/d%3A/)',
        input: '/d%3A/',
        platform: 'win32' as const,
        expected: ['d:\\'],
      },
      {
        name: 'win32 slash-prefixed drive without percent signs keeps # intact',
        input: '/D:/Users/C#Project/repo',
        platform: 'win32' as const,
        expected: ['D:\\Users\\C#Project\\repo'],
      },
      {
        name: 'win32 slash-prefixed drive with % tries literal first then decoded',
        input: '/D:/Users/my%20app/%E9%A1%B9%E7%9B%AE',
        platform: 'win32' as const,
        expected: ['D:\\Users\\my%20app\\%E9%A1%B9%E7%9B%AE', 'D:\\Users\\my app\\项目'],
      },
      {
        name: 'win32 file:///d%3A/... URI',
        input: 'file:///d%3A/Users/dev/project',
        platform: 'win32' as const,
        expected: ['d:\\Users\\dev\\project'],
      },
      {
        name: 'win32 file://localhost/D:/... URI',
        input: 'file://localhost/D:/Users/dev/my%20project',
        platform: 'win32' as const,
        expected: ['D:\\Users\\dev\\my project'],
      },
      {
        name: 'win32 bare file:///d%3A URI appends drive root backslash',
        input: 'file:///d%3A',
        platform: 'win32' as const,
        expected: ['d:\\'],
      },
      {
        name: 'win32 native path and UNC path pass through unchanged',
        input: 'D:\\Users\\dev\\project',
        platform: 'win32' as const,
        expected: ['D:\\Users\\dev\\project'],
      },
      {
        name: 'win32 UNC path passes through unchanged',
        input: '\\\\server\\share\\repo',
        platform: 'win32' as const,
        expected: ['\\\\server\\share\\repo'],
      },
      {
        name: 'linux keeps /d%3A/... literal without percent-decoding',
        input: '/d%3A/Users/my%20app',
        platform: 'linux' as const,
        expected: ['/d%3A/Users/my%20app'],
      },
      {
        name: 'linux file:///tmp/my%20app URI converts to POSIX path',
        input: 'file:///tmp/my%20app',
        platform: 'linux' as const,
        expected: ['/tmp/my app'],
      },
      {
        name: 'rejects remote file:// host to prevent SMB/NTLM lookup',
        input: 'file://attacker/share/repo',
        platform: 'win32' as const,
        expected: [],
      },
      {
        name: 'rejects file:// URI with query or hash fragment',
        input: 'file:///d%3A/Users/dev/project?x=1',
        platform: 'win32' as const,
        expected: [],
      },
      {
        name: 'rejects file:// URI with hash fragment',
        input: 'file:///d%3A/Users/dev/project#frag',
        platform: 'win32' as const,
        expected: [],
      },
      {
        name: 'rejects encoded slash, backslash, NUL, and malformed percent in /d%3A/...',
        input: '/d%3A/Users/a%2Fb',
        platform: 'win32' as const,
        expected: [],
      },
      {
        name: 'rejects encoded backslash in /d%3A/...',
        input: '/d%3A/Users/a%5Cb',
        platform: 'win32' as const,
        expected: [],
      },
      {
        name: 'rejects NUL byte in /d%3A/...',
        input: '/d%3A/Users/a%00b',
        platform: 'win32' as const,
        expected: [],
      },
      {
        name: 'rejects malformed percent sequence in /d%3A/...',
        input: '/d%3A/Users/%ZZ',
        platform: 'win32' as const,
        expected: [],
      },
      {
        name: 'rejects mixed backslash in URI drive pathname',
        input: '/d%3A/Users\\foo',
        platform: 'win32' as const,
        expected: [],
      },
      {
        name: 'keeps relative path unchanged for downstream isAbsolute rejection',
        input: './relative/dir',
        platform: 'win32' as const,
        expected: ['./relative/dir'],
      },
    ].map(scenario => ({
      name: scenario.name,
      run: () => {
        expect(catalogCwdCandidates(scenario.input, scenario.platform)).toEqual(scenario.expected)
      },
    })))
  })
})
