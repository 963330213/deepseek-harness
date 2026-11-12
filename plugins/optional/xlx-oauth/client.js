/** OAuth configuration section and editor in User permissions. */
window.__ModuleLoader__.load({
  id: 'dsh-xlx-oauth',
  factory(require) {
    const React = require('react')
    const { Button, Checkbox, Input, Modal } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const NS = 'xlxOAuth.settings'
    const SECTIONS = 'xlx-auth.permissions.sections'
    const zh = {
      save: '保存',
      saving: '保存中…',
      retry: '重试',
      error: '无法完成 OAuth 配置操作，请重试',
      loading: '正在加载 OAuth 配置',
      forbidden: '只有项目管理员可以管理 OAuth 配置',
      loginRequired: '登录已失效，请重新登录',
      login: '重新登录',
      close: '关闭',
      mcpTitle: 'OAuth 授权',
      mcpHint: '使用当前 DSH 账号登录并确认 MCP 客户端授权。',
      mcpConfigure: '配置 MCP',
      mcpEnable: '启用 MCP',
      mcpResource: 'MCP 资源地址',
      mcpInvalid: '请输入以 /mcp 结尾的 HTTPS 地址或本机 HTTP 地址。',
      mcpChanged: '配置已被修改，请重新加载后再保存。',
      mcpEndpointMissing: '当前 DSH 服务尚未加载 MCP 配置接口，请重启 DSH 后重试。',
      mcpSaved: '配置已保存并生效。',
    }
    const en = {
      save: 'Save',
      saving: 'Saving…',
      retry: 'Retry',
      error: 'Could not complete the OAuth settings request. Please retry.',
      loading: 'Loading OAuth settings',
      forbidden: 'Only project administrators can manage OAuth settings.',
      loginRequired: 'Your login has expired. Please sign in again.',
      login: 'Sign in again',
      close: 'Close',
      mcpTitle: 'OAuth authorization',
      mcpHint: 'Use your DSH account to sign in and approve access for MCP clients.',
      mcpConfigure: 'Configure MCP',
      mcpEnable: 'Enable MCP',
      mcpResource: 'MCP resource URL',
      mcpInvalid: 'Enter an HTTPS or loopback HTTP URL ending in /mcp.',
      mcpChanged: 'The settings changed. Reload them before saving.',
      mcpEndpointMissing: 'The running DSH service has not loaded MCP settings. Restart DSH and retry.',
      mcpSaved: 'Settings saved and active.',
    }
    const styles = `
      .xlx-oauth-modal{width:min(620px,100%);max-height:100%}
      .xlx-oauth-modal-content{min-height:0;overflow:auto}
      .xlx-oauth-modal-body,.xlx-oauth-editor{display:grid;gap:20px;min-width:0;font-size:13px;color:var(--dsw-alias-label-primary)}
      .xlx-oauth-field{display:grid;gap:8px;min-width:0}
      .xlx-oauth-status{line-height:1.6;overflow-wrap:anywhere}
      @media(pointer:coarse){.xlx-oauth-modal-body input{font-size:16px}}
    `
    function Feedback({ error, t, retry }) {
      return h(
        'div',
        { className: 'xlx-oauth-status', role: 'status', 'aria-live': 'polite' },
        t(error),
        ' ',
        error === 'loginRequired'
          ? h('a', { href: '/_xlx/login' }, t('login'))
          : retry && error !== 'forbidden'
            ? h(Button, { size: 'sm', onClick: retry }, t('retry'))
            : null,
      )
    }

    function McpSettingsDialog({ t, request, errorKey, close }) {
      const formId = React.useId()
      const [draft, setDraft] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [saved, setSaved] = React.useState(false)
      const [reload, setReload] = React.useState(0)
      const setSettings = (settings) => {
        const resource = new URL('/mcp', location.origin)
        if (resource.protocol === 'http:' && resource.hostname === '127.0.0.1') resource.hostname = 'localhost'
        setDraft({ ...settings, resource: settings.resource || resource.href })
      }
      React.useEffect(() => {
        let active = true
        request().then(
          (settings) => {
            if (active) setSettings(settings)
          },
          (failure) => {
            if (active) setError(errorKey(failure))
          },
        )
        return () => {
          active = false
        }
      }, [request, reload])
      const retry = () => {
        setDraft(null)
        setError(null)
        setSaved(false)
        setReload((value) => value + 1)
      }
      const change = (key, value) => {
        setDraft((previous) => ({ ...previous, [key]: value }))
        setSaved(false)
        if (error !== 'mcpChanged') setError(null)
      }
      const submit = async (event) => {
        event.preventDefault()
        if (saving || error === 'mcpChanged') return
        setSaving(true)
        setSaved(false)
        setError(null)
        try {
          const { enabled, resource, revision } = draft
          setSettings(
            await request({
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ enabled, resource: resource.trim(), revision }),
            }),
          )
          setSaved(true)
        } catch (failure) {
          setError(errorKey(failure))
        } finally {
          setSaving(false)
        }
      }
      return h(
        Modal,
        {
          open: true,
          title: t('mcpTitle'),
          closeLabel: t('close'),
          className: 'xlx-oauth-modal',
          contentClassName: 'xlx-oauth-modal-content',
          backdropBlur: false,
          onClose: () => {
            if (!saving) close()
          },
          footer: draft
            ? h(
                React.Fragment,
                null,
                h(Button, { type: 'button', variant: 'outline', onClick: close, disabled: saving }, t('close')),
                h(
                  Button,
                  { type: 'submit', form: formId, variant: 'primary', disabled: saving || error === 'mcpChanged' },
                  t(saving ? 'saving' : 'save'),
                ),
              )
            : undefined,
        },
        h(
          'div',
          { className: 'xlx-oauth-modal-body' },
          error
            ? h(Feedback, { error, t, retry: !draft || error === 'mcpChanged' ? retry : undefined })
            : null,
          saved ? h('div', { role: 'status' }, t('mcpSaved')) : null,
          !draft && !error ? h('div', { role: 'status' }, t('loading')) : null,
          draft
            ? h(
                'form',
                { id: formId, className: 'xlx-oauth-editor', onSubmit: submit },
                h(Checkbox, {
                  label: t('mcpEnable'),
                  checked: draft.enabled,
                  disabled: saving,
                  onChange: (value) => change('enabled', value),
                }),
                draft.enabled
                  ? h(
                      'label',
                      { className: 'xlx-oauth-field' },
                      t('mcpResource'),
                      h(Input, {
                        type: 'url',
                        value: draft.resource,
                        disabled: saving,
                        required: true,
                        maxLength: 512,
                        onChange: (event) => change('resource', event.target.value),
                      }),
                    )
                  : null,
              )
            : null,
        ),
      )
    }
    function OAuthSection({ t, request, errorKey }) {
      const [open, setOpen] = React.useState(false)
      return h(
        'section',
        { className: 'xlx-summary xlx-toolbar' },
        h('div', null, h('h2', null, t('mcpTitle')), h('p', { className: 'xlx-muted' }, t('mcpHint'))),
        h(Button, { variant: 'outline', onClick: () => setOpen(true) }, t('mcpConfigure')),
        open ? h(McpSettingsDialog, { t, request, errorKey, close: () => setOpen(false) }) : null,
      )
    }
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'xlx-oauth: settings copy')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = styles
          document.head.append(style)
          return () => style.remove()
        }, 'xlx-oauth: settings styles')
        const abort = new AbortController()
        ctx.effect(() => () => abort.abort(), 'xlx-oauth: settings requests')
        const request = async (init) => {
          const response = await fetch('/_xlx_oauth/settings', { ...init, signal: abort.signal, credentials: 'same-origin' })
          if (!response.ok) {
            const body = await response.json().catch(() => null)
            throw { status: response.status, code: body?.error }
          }
          return response.json()
        }
        const errorKey = ({ status, code }) => {
          if (status === 401) return 'loginRequired'
          if (status === 403) return 'forbidden'
          if (status === 404) return 'mcpEndpointMissing'
          if (code === 'mcp-settings-changed') return 'mcpChanged'
          if (code === 'invalid-mcp-settings') return 'mcpInvalid'
          return 'error'
        }
        ctx.slots.inject(SECTIONS, () =>
          ctx.slots.register(
            { name: SECTIONS, id: 'xlx-oauth', locale: NS, inject: () => ({ request, errorKey }) },
            OAuthSection,
          ),
        )
      },
    }
  },
})
