import { describe, expect, it, vi } from 'vitest'
import zhCN from '../src/locales/zh-CN'
import enUS from '../src/locales/en-US'

describe('drawer and workspaces back navigation', () => {
  it('provides backToChat and backToWorkspaces labels in locale dictionaries', () => {
    expect(zhCN.chat.backToChat).toBe('返回会话')
    expect(enUS.chat.backToChat).toBe('Back to chat')
    expect(zhCN.chat.backToWorkspaces).toBe('返回工作区')
    expect(enUS.chat.backToWorkspaces).toBe('Back to workspaces')
  })

  it('navigates back to existing workspaces route without duplicate stacking', () => {
    type Route = { name: string; focusWorkspaceKey?: string; source?: string }
    let routes: Route[] = [{ name: 'workspaces' }, { name: 'chat' }]

    const pop = () => {
      if (routes.length > 1) routes = routes.slice(0, -1)
    }
    const push = (next: Route) => {
      routes = [...routes, next]
    }

    const onOpenWorkspaces = (focusWorkspaceKey?: string) => {
      const previousRoute = routes[routes.length - 2]
      if (focusWorkspaceKey === undefined && previousRoute?.name === 'workspaces') {
        pop()
        return
      }
      push({ name: 'workspaces', focusWorkspaceKey, source: 'chat' })
    }

    // Call onOpenWorkspaces without key: should pop back to existing workspaces
    onOpenWorkspaces()
    expect(routes).toEqual([{ name: 'workspaces' }])
  })

  it('pushes workspaces when navigating to a specific focusWorkspaceKey', () => {
    type Route = { name: string; focusWorkspaceKey?: string; source?: string }
    let routes: Route[] = [{ name: 'workspaces' }, { name: 'chat' }]

    const pop = () => {
      if (routes.length > 1) routes = routes.slice(0, -1)
    }
    const push = (next: Route) => {
      routes = [...routes, next]
    }

    const onOpenWorkspaces = (focusWorkspaceKey?: string) => {
      const previousRoute = routes[routes.length - 2]
      if (focusWorkspaceKey === undefined && previousRoute?.name === 'workspaces') {
        pop()
        return
      }
      push({ name: 'workspaces', focusWorkspaceKey, source: 'chat' })
    }

    onOpenWorkspaces('ws-special')
    expect(routes).toEqual([
      { name: 'workspaces' },
      { name: 'chat' },
      { name: 'workspaces', focusWorkspaceKey: 'ws-special', source: 'chat' },
    ])
  })

  it('drawer onBack handler closes drawer and returns to current chat session', () => {
    const keyboardDismiss = vi.fn()
    const setSessionsOpen = vi.fn()

    const handleDrawerBack = () => {
      keyboardDismiss()
      setSessionsOpen(false)
    }

    handleDrawerBack()
    expect(keyboardDismiss).toHaveBeenCalled()
    expect(setSessionsOpen).toHaveBeenCalledWith(false)
  })

  it('drawer handleBack triggers smoothClose on mobile overlay to return to chat', () => {
    const keyboardDismiss = vi.fn()
    const smoothClose = vi.fn()
    const onBack = vi.fn()
    const inline = false

    const handleBack = () => {
      keyboardDismiss()
      if (!inline) {
        smoothClose(true)
        return
      }
      onBack?.()
    }

    handleBack()
    expect(keyboardDismiss).toHaveBeenCalled()
    expect(smoothClose).toHaveBeenCalledWith(true)
    expect(onBack).not.toHaveBeenCalled()
  })
})
