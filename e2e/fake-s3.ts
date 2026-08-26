import http from 'node:http'

const port = Number(process.env.FAKE_S3_PORT)
const objects = new Map<string, Buffer>()

http
  .createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
    const key = decodeURIComponent(url.pathname.replace(/^\/[^/]+\/?/, ''))
    if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? ''
      const contents = [...objects.entries()]
        .filter(([name]) => name.startsWith(prefix))
        .map(([name, bytes]) => `<Contents><Key>${escapeXml(name)}</Key><Size>${bytes.byteLength}</Size></Contents>`)
        .join('')
      response.setHeader('content-type', 'application/xml')
      response.end(`<ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`)
      return
    }
    // Bulk delete, which is how AssetStore.clear() removes a prefix.
    if (request.method === 'POST' && url.searchParams.has('delete')) {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const keys = [
        ...Buffer.concat(chunks)
          .toString()
          .matchAll(/<Key>([\s\S]*?)<\/Key>/g),
      ].map(([, name]) => unescapeXml(name))
      for (const name of keys) objects.delete(name)
      response.setHeader('content-type', 'application/xml')
      response.end(`<DeleteResult>${keys.map((name) => `<Deleted><Key>${escapeXml(name)}</Key></Deleted>`).join('')}</DeleteResult>`)
      return
    }
    if (request.method === 'PUT') {
      const copySource = request.headers['x-amz-copy-source']
      if (copySource) {
        const source = decodeURIComponent(String(copySource)).replace(/^\/?[^/]+\//, '')
        const bytes = objects.get(source)
        if (!bytes) return void response.writeHead(404).end()
        objects.set(key, bytes)
        response.setHeader('content-type', 'application/xml')
        response.end('<CopyObjectResult><ETag>"test"</ETag></CopyObjectResult>')
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      objects.set(key, request.headers['content-encoding']?.includes('aws-chunked') ? decodeAwsChunked(body) : body)
      response.end()
      return
    }
    if (request.method === 'HEAD') {
      if (!key) return void response.end()
      const bytes = objects.get(key)
      if (!bytes) return void response.writeHead(404).end()
      response.setHeader('content-length', bytes.byteLength)
      response.end()
      return
    }
    if (request.method === 'GET') {
      const bytes = objects.get(key)
      if (!bytes) return void response.writeHead(key ? 404 : 200).end()
      response.setHeader('content-length', bytes.byteLength)
      response.end(bytes)
      return
    }
    if (request.method === 'DELETE') {
      objects.delete(key)
      response.end()
      return
    }
    response.writeHead(405).end()
  })
  .listen(port, process.env.FAKE_S3_HOST ?? '127.0.0.1')

function escapeXml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function unescapeXml(value: string) {
  return value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}

function decodeAwsChunked(body: Buffer) {
  const chunks: Buffer[] = []
  let offset = 0
  while (offset < body.length) {
    const lineEnd = body.indexOf('\r\n', offset)
    if (lineEnd < 0) throw new Error('invalid aws-chunked body')
    const size = Number.parseInt(body.subarray(offset, lineEnd).toString().split(';', 1)[0], 16)
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('invalid aws-chunked size')
    offset = lineEnd + 2
    if (size === 0) return Buffer.concat(chunks)
    const end = offset + size
    if (end + 2 > body.length || body.subarray(end, end + 2).toString() !== '\r\n') throw new Error('invalid aws-chunked data')
    chunks.push(body.subarray(offset, end))
    offset = end + 2
  }
  throw new Error('incomplete aws-chunked body')
}
