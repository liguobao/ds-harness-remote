import { AppleOutlined, HistoryOutlined, LinkOutlined, MobileOutlined } from '@ant-design/icons'

const REPOSITORY = 'https://github.com/liguobao/ds-harness-remote'
const IOS_BETA_URL = 'https://github.com/liguobao/ds-harness-remote/issues/20'
const CHANGELOG_URL = `${REPOSITORY}/blob/main/docs/CHANGELOG.md`
const DOWNLOAD_URL = `${REPOSITORY}/releases/latest`

export function SiteFooter() {
  return <footer className="site-footer app-footer">
    <span>© DSH Remote</span>
    <div className="site-footer-links">
      <a href="/" className="site-footer-link" aria-label="返回首页"><LinkOutlined aria-hidden="true" /><span>返回首页</span></a>
      <a href={CHANGELOG_URL} target="_blank" rel="noreferrer" className="site-footer-link" aria-label="更新日志"><HistoryOutlined aria-hidden="true" /><span>更新日志</span></a>
      <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer" className="site-footer-link" aria-label="移动端"><MobileOutlined aria-hidden="true" /><span>移动端</span></a>
      <a href={IOS_BETA_URL} target="_blank" rel="noreferrer" className="site-footer-link" aria-label="iOS 内测"><AppleOutlined aria-hidden="true" /><span>iOS 内测</span></a>
    </div>
    <a className="site-footer-credit" href="https://www.zhihu.com/people/codelover" target="_blank" rel="noreferrer">Power By 知乎@李国宝</a>
  </footer>
}
