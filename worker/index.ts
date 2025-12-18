import { Hono } from 'hono'
import { connect } from 'cloudflare:sockets'
import { Hbbs as Hbbs_, Hbbr as Hbbr_ } from './hbbs'

export class Hbbs extends Hbbs_ { }
export class Hbbr extends Hbbr_ { }

type Bindings = {
  HBBS: DurableObjectNamespace<Hbbs>
  HBBR: DurableObjectNamespace<Hbbr>
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/ws/id', async (c) => {
  const hbbsId = c.env.HBBS.idFromName('hbbs')
  const hbbsObj = c.env.HBBS.get(hbbsId)
  return hbbsObj.fetch(c.req.raw)
})

app.get('/ws/relay/:session', async (c) => {
  const session = c.req.param('session')
  if (!session?.length) {
    return c.text('invalid request', 400)
  }
  const hbbrId = c.env.HBBR.idFromString(session)
  const hbbrObj = c.env.HBBR.get(hbbrId)
  return hbbrObj.fetch(c.req.raw)
})

app.get('/api/connect', async (c) => {
  const upgradeHeader = c.req.header('Upgrade')
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return c.text('invalid request', 400)
  }
  const urlParam = c.req.query('url')
  if (!urlParam) {
    return c.text('Missing url', 400)
  }
  let host: string
  let port: number
  try {
    const target = urlParam.includes('://') ? urlParam : `tcp://${urlParam}`
    const url = new URL(target)
    host = url.hostname
    port = parseInt(url.port)
    if (isNaN(port)) throw new Error('Invalid port')
  } catch {
    return c.text('Invalid target url', 400)
  }

  const webSocketPair = new WebSocketPair()
  const [client, server] = Object.values(webSocketPair)

  server.accept()

  try {
    const socket = connect({ hostname: host, port })
    const writer = socket.writable.getWriter()

    server.addEventListener('message', async (event) => {
      try {
        if (typeof event.data === 'string') {
          await writer.write(new TextEncoder().encode(event.data))
        } else {
          await writer.write(event.data as Uint8Array)
        }
      } catch (error) {
        console.error('Error writing to TCP socket:', error)
        server.close()
      }
    })

    server.addEventListener('close', () => {
      try {
        socket.close()
      } catch {
        // ignore
      }
    })

    const reader = socket.readable.getReader()
    ;(async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          server.send(value)
        }
      } catch (error) {
        console.error('Error reading from TCP socket:', error)
      } finally {
        server.close()
        try { socket.close() } catch { /* ignore */ }
      }
    })()

  } catch (error) {
    console.error('Connect error:', error)
    server.close(1011, 'Failed to connect')
  }

  return new Response(null, {
    status: 101,
    webSocket: client,
  })
})

app.get('/api/resolve', async (c) => {
  const target = c.req.queries('name')?.at(0)
  if (!target?.length) {
    return c.text('invalid request', 400)
  }
  const server = c.req.queries('server')?.at(0) || '223.5.5.5'
  if (!target?.length) {
    return c.text('invalid request', 400)
  }
  const headers = c.req.header()
  headers['Host'] = server
  return fetch(`https://${server}/resolve?name=${target}`, {
    headers: headers
  })
})

app.get('/api/curl', async (c) => {
  let target = c.req.queries('url')?.at(0)
  const method = c.req.queries('method')?.at(0)
  if (!target?.length) {
    return c.text('invalid url', 400)
  }
  if (!target.includes('://')) {
    target = 'http://' + target
  }
  if (!/^https?:\/\//.test(target)) {
    return c.text('invalid url', 400)
  }
  const url = new URL(target)
  console.log(`curl ${method || 'GET'} ${url.href}`)
  return fetch(url, { method: method || 'GET' })
})

app.all('/api/*', async (c) => {
  // TODO: implement some apis
  return c.json({}, 404)
})

app.get('/ttyd/:host/:uri', async (c) => {
  const url = c.req.param('host')
  if (!url?.length) {
    return c.text('invalid request', 400)
  }
  const uri = c.req.param('uri')
  if (!['token', 'ws'].includes(uri)) {
    return c.text('invalid request', 400)
  }
  return fetch(url + `/${uri}`, {
    headers: c.req.raw.headers
  })
})

export default app
