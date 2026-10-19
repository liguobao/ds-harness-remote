import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const mode = args[1]
const network = args.filter(arg => /^--(?:hostname|port|mdns|no-mdns)(?:=|$)/.test(arg))
if (args.includes('--help')) {
  if (network.length) throw new Error('Probe received unsupported network flags')
  if (mode === 'probe-close') {
    writeFileSync('probe-pid', String(process.pid))
    setInterval(() => {}, 1000)
  } else if (mode === 'probe-failure') {
    console.error('private CLI configuration must not escape')
    process.exitCode = 2
  } else if (mode === 'probe-overflow') {
    console.log('x'.repeat(128 * 1024))
  } else if (mode === 'probe-invalid') {
    console.log('unexpected output')
  } else {
    const help = mode === 'legacy'
      ? '\x1b[1mopencode acp\x1b[0m\nOptions:\n  -h, --help  Show help\n      --hostname  Bind host\n      --port  Bind port\n      --mdns  Enable discovery\n'
      : 'DESCRIPTION\n  Start an Agent Client Protocol server\n\nUSAGE\n  opencode acp [flags]\n\nFLAGS\n  --login    Run auth login instead of starting the server\n'
        + (mode === 'probe-partial' ? '  --port  Bind port\n' : '')
        + '\nGLOBAL FLAGS\n  --help, -h  Show help information\n  --version, -v  Show version information\n'
    // Help may be printed to either stream; ACP traffic must only use stdout.
    process.stderr.write(help)
  }
} else {
  writeFileSync('acp-started', 'yes')
  let archived = false
  if (mode === 'legacy') {
    if (network.length !== 3 || !network.includes('--hostname=127.0.0.1') || !network.includes('--mdns=false')) throw new Error('Listener is not private')
    if (process.env.OPENCODE_SERVER_USERNAME !== 'opencode' || !/^[a-f0-9]{64}$/.test(process.env.OPENCODE_SERVER_PASSWORD ?? '')) throw new Error('Missing per-process authentication')
    const authorization = `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`
    const server = createServer(async (request, response) => {
      if (request.headers.authorization !== authorization) { response.writeHead(401).end(); return }
      const url = new URL(request.url, 'http://127.0.0.1')
      if (url.pathname !== '/session/saved' || url.searchParams.get('directory') !== process.cwd()) { response.writeHead(404).end(); return }
      if (request.method === 'PATCH') {
        let body = ''
        for await (const chunk of request) body += chunk
        archived = typeof JSON.parse(body).time?.archived === 'number'
      }
      response.end(JSON.stringify({ id: 'saved', directory: process.cwd(), time: archived ? { archived: 123 } : {} }))
    })
    await new Promise(resolve => server.listen(Number(network.find(arg => arg.startsWith('--port=')).slice(7)), '127.0.0.1', resolve))
  } else if (network.length) throw new Error('Unrecognized network flag')
  for await (const line of createInterface({ input: process.stdin })) {
    const message = JSON.parse(line)
    const result = message.method === 'initialize' ? { protocolVersion: 1 }
      : message.method === 'session/list' ? { sessions: [{ sessionId: 'saved', cwd: process.cwd() }] }
        : message.method === 'session/prompt' ? { stopReason: 'end_turn' } : { sessionId: 'saved' }
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
  }
}
