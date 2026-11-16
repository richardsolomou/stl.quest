import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { smtpDelivery } from './email'

const servers: net.Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

const message = { to: 'to@example.com', subject: 'Hello', text: 'Hi' }

/** Greets, then answers every command one byte at a time, so no single wait on the server ever times out. */
async function tricklingServer() {
  const closed: Promise<void>[] = []
  const server = net.createServer((socket) => {
    closed.push(new Promise((resolve) => socket.once('close', () => resolve())))
    socket.on('error', () => undefined)
    socket.write('220 smtp.test ESMTP\r\n')
    socket.once('data', () => {
      const timer = setInterval(() => socket.write('2'), 20)
      socket.once('close', () => clearInterval(timer))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { port: (server.address() as AddressInfo).port, closed }
}

/** Greets like a normal server and records whether the client ever said anything back. */
async function listeningServer() {
  let received = false
  const server = net.createServer((socket) => {
    socket.on('error', () => undefined)
    socket.on('data', () => (received = true))
    socket.write('220 smtp.test ESMTP\r\n')
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { port: (server.address() as AddressInfo).port, received: () => received }
}

describe('SMTP deadline', () => {
  it('closes the connection when the deadline passes', async () => {
    const server = await tricklingServer()
    const delivery = smtpDelivery({ from: 'from@example.com', host: '127.0.0.1', port: server.port, secure: false, timeoutMs: 200 })
    await expect(delivery.send(message)).rejects.toThrow('did not finish within 200 ms')
    const closedSoon = await Promise.race([
      Promise.all(server.closed).then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 500)),
    ])
    expect(closedSoon).toBe(true)
  })

  it('stops an exchange the deadline beats to connecting', async () => {
    const server = await listeningServer()
    const delivery = smtpDelivery({ from: 'from@example.com', host: '127.0.0.1', port: server.port, secure: false, timeoutMs: 5 })
    const sending = delivery.send(message)
    // Holding the event loop past the deadline lets it fire before nodemailer connects.
    const until = Date.now() + 30
    while (Date.now() < until);
    await expect(sending).rejects.toThrow('did not finish within 5 ms')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(server.received()).toBe(false)
  })
})
