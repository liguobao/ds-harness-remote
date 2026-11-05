import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfigProvider, Layout, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { ThemeProvider, useColorTheme } from './theme'
import { LoginPanel } from './LoginPanel'
import { DevicesPage } from './DevicesPage'
import { HomePage } from './HomePage'
import { api, RequestError, type Account } from './api'
import 'antd/dist/reset.css'
import './upstream.css'
import './selfhost.css'

export function navigate(path: string) {
  if (window.location.pathname !== path) window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function App() {
  const { colorTheme } = useColorTheme()
  const dark = colorTheme === 'dark'
  const [account, setAccount] = useState<Account | null>()
  const [error, setError] = useState<string>()
  const [path, setPath] = useState(() => window.location.pathname)
  // Keep route state and URL in sync without dispatching popstate: dispatching synchronously makes
  // React commit the route change separately, so an auth transition can render an intermediate
  // unauthenticated route and the guard below bounces /app/remote back to /app/login.
  const justLoggedIn = useRef(false)
  const go = useCallback((next: string) => {
    if (window.location.pathname !== next) window.history.pushState({}, '', next)
    setPath(next)
  }, [])
  const signedOut = useCallback(() => { setAccount(null); go('/') }, [go])
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  useEffect(() => {
    api<Account>('/auth/me').then(setAccount).catch(err => {
      if (!(err instanceof RequestError && err.status === 401)) setError(err instanceof Error ? err.message : '无法连接服务。')
      setAccount(null)
    })
  }, [])
  // These Ant Design tokens are retained from the upstream App.tsx ConfigProvider.
  useEffect(() => {
    if (justLoggedIn.current) { justLoggedIn.current = false; return }
    if (account === null && path === '/app/remote') go('/app/login')
  }, [account, path, go])
  const login = useCallback((next: Account) => { justLoggedIn.current = true; setAccount(next); go('/app/remote') }, [go])
  const content = account === undefined
    ? <div className="route-loading auth-route-loading" role="status">正在检查登录状态…</div>
    : path === '/app/remote' && account
      ? <DevicesPage account={account.account} onSignedOut={signedOut} />
      : path === '/app/login'
        ? <LoginPanel onAuthSuccess={login} initialError={error} />
        : <HomePage />
  return <ConfigProvider locale={zhCN} theme={{
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: '#1677ff', colorInfo: '#1677ff', colorSuccess: dark ? '#49aa68' : '#16a34a', colorWarning: dark ? '#d89614' : '#d97706', colorError: dark ? '#ff7875' : '#cf222e',
      colorBgLayout: dark ? '#111318' : '#f5f5f7', colorBgContainer: dark ? '#181b22' : '#ffffff', colorBgElevated: dark ? '#20242c' : '#ffffff', colorText: dark ? '#f2f3f5' : '#1d1d1f', colorTextSecondary: dark ? '#b7bcc7' : '#6e6e73', colorTextPlaceholder: dark ? '#8d94a3' : '#6e6e73', colorBorder: dark ? '#3a404c' : '#d9e2ec', colorBorderSecondary: dark ? '#2d323c' : '#e8e8ed', borderRadius: 6, borderRadiusLG: 8, controlHeight: 40, fontSize: 15, wireframe: false,
    }, components: { Button: { primaryShadow: 'none' }, Table: { headerBg: dark ? '#20242c' : '#f7f7f8', headerColor: dark ? '#c8cdd6' : '#4b5563' } },
  }}><Layout className={account && path === '/app/remote' ? 'app-shell product-shell' : 'app-shell auth-shell'}>
    {content}
  </Layout></ConfigProvider>
}
createRoot(document.getElementById('root')!).render(<ThemeProvider><App /></ThemeProvider>)
