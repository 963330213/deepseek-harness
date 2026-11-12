/** JSON request limits and error responses shared by the OAuth routes. */

/** Maximum request body size accepted by this plugin. */
export const MAX_BODY_BYTES = 64 * 1024

/**
 * Decode a bounded JSON request. Failures carry a safe HTTP status.
 * @param {import('node:http').IncomingMessage} req Request to decode.
 * @returns {Promise<unknown>} Parsed JSON.
 */
export async function readJson(req) {
  return JSON.parse(await readBody(req, 'application/json'))
}

/**
 * Read a bounded request with the required media type.
 * @param {import('node:http').IncomingMessage} req Request to decode.
 * @param {string} media Expected content type.
 * @returns {Promise<string>} Body text.
 */
export async function readBody(req, media) {
  if (req.headers['content-type']?.split(';')[0] !== media) {
    throw Object.assign(new Error('Unexpected content type'), { status: 415 })
  }
  const chunks = []
  let size = 0
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request too large'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Send a non-cacheable response without exposing credentials.
 * @param {import('node:http').ServerResponse} res Response to write.
 * @param {number} status HTTP status.
 * @param {object} body JSON response fields.
 * @param {object} headers Additional response headers.
 */
export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  res.end(JSON.stringify(body))
}
