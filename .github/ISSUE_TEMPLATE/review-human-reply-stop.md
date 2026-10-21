---
name: Review 人工回复后停止 AI / Stop AI after human reply
about: Review 出现人工回复后立即停止 AI 自动回复 / Stop AI replies when a human responds in Review
title: "[Review] 人工回复后停止 AI 自动回复 / Stop AI after human reply"
labels: "review, automation"
assignees: ""
---

## 需求 / Request

Review 中一旦出现 Review 人员的人工回复，AI 必须立即停止当前及后续的自动回复，并保持静默。

Once a human reviewer replies, AI must stop the current and all subsequent automated replies and remain silent.

## 行为 / Behavior

- 取消正在生成或排队中的 AI 回复；不再发送追问、总结或评论。
- 重连、重试、定时任务和重复事件不得重新唤醒 AI。
- 保留人工回复，并将 Review 标记为“人工接管”。
- 只有明确的恢复指令（例如 `继续 AI Review` / `Resume AI Review`）才能恢复；普通评论不算恢复指令。

- Cancel in-progress or queued AI replies; do not send follow-up questions, summaries, or comments.
- Reconnects, retries, scheduled tasks, and duplicate events must not wake AI again.
- Keep the human reply and mark the Review as “human takeover”.
- Resume only after an explicit command such as `继续 AI Review` / `Resume AI Review`; ordinary comments do not resume AI.

## 验收 / Acceptance

- [ ] 人工回复后不会出现任何新的 AI 消息。
- [ ] 只有明确恢复指令可以解除人工接管。
- [ ] 并发、重连和重试场景仍保持上述行为。

- [ ] No new AI message appears after a human reply.
- [ ] Only an explicit resume command clears the human takeover state.
- [ ] The behavior holds under concurrency, reconnects, and retries.

## 补充信息 / Additional information

<!-- 请补充 Review 链接、复现步骤或相关日志。不要粘贴 Token、私钥、Prompt 或其他敏感信息。 -->

<!-- Add the Review link, reproduction steps, or relevant logs. Do not paste tokens, private keys, prompts, or other sensitive information. -->
