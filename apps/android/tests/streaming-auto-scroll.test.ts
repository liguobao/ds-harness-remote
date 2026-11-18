import { describe, expect, it } from 'vitest'
import { computeStreamingSignature, LATEST_EDGE_PX } from '../src/state/message-helpers'
import type { ChatMessage } from '../src/types'

describe('streaming auto-scroll and smart scroll mechanics', () => {
  it('returns empty signature for empty message list', () => {
    expect(computeStreamingSignature([])).toBe('')
  })

  it('detects streaming text delta increments on the last message', () => {
    const baseMessage: ChatMessage = {
      id: 'msg-1',
      sessionId: 'session-1',
      createdAt: 1000,
      kind: 'message',
      role: 'assistant',
      text: 'Hello',
      images: [],
    }

    const sig1 = computeStreamingSignature([baseMessage])
    expect(sig1).toBe('msg-1:5:0::')

    const streamedChunk1: ChatMessage = {
      ...baseMessage,
      text: 'Hello world',
    }
    const sig2 = computeStreamingSignature([streamedChunk1])
    expect(sig2).toBe('msg-1:11:0::')
    expect(sig2).not.toBe(sig1)

    const streamedChunk2: ChatMessage = {
      ...baseMessage,
      text: 'Hello world, how can I help you today?',
    }
    const sig3 = computeStreamingSignature([streamedChunk2])
    expect(sig3).toBe('msg-1:38:0::')
    expect(sig3).not.toBe(sig2)
  })

  it('detects streaming reasoning (thinking) increments', () => {
    const baseMessage: ChatMessage = {
      id: 'msg-think-1',
      sessionId: 'session-1',
      createdAt: 1000,
      kind: 'message',
      role: 'assistant',
      text: '',
      reasoning: 'Analyzing question',
      images: [],
    }

    const sig1 = computeStreamingSignature([baseMessage])
    expect(sig1).toBe('msg-think-1:0:18::')

    const baseMessageWithMoreReasoning: ChatMessage = {
      ...baseMessage,
      reasoning: 'Analyzing question carefully step by step...',
    }
    const sig2 = computeStreamingSignature([baseMessageWithMoreReasoning])
    expect(sig2).toBe('msg-think-1:0:44::')
    expect(sig2).not.toBe(sig1)
  })

  it('detects stream completion turnEnd state', () => {
    const streamingMessage: ChatMessage = {
      id: 'msg-final-1',
      sessionId: 'session-1',
      createdAt: 1000,
      kind: 'message',
      role: 'assistant',
      text: 'Complete answer.',
      images: [],
    }
    const sigStreaming = computeStreamingSignature([streamingMessage])

    const finishedMessage: ChatMessage = {
      ...streamingMessage,
      turnEnd: { reason: 'completed', time: 2000 },
    }
    const sigFinished = computeStreamingSignature([finishedMessage])

    expect(sigFinished).toBe('msg-final-1:16:0:completed:')
    expect(sigFinished).not.toBe(sigStreaming)
  })

  it('ignores deltas that happen only on earlier messages', () => {
    const earlierMessage: ChatMessage = {
      id: 'msg-user-1',
      sessionId: 'session-1',
      createdAt: 1000,
      kind: 'message',
      role: 'user',
      text: 'Original prompt',
      images: [],
    }
    const assistantMessage: ChatMessage = {
      id: 'msg-asst-1',
      sessionId: 'session-1',
      createdAt: 1001,
      kind: 'message',
      role: 'assistant',
      text: 'Working...',
      images: [],
    }

    const sig1 = computeStreamingSignature([earlierMessage, assistantMessage])

    const updatedEarlierMessage: ChatMessage = {
      ...earlierMessage,
      text: 'Original prompt edited',
    }
    const sig2 = computeStreamingSignature([updatedEarlierMessage, assistantMessage])

    // Signature of latest message does not change if earlier messages change
    expect(sig2).toBe(sig1)
  })

  it('shares LATEST_EDGE_PX threshold (80px) for pin-to-bottom and smart scroll', () => {
    expect(LATEST_EDGE_PX).toBe(80)

    const isAtBottom = (distanceFromEnd: number) => distanceFromEnd <= LATEST_EDGE_PX

    expect(isAtBottom(0)).toBe(true)
    expect(isAtBottom(40)).toBe(true)
    expect(isAtBottom(80)).toBe(true)
    expect(isAtBottom(81)).toBe(false)
    expect(isAtBottom(500)).toBe(false)
  })
})
