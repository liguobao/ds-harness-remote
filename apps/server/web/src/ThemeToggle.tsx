// Adapted from upstream components/ThemeToggle.tsx; only locale lookup is removed.
import { MoonOutlined, SunOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { useColorTheme } from './theme'
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { colorTheme, toggleColorTheme } = useColorTheme()
  const nextTheme = colorTheme === 'light' ? 'dark' : 'light'
  const label = nextTheme === 'dark' ? '切换到深色模式' : '切换到浅色模式'
  return <Button type="text" className={`theme-toggle ${className}`} icon={nextTheme === 'dark' ? <MoonOutlined /> : <SunOutlined />} aria-label={label} title={label} onClick={toggleColorTheme} />
}
