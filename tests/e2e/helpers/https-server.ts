import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import forge from 'node-forge'

export const TEST_USER = '52998224725'
export const TEST_PASSWORD = 'SenhaE2E!2026'

export interface TestPortalServer {
  url: string
  baseUrl: string
  requests: Array<{ method: string; path: string }>
  close: () => Promise<void>
}

const CERT_DIR = path.join(__dirname, '..', '.certs')

function ensureCertificate(): { key: string; cert: string } {
  mkdirSync(CERT_DIR, { recursive: true })
  const keyPath = path.join(CERT_DIR, 'server-key.pem')
  const certPath = path.join(CERT_DIR, 'server-cert.pem')
  if (existsSync(keyPath) && existsSync(certPath)) {
    return { key: readFileSync(keyPath, 'utf8'), cert: readFileSync(certPath, 'utf8') }
  }

  const keys = forge.pki.rsa.generateKeyPair(2048)
  const certificate = forge.pki.createCertificate()
  certificate.publicKey = keys.publicKey
  certificate.serialNumber = '01E2E'
  certificate.validity.notBefore = new Date('2024-01-01T00:00:00.000Z')
  certificate.validity.notAfter = new Date('2035-01-01T00:00:00.000Z')
  const subject = [
    { name: 'commonName', value: '127.0.0.1' },
    { name: 'organizationName', value: 'AurumBit Portal E2E' },
  ]
  certificate.setSubject(subject)
  certificate.setIssuer(subject)
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] },
  ])
  certificate.sign(keys.privateKey, forge.md.sha256.create())

  const key = forge.pki.privateKeyToPem(keys.privateKey)
  const cert = forge.pki.certificateToPem(certificate)
  writeFileSync(keyPath, key)
  writeFileSync(certPath, cert)
  return { key, cert }
}

function loginPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head><meta charset="utf-8"><title>Portal E2E - Entrar</title></head>
  <body>
    <h1>Portal E2E</h1>
    <form id="login-form" method="post" action="/login">
      <label for="user">Usuario</label>
      <input id="user" name="username" autocomplete="username">
      <label for="pass">Senha</label>
      <input id="pass" name="password" type="password" autocomplete="current-password">
      <button id="entrar" type="submit">Entrar</button>
    </form>
  </body>
</html>`
}

function panelPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head><meta charset="utf-8"><title>Portal E2E - Painel</title></head>
  <body>
    <h1>Painel E2E</h1>
    <p id="welcome">Bem-vindo</p>
    <button id="sair" type="button">Sair</button>
  </body>
</html>`
}

function wizardLoginPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head><meta charset="utf-8"><title>Portal Gravação - Entrar</title></head>
  <body>
    <h1>Portal Gravação</h1>
    <div id="wizard-spinner" class="loading">Carregando…</div>
    <form id="wizard-form" method="post" action="/wizard-login">
      <label for="wuser">Usuario</label>
      <input id="wuser" name="username" autocomplete="username">
      <label for="wpass">Senha</label>
      <input id="wpass" name="password" type="password" autocomplete="current-password">
      <button id="entrar" type="submit">Entrar</button>
    </form>
    <script>
      // SPA legítimo (fetch + pushState): o login não derruba o frame. Um
      // submit de frame destruiria o contexto JS (e o recorder/drains junto)
      // antes de o clique ser drenado — o mesmo vale para o runner de receita.
      document.getElementById('wizard-form').addEventListener('submit', function (event) {
        event.preventDefault();
        var form = event.target;
        var body = new URLSearchParams(new FormData(form)).toString();
        fetch('/wizard-login', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: body,
          credentials: 'same-origin',
        }).then(function (response) {
          return response.text().then(function (html) {
            var ok = response.url.indexOf('/wizard-painel') !== -1;
            document.body.innerHTML = html;
            if (ok) history.pushState({}, '', '/wizard-painel');
          });
        });
      });
      // Spinner falso: some após 1,2 s (simula portal lento); sem fetch externo.
      setTimeout(function () {
        var spinner = document.getElementById('wizard-spinner')
        if (spinner) spinner.style.display = 'none'
      }, 1200)
    </script>
  </body>
</html>`
}

function wizardPainelPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head><meta charset="utf-8"><title>Portal Gravação - Painel</title></head>
  <body>
    <h1>Painel Gravação</h1>
    <p id="welcome">Bem-vindo</p>
    <button id="sair" type="button">Sair</button>
  </body>
</html>`
}

function wizardBrokenPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head><meta charset="utf-8"><title>Portal Gravação - Indisponivel</title></head>
  <body>
    <h1>Portal Gravação</h1>
    <div class="loading">Carregando…</div>
  </body>
</html>`
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

export async function startTestPortal(): Promise<TestPortalServer> {
  const { key, cert } = ensureCertificate()
  const requests: Array<{ method: string; path: string }> = []
  const server = https.createServer({ key, cert }, (request: IncomingMessage, response) => {
    const method = request.method ?? 'GET'
    const pathname = new URL(request.url ?? '/', 'https://127.0.0.1').pathname
    requests.push({ method, path: pathname })

    if (method === 'GET' && (pathname === '/' || pathname === '/login')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(loginPage())
      return
    }

    if (method === 'POST' && pathname === '/login') {
      void readBody(request).then((body) => {
        const form = new URLSearchParams(body)
        const valid = form.get('username') === TEST_USER && form.get('password') === TEST_PASSWORD
        if (!valid) {
          response.writeHead(401, { 'content-type': 'text/html; charset=utf-8' })
          response.end('<h1>Credenciais invalidas</h1>')
          return
        }
        response.writeHead(302, {
          'set-cookie': 'pv_e2e=ok; Path=/; HttpOnly; SameSite=Lax',
          location: '/painel',
        })
        response.end()
      })
      return
    }

    if (method === 'GET' && pathname === '/painel') {
      const authenticated = (request.headers.cookie ?? '').includes('pv_e2e=ok')
      if (!authenticated) {
        response.writeHead(403, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<h1>Acesso negado</h1>')
        return
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(panelPage())
      return
    }

    if (method === 'GET' && pathname === '/whoami') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(
        JSON.stringify({
          cookie: request.headers.cookie ?? null,
          userAgent: request.headers['user-agent'] ?? null,
        }),
      )
      return
    }

    if (method === 'GET' && pathname === '/wizard-login') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(wizardLoginPage())
      return
    }

    if (method === 'POST' && pathname === '/wizard-login') {
      void readBody(request).then((body) => {
        const form = new URLSearchParams(body)
        const valid = form.get('username') === TEST_USER && form.get('password') === TEST_PASSWORD
        if (!valid) {
          response.writeHead(401, { 'content-type': 'text/html; charset=utf-8' })
          response.end('<h1>Credenciais invalidas</h1>')
          return
        }
        response.writeHead(302, {
          'set-cookie': 'pv_wizard_e2e=ok; Path=/; HttpOnly; SameSite=Lax',
          location: '/wizard-painel',
        })
        response.end()
      })
      return
    }

    if (method === 'GET' && pathname === '/wizard-painel') {
      const authenticated = (request.headers.cookie ?? '').includes('pv_wizard_e2e=ok')
      if (!authenticated) {
        response.writeHead(302, { location: '/wizard-login' })
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(wizardPainelPage())
      return
    }

    if (method === 'GET' && pathname === '/wizard-broken') {
      // SPA que nunca estabiliza: o spinner falso nunca some.
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(wizardBrokenPage())
      return
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const baseUrl = `https://127.0.0.1:${port}/`

  return {
    url: baseUrl,
    baseUrl,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
