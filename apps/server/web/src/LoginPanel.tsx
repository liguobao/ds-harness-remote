// Password-only subset of upstream components/LoginPanel.tsx; keep its layout/classes.
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import { GithubOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { api, type Account } from './api'
import { ThemeToggle } from './ThemeToggle'
import { SiteFooter } from './SiteFooter'
export function LoginPanel({ onAuthSuccess, initialError }: { onAuthSuccess: (account: Account) => void; initialError?: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(initialError ?? '')
  const [form] = Form.useForm<{ email: string; password: string }>()
  async function submit(values: { email: string; password: string }) {
    setLoading(true); setError('')
    try {
      const result = await api<Account>('/auth/login', { email: values.email.trim(), password: values.password })
      form.resetFields(['password']); onAuthSuccess(result)
    } catch (err) { setError(err instanceof Error ? err.message : '登录失败，请重试。') }
    finally { setLoading(false) }
  }
  return <><main className="auth-page">
    <div className="auth-language-menu"><a className="auth-github-link" href="https://github.com/liguobao/dsh-harness-remote" target="_blank" rel="noreferrer"><GithubOutlined /> GitHub</a><ThemeToggle className="auth-theme-toggle" /></div>
    <section className="auth-content">
      <div className="auth-logo-stack"><a className="auth-home-link" href="/" aria-label="返回首页"><img className="auth-brand-icon" src="/brand-whale.webp" alt="" width="48" height="48" /><Typography.Title>DeepSeek Harness Remote</Typography.Title></a></div>
      <Card className="auth-panel">
        <div className="auth-intro"><Typography.Title level={3} className="auth-title">登录</Typography.Title></div>
        {error && <Alert className="selfhost-auth-error" type="error" showIcon message={error} />}
        <Form form={form} layout="vertical" onFinish={submit} requiredMark={false} className="auth-form">
          <Form.Item name="email" label="账号" rules={[{ required: true, whitespace: true, message: '请输入账号' }, { max: 254, message: '账号不能超过 254 个字符' }]}><Input size="large" placeholder="请输入账号" autoComplete="username" /></Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }, { max: 1024, message: '密码不能超过 1024 个字符' }]}><Input.Password size="large" placeholder="请输入密码" autoComplete="current-password" /></Form.Item>
          <Form.Item className="auth-submit-item"><Button loading={loading} block type="primary" size="large" htmlType="submit">登录</Button></Form.Item>
        </Form>
      </Card>
    </section>
  </main><SiteFooter /></>
}
