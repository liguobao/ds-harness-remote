import { describe, expect, it } from 'vitest'
import { heartbeatMessageBody } from '../src/ui/heartbeat-message'

describe('heartbeat presentation', () => {
  const reply = '<heartbeat>\n<automation_id>dsh</automation_id>\n<decision>NOTIFY</decision>\n<message>18:29 巡检：**可用**\n队列 0→670KB→1.62MB。</message>\n</heartbeat>'
  it('extracts Markdown prose without changing the source', () => {
    expect(heartbeatMessageBody(reply, 'assistant')).toBe('18:29 巡检：**可用**\n队列 0→670KB→1.62MB。')
    expect(reply).toContain('<decision>NOTIFY</decision>')
  })
  it('unwraps the scheduled prompt instructions', () => {
    expect(heartbeatMessageBody('<heartbeat><automation_id>dsh</automation_id><instructions>检查 TURN 和 Relay</instructions></heartbeat>', 'user')).toBe('检查 TURN 和 Relay')
  })
  it('keeps incomplete, quoted, unknown and ambiguous content visible verbatim', () => {
    for (const text of [reply.slice(0, -12), `示例：${reply}`, `\`\`\`xml\n${reply}\n\`\`\``, reply.replace('<decision>', '<extra>x</extra><decision>'), reply.replace('</message>', '</message><message>other</message>'), reply.replace('<automation_id>dsh</automation_id>', ''), reply.replace(/<message>[\s\S]*?<\/message>/, '<message></message>')]) {
      expect(heartbeatMessageBody(text, 'assistant')).toBeUndefined()
    }
    expect(heartbeatMessageBody(reply, 'user')).toBeUndefined()
  })
})
