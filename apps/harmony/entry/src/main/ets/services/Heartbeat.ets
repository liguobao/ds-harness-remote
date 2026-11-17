/**
 * 巡检心跳消息（`<heartbeat>…</heartbeat>`）的展示层解析。
 *
 * DSH 的自动化巡检会把一条结构化 XML 当作普通 prompt/回复发出来，
 * 直接贴进气泡就是一大坨标签。这里按上游 Android 的规则把它折成可读正文：
 * 只认四个字段，格式不对就原样返回（不做猜测，也不改写原文）。
 */

const ALLOWED_TAGS: string[] = ['automation_id', 'decision', 'message', 'instructions'];

/** 某个字段的解析结果。 */
class TagField {
  name: string = '';
  value: string = '';
}

/**
 * 解析 `<heartbeat>` 信封；不是心跳消息时返回空串。
 * role 传 'user' / 'assistant'，因为两侧要求的字段不同。
 */
export function heartbeatBodyOf(text: string, role: string): string {
  const trimmed: string = text.trim();
  const openTag: string = '<heartbeat>';
  const closeTag: string = '</heartbeat>';
  if (!trimmed.startsWith(openTag) || !trimmed.endsWith(closeTag)) {
    return '';
  }
  const inner: string = trimmed.substring(openTag.length, trimmed.length - closeTag.length);
  const fields: TagField[] = [];
  let rest: string = inner;
  for (let guard = 0; guard < ALLOWED_TAGS.length + 1; guard++) {
    const next: string = rest.trim();
    if (next.length === 0) {
      break;
    }
    if (next.charAt(0) !== '<') {
      return '';
    }
    const tagEnd: number = next.indexOf('>');
    if (tagEnd < 0) {
      return '';
    }
    const name: string = next.substring(1, tagEnd).trim();
    if (!ALLOWED_TAGS.includes(name)) {
      return '';
    }
    for (const seen of fields) {
      // 同一个字段出现两次：不是我们认识的形状，原样显示
      if (seen.name === name) {
        return '';
      }
    }
    const closing: string = '</' + name + '>';
    const bodyEnd: number = next.indexOf(closing, tagEnd + 1);
    if (bodyEnd < 0) {
      return '';
    }
    const field: TagField = new TagField();
    field.name = name;
    field.value = next.substring(tagEnd + 1, bodyEnd).trim();
    fields.push(field);
    rest = next.substring(bodyEnd + closing.length);
  }
  if (rest.trim().length > 0) {
    return '';
  }
  const automationId: string = valueOf(fields, 'automation_id');
  if (automationId.length === 0) {
    return '';
  }
  const decision: string = valueOf(fields, 'decision');
  const message: string = valueOf(fields, 'message');
  const instructions: string = valueOf(fields, 'instructions');
  if (role === 'assistant') {
    // 助手的回执必须带 decision，且不该出现 instructions
    if (decision.length === 0 || instructions.length > 0) {
      return '';
    }
    return message;
  }
  // 发起侧只有 instructions
  if (decision.length > 0 || message.length > 0) {
    return '';
  }
  return instructions;
}

function valueOf(fields: TagField[], name: string): string {
  for (const field of fields) {
    if (field.name === name) {
      return field.value;
    }
  }
  return '';
}
