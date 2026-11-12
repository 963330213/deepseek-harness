/** Standalone browser consent page for the local DSH account. */

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escape = value => value.replace(/[&<>"']/g, character => entities[character])

/**
 * Show a consent form for one verified client or an error with no redirect.
 * @param {object} res Node response.
 * @param {number} status HTTP status.
 * @param {string} message Page explanation.
 * @param {object} [consent] Validated client, local account and authorization request.
 */
export function showConsent(res, status, message, consent) {
  const form = consent ? `
    <dl><dt>MCP 客户端</dt><dd>${escape(consent.clientName)}</dd>
    <dt>DSH 账号</dt><dd>${escape(consent.username)}</dd>
    <dt>回调地址</dt><dd><code>${escape(consent.callback.href)}</code></dd></dl>
    <form method="post">
      <button name="decision" value="deny">拒绝</button>
      <button name="decision" value="allow" class="primary">允许</button>
    </form>` : ''
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
      + (consent ? ' ' + consent.callback.origin : ''),
  })
  res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>DSH MCP 授权</title>
<style>
  :root{color-scheme:light dark}body{font:15px/1.55 system-ui;margin:0;min-height:100dvh;display:grid;place-items:center;background:light-dark(#f6f7f8,#17181b);color:CanvasText}
  main{box-sizing:border-box;width:min(480px,calc(100% - 32px));margin:24px 0;padding:clamp(20px,5vw,32px);border:1px solid light-dark(#ddd,#444);border-radius:20px;background:Canvas}
  h1{font-size:23px;font-weight:600;margin:0}p{margin:12px 0 20px}dl{margin:0;padding:16px 0;border-block:1px solid light-dark(#ddd,#444);display:grid;gap:6px 14px;grid-template-columns:auto minmax(0,1fr)}
  dt{color:light-dark(#585d65,#bac0c8)}dd{margin:0;overflow-wrap:anywhere}form{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:20px}
  button{min-height:44px;font:inherit;padding:8px 20px;border:1px solid light-dark(#bbb,#555);border-radius:10px;background:Canvas;color:CanvasText;cursor:pointer}
  button.primary{background:CanvasText;color:Canvas}button:focus-visible{outline:2px solid Highlight;outline-offset:3px}
</style></head><body><main><h1>DSH MCP 授权</h1><p>${escape(message)}</p>${form}</main></body></html>`)
}
