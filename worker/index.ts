import { Hono } from 'hono'

type Bindings = {
  LOCAL_DEBUG: boolean
}

const app = new Hono<{ Bindings: Bindings }>()

app.all('/api/*', async (c) => {
  // TODO: implement some apis
  return c.json({}, 404)
})

export default app
