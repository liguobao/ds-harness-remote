// Simplified upstream HostsPage + product AppHeader. No remote/open/admin actions.
import { Alert, Button, Card, Empty, Layout, Space, Table, Tag, Typography } from 'antd'
import { GithubOutlined } from '@ant-design/icons'
import type { TableColumnsType } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { api, RequestError, type Device, type DeviceList } from './api'
import { ThemeToggle } from './ThemeToggle'
import { SiteFooter } from './SiteFooter'
const { Paragraph, Text, Title } = Typography
export function DevicesPage({ account, onSignedOut }: { account: string; onSignedOut: () => void }) {
  const [result, setResult] = useState<DeviceList>()
  const [loading, setLoading] = useState(true)
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState('')
  const [updated, setUpdated] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { const data = await api<DeviceList>('/account/devices'); setResult(data); setUpdated(new Date().toLocaleTimeString('zh-CN')) }
    catch (err) { if (err instanceof RequestError && err.status === 401) onSignedOut(); else setError(err instanceof Error ? err.message : '加载失败，请重试。') }
    finally { setLoading(false) }
  }, [onSignedOut])
  useEffect(() => { void load() }, [load])
  async function logout() {
    setLoggingOut(true)
    try { await api('/auth/logout', {}); onSignedOut() }
    catch (err) { setError(err instanceof Error ? err.message : '退出失败，请重试。') }
    finally { setLoggingOut(false) }
  }
  const devices = [...(result?.items ?? [])].sort((a, b) => Number(b.online) - Number(a.online))
  const columns: TableColumnsType<Device> = [
    { title: '设备名称', dataIndex: 'name', key: 'name', render: (name: string, d) => <Space size={10}><span className={`host-status-dot ${d.online ? 'is-online' : ''}`} /><Text strong className="selfhost-device-name">{name}</Text></Space> },
    { title: '状态', dataIndex: 'online', key: 'online', render: (online: boolean) => online ? <Tag color="green">在线</Tag> : <Tag>离线</Tag> },
    { title: '角色', dataIndex: 'role', key: 'role', render: (role: string) => role === 'host' ? 'Host' : '客户端' },
    { title: '系统', dataIndex: 'platform', key: 'platform', render: (platform: string) => ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux', android: 'Android' })[platform] ?? platform },
    { title: '插件版本', dataIndex: 'clientVersion', key: 'clientVersion' },
    { title: 'Harness 版本', dataIndex: 'harnessVersion', key: 'harnessVersion', render: (value?: string) => value || '—' },
  ]
  return <>
    <Layout.Header className="topbar product-topbar"><div className="topbar-inner"><div className="topbar-brand-group is-product"><a className="topbar-brand" href="/" aria-label="返回首页"><img className="topbar-brand-mark" src="/brand-whale.webp" alt="" width="40" height="40" /><span className="topbar-brand-copy"><Title level={3}>DeepSeek Harness Remote</Title><small>安全远程访问</small></span></a></div><div className="topbar-actions"><a className="topbar-github-link product-github-link" href="https://github.com/liguobao/dsh-harness-remote" target="_blank" rel="noreferrer" aria-label="GitHub"><GithubOutlined /> GitHub</a><ThemeToggle /><Button type="text" loading={loggingOut} onClick={() => void logout()}>退出登录</Button></div></div></Layout.Header>
    <Layout.Content className="product-content selfhost-content" id="main-content">
      <div className="app-area"><div className="workspace-view"><div className="hosts-page">
        <header className="workspace-page-header"><div><Title level={2}>我的设备</Title><Paragraph className="selfhost-account">{account}</Paragraph></div><Space className="workspace-page-actions" wrap><Button onClick={() => void load()} loading={loading}>刷新</Button></Space></header>
        {error && <Alert className="selfhost-error" type="error" showIcon message={error} />}
        <Card className="page-card selfhost-connection" title="服务地址"><Paragraph><Text code className="selfhost-address">{result?.serverUrl ?? '加载中…'}</Text></Paragraph><Paragraph>Host 和客户端使用此地址。</Paragraph></Card>
        <Card className="page-card hosts-list-card" title="设备状态" extra={result ? <Text type="secondary">{devices.filter(d => d.online).length} / {devices.length} 台在线</Text> : undefined}>
          {!error && !loading && !devices.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无设备" /> : <Table<Device> rowKey="deviceId" columns={columns} dataSource={devices} loading={loading} pagination={false} scroll={{ x: 'max-content' }} />}
        </Card>
        {updated && <Paragraph className="selfhost-caption" type="secondary">更新于 {updated}</Paragraph>}
      </div></div></div>
    </Layout.Content><SiteFooter />
  </>
}
