import type { HarnessAlphaClient } from '@dsh-remote/client-core'
import type { RemoteApiProxy } from './api-proxy'
import type { ChatMessage } from '../types'

type ActionClient = RemoteApiProxy | HarnessAlphaClient

/** Exact cut only, never silently fork the latest state or fabricate a local session. */
export async function forkMessage(message: ChatMessage, proxy: ActionClient) {
  if (message.streaming || !Number.isSafeInteger(message.nativeSeq) || message.nativeSeq! < 0) {
    throw Object.assign(new Error('This message has no durable fork boundary.'), { code: 'UNSUPPORTED' })
  }
  const { sessionId } = await proxy.sessionFork(message.sessionId, message.nativeSeq!)
  const [sessions, workspaceList] = await Promise.all([proxy.sessionList(), proxy.workspaceList()])
  const session = sessions.find(item => item.sessionId === sessionId)
  if (session === undefined) throw Object.assign(new Error('The Host did not confirm the forked session.'), { code: 'INVALID_MESSAGE' })
  return { session, sessions, workspaces: workspaceList.items }
}
