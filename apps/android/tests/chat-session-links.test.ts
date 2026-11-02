import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockOpenURL = vi.fn().mockResolvedValue(true)

vi.mock('react-native', () => ({
  Linking: {
    openURL: (...args: any[]) => mockOpenURL(...args),
  },
  StyleSheet: {
    create: (s: any) => s,
    hairlineWidth: 1,
  },
}))

import {
  sanitizeAndValidateHref,
  isCitationLink,
  formatDisplayUrl,
  classifyMarkdownLink,
  openSafeExternalUrl,
  decodeSessionMentionUri,
  decodeBase64ToBytes,
  decodeUtf8Bytes,
} from '../src/ui/link-helpers'

describe('会话链接排版与交互系统 (Link & Citation System)', () => {
  beforeEach(() => {
    mockOpenURL.mockClear()
  })

  describe('1. 严格协议白名单校验与安全清洗 (sanitizeAndValidateHref)', () => {
    it('阻断危险伪协议 (javascript:, data:, vbscript:, file:, blob: 等)', () => {
      const dangerous = [
        'javascript:alert(1)',
        'JAVASCRIPT:console.log(document.cookie)',
        'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
        'vbscript:msgbox("hello")',
        'file:///etc/passwd',
        'FILE:///sdcard/Download/test.apk',
        'blob:https://example.com/uuid',
        'intent:#Intent;scheme=bad;end',
        'content://contacts/people',
      ]
      for (const uri of dangerous) {
        const res = sanitizeAndValidateHref(uri)
        expect(res.isBlocked).toBe(true)
        expect(res.safeHref).toBeNull()
        expect(res.reason).toBe('unsafe_protocol')
      }
    })

    it('防御不可见控制字符拆写绕过 (如 java\\u0000script:, java\\tscript:)', () => {
      const obfuscated = [
        'java\u0000script:alert(1)',
        'java\tscript:alert(1)',
        'java\nscript:alert(1)',
        'java\rscript:alert(1)',
      ]
      for (const item of obfuscated) {
        const res = sanitizeAndValidateHref(item)
        expect(res.isBlocked).toBe(true)
        expect(res.safeHref).toBeNull()
      }
    })

    it('协议相对 URL (以 // 开头) 优先于相对路径正确规范化为 https', () => {
      const res = sanitizeAndValidateHref('//example.com/path')
      expect(res.isBlocked).toBe(false)
      expect(res.safeHref).toBe('https://example.com/path')
      expect(res.protocol).toBe('https:')
    })

    it('拒绝畸形协议相对 URL (如 ///, //\\)', () => {
      expect(sanitizeAndValidateHref('///example.com').isBlocked).toBe(true)
      expect(sanitizeAndValidateHref('//\\example.com').isBlocked).toBe(true)
    })

    it('隐式将 www. 前缀提升为 https:// 并完成规范化', () => {
      const res = sanitizeAndValidateHref('www.example.com/guide')
      expect(res.isBlocked).toBe(false)
      expect(res.safeHref).toBe('https://www.example.com/guide')
    })

    it('校验处理正常 HTTP/HTTPS/mailto URL', () => {
      const res = sanitizeAndValidateHref('https://Example.COM:8443/docs/overview?ref=test#section')
      expect(res.isBlocked).toBe(false)
      expect(res.safeHref).toBe('https://Example.COM:8443/docs/overview?ref=test#section')

      const mail = sanitizeAndValidateHref('mailto:developer@example.com')
      expect(mail.isBlocked).toBe(false)
      expect(mail.safeHref).toBe('mailto:developer@example.com')
    })

    it('拒绝非法/畸形 HTTP URL (无 host 或缺少斜杠)', () => {
      expect(sanitizeAndValidateHref('https:example.com').isBlocked).toBe(true)
      expect(sanitizeAndValidateHref('http://').isBlocked).toBe(true)
    })

    it('内部协议强校验有效载荷', () => {
      // 空或未识别载荷被阻断
      expect(sanitizeAndValidateHref('dsh-session:').isBlocked).toBe(true)
      expect(sanitizeAndValidateHref('dsh-session:invalid-base64!@#').isBlocked).toBe(true)
      expect(sanitizeAndValidateHref('workspace:').isBlocked).toBe(true)

      // 拒绝 workspace 伪装的 UNC、nested scheme、盘符及路径穿越
      expect(sanitizeAndValidateHref('workspace://server/share').isBlocked).toBe(true)
      expect(sanitizeAndValidateHref('workspace:https://example.com').isBlocked).toBe(true)
      expect(sanitizeAndValidateHref('workspace:../secret.txt').isBlocked).toBe(true)
      expect(sanitizeAndValidateHref('workspace:..\\secret.txt').isBlocked).toBe(true)
      expect(sanitizeAndValidateHref('workspace:src/..').isBlocked).toBe(true)
      expect(sanitizeAndValidateHref('workspace:C:/secret.txt').isBlocked).toBe(true)

      // 拒绝非法的 Base64 padding 与非法的 UTF-8 编码
      expect(sanitizeAndValidateHref('dsh-session:IsCvIg').isBlocked).toBe(true) // 非法 UTF-8 (overlong 0xc0 0xaf)
      expect(sanitizeAndValidateHref('dsh-session:Ingi====').isBlocked).toBe(true) // 异常 padding
      expect(sanitizeAndValidateHref('dsh-session:Zh==').isBlocked).toBe(true) // 未使用尾位非零的非规范 Base64

      // 有效的 session payload 正常放行
      // "session-123" -> JSON.stringify("session-123") -> base64url
      const validSessionPayload = Buffer.from(JSON.stringify('session-123')).toString('base64url')
      const validSessionHref = `dsh-session:${validSessionPayload}`
      expect(decodeSessionMentionUri(validSessionHref)).toBe('session-123')
      expect(sanitizeAndValidateHref(validSessionHref).isBlocked).toBe(false)

      // 有效 workspace 相对路径正常放行
      expect(sanitizeAndValidateHref('workspace:src/ui/markdown.tsx').isBlocked).toBe(false)
    })

    it('空值与非字符串类型边界安全处理', () => {
      expect(sanitizeAndValidateHref('' as any).isBlocked).toBe(true)
      expect(sanitizeAndValidateHref('   ' as any).isBlocked).toBe(true)
      expect(sanitizeAndValidateHref(null as any).isBlocked).toBe(true)
      expect(sanitizeAndValidateHref(undefined as any).isBlocked).toBe(true)
    })

    it('回退环境与严格 UTF-8 校验均阻断非法编码与过长序列', () => {
      // 1. 原生 TextDecoder 路径
      expect(decodeSessionMentionUri('dsh-session:IsCvIg')).toBeUndefined()

      // 2. 强制屏蔽 TextDecoder 触发纯 JS 回退实现
      const origDecoder = (globalThis as any).TextDecoder
      try {
        ;(globalThis as any).TextDecoder = undefined
        // 测试过长字节 0xC0 0xAF (本应是 ASCII '/')
        expect(decodeUtf8Bytes(new Uint8Array([0x22, 0xc0, 0xaf, 0x22]))).toBeUndefined()
        // 测试非法 UTF-16 代理项
        expect(decodeUtf8Bytes(new Uint8Array([0xed, 0xa0, 0x80]))).toBeUndefined()
        // 测试超出 Unicode 上限
        expect(decodeUtf8Bytes(new Uint8Array([0xf4, 0x90, 0x80, 0x80]))).toBeUndefined()
        // 测试合法多字节 UTF-8 正常解码
        expect(decodeUtf8Bytes(new Uint8Array([0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd]))).toBe('你好')

        expect(decodeSessionMentionUri('dsh-session:IsCvIg')).toBeUndefined()
      } finally {
        ;(globalThis as any).TextDecoder = origDecoder
      }
    })

    it('严格拒绝非零 Base64 尾位，同时接受规范编码', () => {
      expect(decodeBase64ToBytes('Zg==')).toEqual(new Uint8Array([0x66]))
      expect(decodeBase64ToBytes('Zg')).toEqual(new Uint8Array([0x66]))

      expect(decodeBase64ToBytes('Zh==')).toBeUndefined()
      expect(decodeBase64ToBytes('Zh')).toBeUndefined()

      // 两者在宽松解码器下均可解码为 JSON 字符串 "ab"；
      // 非规范形式必须在 Base64 校验阶段被拒绝。
      expect(decodeSessionMentionUri('dsh-session:ImFiIg==')).toBe('ab')
      expect(decodeSessionMentionUri('dsh-session:ImFiIh==')).toBeUndefined()
    })
  })

  describe('2. 引用角标检测 (isCitationLink)', () => {
    it('识别成对括号的引用角标 ([1], [^2], ^3)', () => {
      expect(isCitationLink('[1]')).toEqual({ isCitation: true, index: '1' })
      expect(isCitationLink('[^2]')).toEqual({ isCitation: true, index: '2' })
      expect(isCitationLink('^3')).toEqual({ isCitation: true, index: '3' })
      expect(isCitationLink('[12]')).toEqual({ isCitation: true, index: '12' })
    })

    it('识别中文命名引用标记 ([来源 1], [参考:2], [cite: 3])', () => {
      expect(isCitationLink('[来源 1]')).toEqual({ isCitation: true, index: '1' })
      expect(isCitationLink('[来源: 4]')).toEqual({ isCitation: true, index: '4' })
      expect(isCitationLink('[参考:2]')).toEqual({ isCitation: true, index: '2' })
      expect(isCitationLink('[cite: 5]')).toEqual({ isCitation: true, index: '5' })
    })

    it('通过合法锚点识别引用 (#cite-1, #fn-2)', () => {
      expect(isCitationLink('来源说明', '#cite-1')).toEqual({ isCitation: true, index: '1' })
      expect(isCitationLink('详情', '#fn-2')).toEqual({ isCitation: true, index: '2' })
    })

    it('排除普通文本与词组，杜绝误识别', () => {
      expect(isCitationLink('[React Native]').isCitation).toBe(false)
      expect(isCitationLink('[100MB]').isCitation).toBe(false)
      expect(isCitationLink('[v1.2.0]').isCitation).toBe(false)
      expect(isCitationLink('[1').isCitation).toBe(false)
      expect(isCitationLink('1]').isCitation).toBe(false)
      expect(isCitationLink('A').isCitation).toBe(false)
      expect(isCitationLink('B').isCitation).toBe(false)
    })

    it('防御长字符串回溯灾难 (二次方回溯防护)', () => {
      const malicious = '[来源' + ' '.repeat(500) + 'x]'
      const start = Date.now()
      expect(isCitationLink(malicious).isCitation).toBe(false)
      const duration = Date.now() - start
      expect(duration).toBeLessThan(100)
    })
  })

  describe('3. 长 URL 格式化与防撑破排版 (formatDisplayUrl)', () => {
    it('去除协议头与 www. 前缀', () => {
      expect(formatDisplayUrl('https://www.example.com/docs')).toBe('example.com/docs')
      expect(formatDisplayUrl('http://github.com/org/repo')).toBe('github.com/org/repo')
    })

    it('超过 maxLen 时保留首尾域名和路径，中间以省略号折叠', () => {
      const longUrl = 'https://www.example.com/deeply/nested/article/path/to/some/very/long/document'
      const formatted = formatDisplayUrl(longUrl, 32)
      expect(formatted.length).toBeLessThanOrEqual(32)
      expect(formatted).toContain('…')
      expect(formatted.startsWith('example.com/')).toBe(true)
    })
  })

  describe('4. 多态分类器与优先级 (classifyMarkdownLink)', () => {
    it('优先识别内部工作区链接，防止被角标规则误识别', () => {
      const info = classifyMarkdownLink('./src/ui/markdown.tsx', '[1]')
      expect(info.kind).toBe('workspace')
      expect(info.workspacePath).toBe('src/ui/markdown.tsx')
      expect(info.displayText).toBe('[1]')
    })

    it('正确分类 session 内部会话引用', () => {
      const href = `dsh-session:${Buffer.from(JSON.stringify('session-456')).toString('base64url')}`
      const info = classifyMarkdownLink(href, '对话456')
      expect(info.kind).toBe('session')
      expect(info.sessionId).toBe('session-456')
      expect(info.displayText).toBe('对话456')
    })

    it('正确分类 external 外部链接并提取域名', () => {
      const info = classifyMarkdownLink('https://github.com/liguobao/ds-harness-remote', '项目仓库')
      expect(info.kind).toBe('external')
      expect(info.isBlocked).toBe(false)
      expect(info.domain).toBe('github.com')
      expect(info.displayText).toBe('项目仓库')
    })

    it('对裸长外部链接文本自动执行格式化截断', () => {
      const raw = 'https://www.google.com/search?q=react+native+markdown+styling+and+citations'
      const info = classifyMarkdownLink(raw, raw)
      expect(info.kind).toBe('external')
      expect(info.displayText.length).toBeLessThanOrEqual(42)
      expect(info.displayText).toContain('…')
    })

    it('正确识别引用来源角标并提取编号', () => {
      const info = classifyMarkdownLink('#cite-3', '[3]')
      expect(info.kind).toBe('citation')
      expect(info.citationIndex).toBe('3')
      expect(info.displayText).toBe('3')
    })

    it('阻断危险协议并保留原始可读展示文本', () => {
      const info = classifyMarkdownLink('javascript:alert(1)', '危险操作')
      expect(info.isBlocked).toBe(true)
      expect(info.safeHref).toBeNull()
      expect(info.displayText).toBe('危险操作')
    })
  })

  describe('5. openSafeExternalUrl 跳转安全控制', () => {
    it('允许合法 http / https 外部链接并正确调用系统 openURL', () => {
      const res = openSafeExternalUrl('https://github.com')
      expect(res).toBe(true)
      expect(mockOpenURL).toHaveBeenCalledTimes(1)
      expect(mockOpenURL).toHaveBeenCalledWith('https://github.com')
    })

    it('允许 mailto 协议', () => {
      const res = openSafeExternalUrl('mailto:test@example.com')
      expect(res).toBe(true)
      expect(mockOpenURL).toHaveBeenCalledWith('mailto:test@example.com')
    })

    it('绝对阻断危险伪协议，零调用系统 openURL', () => {
      expect(openSafeExternalUrl('javascript:void(0)')).toBe(false)
      expect(openSafeExternalUrl('file:///sdcard/test.txt')).toBe(false)
      expect(openSafeExternalUrl('data:text/plain;hello')).toBe(false)
      expect(mockOpenURL).not.toHaveBeenCalled()
    })

    it('绝对阻断私有协议通过外部浏览器打开，零调用系统 openURL', () => {
      const validSessionPayload = Buffer.from(JSON.stringify('session-123')).toString('base64url')
      const validSessionHref = `dsh-session:${validSessionPayload}`
      expect(sanitizeAndValidateHref(validSessionHref).isBlocked).toBe(false)
      expect(openSafeExternalUrl(validSessionHref)).toBe(false)
      expect(openSafeExternalUrl('workspace:src/index.ts')).toBe(false)
      expect(mockOpenURL).not.toHaveBeenCalled()
    })
  })
})
