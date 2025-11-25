import { Hono } from 'hono'
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

app.get('/api/nslookup', async (c) => {
  const target = c.req.queries('host')
  if (!target?.length) {
    return c.text('invalid request', 400)
  }
  const headers = c.req.header()
  headers['Host'] = '223.5.5.5'
  return fetch(`https://223.5.5.5/resolve?name=${target}`, {
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

app.get('/ttyd/:ttydUrl/:uri', async (c) => {
  const url = c.req.param('ttydUrl')
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
