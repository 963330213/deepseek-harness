/** Opens the local user and role lists from User permissions in the Web sidebar. */
window.__ModuleLoader__.load({
  id: 'dsh-xlx-auth',
  factory(require) {
    const React = require('react')
    const {
      Button,
      Input,
      Checkbox,
      Modal,
      Pill,
      IconShieldOutlineRegular,
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const NS = 'xlxAuth.permissions'
    const PANEL_ID = 'user-permissions'
    const zh = {
      nav: '用户权限',
      description: '管理当前项目的用户、角色和访问权限',
      users: '用户',
      roles: '角色',
      newUser: '新增用户',
      newRole: '新增角色',
      username: '用户名',
      roleName: '角色名称',
      password: '密码',
      passwordHint: '6–256 个字符；编辑用户时留空则保持原密码',
      enabled: '启用账号',
      disabled: '已停用',
      active: '已启用',
      edit: '编辑',
      save: '保存',
      saving: '保存中…',
      cancel: '取消',
      retry: '重试',
      useHarness: '使用 DSH',
      manageAccounts: '管理用户权限',
      adminHint: '管理员可访问项目的全部设置、工作区和会话',
      isolation: '普通用户使用独立工作区，只能访问自己的会话',
      roleHint: '用户的有效权限取所有已分配角色的并集',
      noRoles: '未分配角色',
      saved: '已保存',
      error: '操作失败，请重试',
      loading: '正在加载用户权限',
      forbidden: '只有项目管理员可以管理用户和角色',
      logout: '退出登录',
      login: '重新登录',
      loginRequired: '登录已失效，请重新登录',
      invalid: '请检查名称、密码及角色',
      lastAdmin: '至少需要保留一个启用的管理员',
      unknownRole: '所选角色已不存在，请刷新后重试',
      nameHint: '使用小写字母开头，可包含数字、下划线和短横线',
      current: '当前用户',
      userManagement: '用户管理',
      roleManagement: '角色管理',
      viewUsers: '管理用户',
      viewRoles: '管理角色',
      userCount: '共 {count} 个用户',
      roleCount: '共 {count} 个角色',
      close: '关闭',
      back: '返回列表',
      search: '查询',
      reset: '重置',
      searchUsers: '按用户名前缀查询',
      searchRoles: '按角色名称前缀查询',
      status: '状态',
      allStatus: '全部状态',
      permissions: '权限',
      actions: '操作',
      previous: '上一页',
      next: '下一页',
      page: '第 {page} 页 · 共 {total} 条',
      empty: '暂无记录',
      noMatches: '没有匹配的记录，请调整查询条件',
      roleSelectionHint: '已选角色始终保留在列表中，可取消勾选',
      editUser: '编辑用户',
      editRole: '编辑角色',
      queryError: '名称查询仅支持字母、数字、下划线和短横线',
    }
    const en = {
      nav: 'User permissions',
      description: 'Manage users, roles and access to this project',
      users: 'Users',
      roles: 'Roles',
      newUser: 'Add user',
      newRole: 'Add role',
      username: 'Username',
      roleName: 'Role name',
      password: 'Password',
      passwordHint: '6–256 characters. Leave blank when editing to keep the password.',
      enabled: 'Enable account',
      disabled: 'Disabled',
      active: 'Enabled',
      edit: 'Edit',
      save: 'Save',
      saving: 'Saving…',
      cancel: 'Cancel',
      retry: 'Retry',
      useHarness: 'Use DSH',
      manageAccounts: 'Manage user permissions',
      adminHint: 'Administrators can access all project settings, workspaces and sessions.',
      isolation: 'Regular users have separate workspaces and can access only their own sessions.',
      roleHint: 'A user receives the combined permissions of their assigned roles.',
      noRoles: 'No roles',
      saved: 'Saved',
      error: 'Operation failed. Please retry.',
      loading: 'Loading user permissions',
      forbidden: 'Only project administrators can manage users and roles.',
      logout: 'Sign out',
      login: 'Sign in again',
      loginRequired: 'Your login has expired. Please sign in again.',
      invalid: 'Check the name, password and roles.',
      lastAdmin: 'Keep at least one enabled administrator.',
      unknownRole: 'A selected role is unavailable. Refresh and retry.',
      nameHint: 'Start with a lowercase letter; use letters, numbers, underscores or hyphens.',
      current: 'Current user',
      userManagement: 'User management',
      roleManagement: 'Role management',
      viewUsers: 'Manage users',
      viewRoles: 'Manage roles',
      userCount: '{count} users',
      roleCount: '{count} roles',
      close: 'Close',
      back: 'Back to list',
      search: 'Search',
      reset: 'Reset',
      searchUsers: 'Search by username prefix',
      searchRoles: 'Search by role name prefix',
      status: 'Status',
      allStatus: 'All statuses',
      permissions: 'Permissions',
      actions: 'Actions',
      previous: 'Previous',
      next: 'Next',
      page: 'Page {page} · {total} records',
      empty: 'No records',
      noMatches: 'No matching records. Adjust your filters.',
      roleSelectionHint: 'Selected roles stay in the list and can be unchecked.',
      editUser: 'Edit user',
      editRole: 'Edit role',
      queryError: 'Use letters, numbers, underscores or hyphens to search names.',
    }
    const styles = `
      .xlx-permissions-panel{width:100%;height:100%;min-width:0;min-height:0;overflow:auto;scrollbar-gutter:stable;background:var(--dsw-alias-bg-base)}
      .xlx-users{display:flex;flex-direction:column;gap:20px;max-width:960px;box-sizing:border-box;margin:0 auto;padding:max(28px,var(--dsh-frame-top-clearance,0px)) clamp(20px,4vw,48px) 48px;color:var(--dsw-alias-label-primary);font-size:13px;min-width:0}
      .xlx-users h1{font-size:24px;font-weight:500;line-height:1.4;margin:0}.xlx-users h2{font-size:14px;font-weight:500;margin:0}
      .xlx-users p{margin:6px 0 0;line-height:1.6}.xlx-muted{color:var(--dsw-alias-label-tertiary)}
      .xlx-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
      .xlx-toolbar>div{min-width:0;overflow-wrap:anywhere}.xlx-toolbar>button{flex-shrink:0}
      .xlx-summary{padding:20px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
      .xlx-summary p{max-width:420px}.xlx-count{display:block;margin-top:12px;color:var(--dsw-alias-label-secondary)}
      .xlx-actions{display:flex;flex-wrap:wrap;gap:8px}.xlx-editor{display:grid;gap:20px;outline:none}
      .xlx-field{display:grid;gap:8px;min-width:0}.xlx-checks{display:flex;flex-wrap:wrap;gap:12px 20px}
      .xlx-checks>*{min-width:0;overflow-wrap:anywhere}.xlx-status{line-height:1.6;overflow-wrap:anywhere}
      .xlx-skeleton{height:44px;background:var(--dsw-alias-button-ghost-hover);border-radius:8px}
      .xlx-modal{width:min(880px,100%);max-height:100%}.xlx-edit-modal{width:min(620px,100%)}.xlx-modal-content{min-height:0;overflow:auto}
      .xlx-modal-body{display:flex;flex-direction:column;gap:20px;font-size:13px;color:var(--dsw-alias-label-primary);min-width:0}
      .xlx-filters{display:flex;align-items:end;flex-wrap:wrap;gap:12px}.xlx-filters>.xlx-field{flex:1 1 220px}
      .xlx-filters>.xlx-state-filter{flex:1 1 240px}.xlx-filters .xlx-actions{padding-bottom:0}
      .xlx-table-scroll{overflow:auto;max-height:380px;min-height:180px;scrollbar-gutter:stable}
      .xlx-table{border-collapse:collapse;table-layout:fixed;width:100%;text-align:left}
      .xlx-table th{font-weight:500;color:var(--dsw-alias-label-secondary);position:sticky;top:0;background:var(--dsw-alias-bg-layer-2);z-index:1}
      .xlx-table th,.xlx-table td{padding:12px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);overflow-wrap:anywhere;vertical-align:middle}
      .xlx-table th:first-child,.xlx-table td:first-child{padding-left:0}.xlx-table th:last-child,.xlx-table td:last-child{text-align:right;padding-right:0;width:64px}
      .xlx-table th.xlx-name-column{width:30%}.xlx-table th.xlx-status-column{width:80px}
      .xlx-badge{display:inline-block;padding:3px 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-button-ghost-hover);color:var(--dsw-alias-label-secondary)}
      .xlx-current{display:block;font-size:12px;margin-top:4px}.xlx-empty{padding:48px 12px;text-align:center;color:var(--dsw-alias-label-tertiary)}
      .xlx-pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
      .xlx-role-picker{display:grid;gap:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2)}
      @media(max-width:600px){.xlx-toolbar{align-items:flex-start;flex-wrap:wrap}.xlx-table-scroll{max-height:360px}
        .xlx-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
        .xlx-table tr{display:grid;grid-template-columns:minmax(0,1fr) auto;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2);gap:8px}
        .xlx-table td{display:block;grid-column:1;padding:0;border:0}.xlx-table td:last-child{grid-column:2;grid-row:1 / span 3;width:auto;align-self:center}
        .xlx-table td[data-label]::before{content:attr(data-label);display:block;color:var(--dsw-alias-label-tertiary);font-size:12px;margin-bottom:4px}}
      @media(pointer:coarse){.xlx-modal-body input{font-size:16px}}
    `
    function Feedback({ state, t, retry }) {
      if (!state.error && !state.saved) return null
      return h(
        'div',
        { className: 'xlx-status', role: 'status', 'aria-live': 'polite' },
        state.error
          ? h(
              React.Fragment,
              null,
              t(state.error),
              ' ',
              state.error === 'loginRequired'
                ? h('a', { href: '/_xlx/login' }, t('login'))
                : retry
                  ? h(Button, { size: 'sm', disabled: state.busy || state.loading, onClick: retry }, t('retry'))
                  : null,
            )
          : t('saved'),
      )
    }
    function Pager({ page, data, t, disabled, previous, next }) {
      return h(
        'div',
        { className: 'xlx-pagination' },
        h(
          'span',
          { className: 'xlx-muted', role: 'status' },
          t('page').replace('{page}', page).replace('{total}', data.total),
        ),
        h(
          'div',
          { className: 'xlx-actions' },
          h(
            Button,
            { variant: 'outline', size: 'sm', disabled: disabled || page === 1, onClick: previous },
            t('previous'),
          ),
          h(Button, { variant: 'outline', size: 'sm', disabled: disabled || !data.next, onClick: next }, t('next')),
        ),
      )
    }
    function RolePicker({ data, load, selected, change, t, busy }) {
      const [search, setSearch] = React.useState('')
      const [cursors, setCursors] = React.useState([''])
      const page = data.query.page
      const names = [...new Set([...selected, ...data.items.map((role) => role.name)])]
      const move = async (query, history) => {
        if (await load(query)) setCursors(history)
      }
      return h(
        'div',
        { className: 'xlx-role-picker' },
        h('span', null, t('roles')),
        h('span', { className: 'xlx-muted' }, t('roleSelectionHint')),
        h(
          'div',
          { className: 'xlx-filters' },
          h(Input, {
            value: search,
            maxLength: 63,
            disabled: busy || data.loading,
            placeholder: t('searchRoles'),
            'aria-label': t('searchRoles'),
            onChange: (event) => setSearch(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void move({ search, after: '', page: 1 }, [''])
              }
            },
          }),
          h(
            Button,
            {
              variant: 'outline',
              disabled: busy || data.loading,
              onClick: () => move({ search, after: '', page: 1 }, ['']),
            },
            t('search'),
          ),
        ),
        h(Feedback, { state: data, t, retry: () => load(data.requested) }),
        data.loading
          ? h('div', { className: 'xlx-skeleton', 'aria-label': t('loading'), 'aria-busy': true })
          : h(
              'div',
              { className: 'xlx-checks' },
              names.map((name) =>
                h(Checkbox, {
                  key: name,
                  label: name,
                  checked: selected.includes(name),
                  disabled: busy,
                  onChange: (checked) =>
                    change(checked ? [...selected, name] : selected.filter((value) => value !== name)),
                }),
              ),
            ),
        !data.loading && !data.items.length ? h('span', { className: 'xlx-muted' }, t('noMatches')) : null,
        h(Pager, {
          page,
          data,
          t,
          disabled: busy || data.loading,
          previous: () => move({ ...data.query, page: page - 1, after: cursors[page - 2] }, cursors),
          next: () => move({ ...data.query, page: page + 1, after: data.next }, [...cursors.slice(0, page), data.next]),
        }),
      )
    }
    function Editor({ draft, roleOptions, loadRoles, t, busy, save, cancel }) {
      const [value, setValue] = React.useState(draft)
      const focus = React.useCallback((node) => node?.focus({ preventScroll: true }), [])
      const field = (key, patch) => setValue((previous) => ({ ...previous, [key]: patch }))
      const user = draft.kind === 'users'
      return h(
        'form',
        {
          className: 'xlx-editor',
          tabIndex: -1,
          ref: focus,
          onSubmit: (event) => {
            event.preventDefault()
            void save(value)
          },
        },
        h(
          'label',
          { className: 'xlx-field' },
          t(user ? 'username' : 'roleName'),
          h(Input, {
            required: true,
            value: value.name,
            disabled: busy || !draft.isNew,
            maxLength: 63,
            pattern: '[a-z][a-z0-9_-]{0,62}',
            onChange: (event) => field('name', event.target.value),
            'aria-description': t('nameHint'),
          }),
          h('span', { className: 'xlx-muted' }, t('nameHint')),
        ),
        user
          ? h(
              React.Fragment,
              null,
              h(
                'label',
                { className: 'xlx-field' },
                t('password'),
                h(Input, {
                  type: 'password',
                  autoComplete: 'new-password',
                  value: value.password,
                  disabled: busy,
                  required: draft.isNew,
                  minLength: 6,
                  maxLength: 256,
                  onChange: (event) => field('password', event.target.value),
                }),
                h('span', { className: 'xlx-muted' }, t('passwordHint')),
              ),
              h(Checkbox, {
                label: t('enabled'),
                checked: value.enabled,
                disabled: busy,
                onChange: (checked) => field('enabled', checked),
              }),
              h(RolePicker, {
                data: roleOptions,
                load: loadRoles,
                selected: value.roles,
                change: (roles) => field('roles', roles),
                t,
                busy,
              }),
            )
          : h(
              React.Fragment,
              null,
              h(Checkbox, {
                label: t('useHarness'),
                checked: value.useHarness,
                disabled: busy,
                onChange: (checked) => field('useHarness', checked),
              }),
              h(Checkbox, {
                label: t('manageAccounts'),
                checked: value.manageAccounts,
                disabled: busy,
                onChange: (checked) => field('manageAccounts', checked),
              }),
              h('p', { className: 'xlx-muted' }, t('adminHint')),
            ),
        h(
          'div',
          { className: 'xlx-actions' },
          h(Button, { variant: 'primary', type: 'submit', disabled: busy }, t(busy ? 'saving' : 'save')),
          h(Button, { variant: 'outline', disabled: busy, onClick: cancel }, t('cancel')),
        ),
      )
    }
    function ListDialog({ kind, state, t, loadList, loadRoles, clearFeedback, save, close }) {
      const [draft, setDraft] = React.useState(null)
      const [search, setSearch] = React.useState('')
      const [enabled, setEnabled] = React.useState('')
      const [cursors, setCursors] = React.useState([''])
      const data = state.list
      const page = data.query.page
      const users = kind === 'users'
      const move = async (query, history) => {
        if (await loadList(kind, query)) setCursors(history)
      }
      const edit = (row) => {
        clearFeedback()
        if (users) void loadRoles({ search: '', after: '', page: 1 })
        setDraft(
          users
            ? {
                kind,
                name: row?.username ?? '',
                enabled: row?.enabled ?? true,
                roles: row?.roles ?? ['member'],
                password: '',
                isNew: !row,
              }
            : {
                kind,
                name: row?.name ?? '',
                useHarness: row?.useHarness ?? true,
                manageAccounts: row?.manageAccounts ?? false,
                isNew: !row,
              },
        )
      }
      const title = draft
        ? t(users ? (draft.isNew ? 'newUser' : 'editUser') : draft.isNew ? 'newRole' : 'editRole')
        : t(users ? 'userManagement' : 'roleManagement')
      return h(
        Modal,
        {
          open: true,
          title,
          closeLabel: t('close'),
          className: draft ? 'xlx-modal xlx-edit-modal' : 'xlx-modal',
          contentClassName: 'xlx-modal-content',
          backdropBlur: false,
          onClose: () => {
            if (!state.busy) {
              if (draft) setDraft(null)
              else close()
            }
          },
        },
        h(
          'div',
          { className: 'xlx-modal-body' },
          h(Feedback, { state, t, retry: draft ? undefined : () => loadList(kind, data.requested) }),
          draft
            ? h(Editor, {
                key: `${draft.kind}:${draft.name}:${draft.isNew}`,
                draft,
                roleOptions: state.roleOptions,
                loadRoles,
                t,
                busy: state.busy,
                cancel: () => setDraft(null),
                save: async (value) => {
                  if (await save(value)) setDraft(null)
                },
              })
            : h(
                React.Fragment,
                null,
                h(
                  'form',
                  {
                    className: 'xlx-filters',
                    onSubmit: (event) => {
                      event.preventDefault()
                      void move({ search, enabled, after: '', page: 1 }, [''])
                    },
                  },
                  h(
                    'label',
                    { className: 'xlx-field' },
                    t(users ? 'username' : 'roleName'),
                    h(Input, {
                      value: search,
                      maxLength: 63,
                      pattern: '[a-zA-Z0-9_-]*',
                      placeholder: t(users ? 'searchUsers' : 'searchRoles'),
                      disabled: data.loading,
                      onChange: (event) => setSearch(event.target.value),
                    }),
                  ),
                  users
                    ? h(
                        'div',
                        { className: 'xlx-field xlx-state-filter' },
                        t('status'),
                        h(
                          'div',
                          { className: 'xlx-actions', role: 'group', 'aria-label': t('status') },
                          ['', '1', '0'].map((value) =>
                            h(
                              Pill,
                              {
                                key: value,
                                active: enabled === value,
                                'aria-pressed': enabled === value,
                                disabled: data.loading,
                                onClick: () => setEnabled(value),
                              },
                              t(value === '' ? 'allStatus' : value === '1' ? 'active' : 'disabled'),
                            ),
                          ),
                        ),
                      )
                    : null,
                  h(
                    'div',
                    { className: 'xlx-actions' },
                    h(Button, { variant: 'primary', type: 'submit', disabled: data.loading }, t('search')),
                    h(
                      Button,
                      {
                        variant: 'outline',
                        disabled: data.loading,
                        onClick: () => {
                          setSearch('')
                          setEnabled('')
                          void move({ search: '', enabled: '', after: '', page: 1 }, [''])
                        },
                      },
                      t('reset'),
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: 'xlx-toolbar' },
                  h('span', { className: 'xlx-muted' }, t(users ? 'isolation' : 'roleHint')),
                  h(
                    Button,
                    { variant: 'outline', disabled: state.busy || data.loading, onClick: () => edit(null) },
                    t(users ? 'newUser' : 'newRole'),
                  ),
                ),
                h(Feedback, { state: data, t, retry: () => loadList(kind, data.requested) }),
                h(
                  'div',
                  { className: 'xlx-table-scroll', 'aria-busy': data.loading },
                  data.loading
                    ? h('div', { className: 'xlx-skeleton', 'aria-label': t('loading') })
                    : data.items.length
                      ? h(
                          'table',
                          { className: 'xlx-table', 'aria-label': t(users ? 'users' : 'roles') },
                          h(
                            'thead',
                            null,
                            h(
                              'tr',
                              null,
                              h(
                                'th',
                                { scope: 'col', className: 'xlx-name-column' },
                                t(users ? 'username' : 'roleName'),
                              ),
                              users ? h('th', { scope: 'col', className: 'xlx-status-column' }, t('status')) : null,
                              h('th', { scope: 'col' }, t(users ? 'roles' : 'permissions')),
                              h('th', { scope: 'col' }, t('actions')),
                            ),
                          ),
                          h(
                            'tbody',
                            null,
                            data.items.map((row) => {
                              const name = users ? row.username : row.name
                              return h(
                                'tr',
                                { key: name },
                                h(
                                  'td',
                                  { 'data-label': t(users ? 'username' : 'roleName') },
                                  name,
                                  users && name === state.summary.currentUser
                                    ? h('span', { className: 'xlx-current xlx-muted' }, t('current'))
                                    : null,
                                ),
                                users
                                  ? h(
                                      'td',
                                      { 'data-label': t('status') },
                                      h('span', { className: 'xlx-badge' }, t(row.enabled ? 'active' : 'disabled')),
                                    )
                                  : null,
                                h(
                                  'td',
                                  { 'data-label': t(users ? 'roles' : 'permissions') },
                                  users
                                    ? row.roles.join(', ') || t('noRoles')
                                    : [row.useHarness && t('useHarness'), row.manageAccounts && t('manageAccounts')]
                                        .filter(Boolean)
                                        .join(' · ') || '—',
                                ),
                                h(
                                  'td',
                                  null,
                                  h(
                                    Button,
                                    {
                                      size: 'sm',
                                      disabled: state.busy,
                                      onClick: () => edit(row),
                                      'aria-label': `${t('edit')} ${name}`,
                                    },
                                    t('edit'),
                                  ),
                                ),
                              )
                            }),
                          ),
                        )
                      : h(
                          'div',
                          { className: 'xlx-empty' },
                          t(data.query.search || data.query.enabled ? 'noMatches' : 'empty'),
                        ),
                ),
                h(Pager, {
                  page,
                  data,
                  t,
                  disabled: data.loading || state.busy,
                  previous: () => move({ ...data.query, page: page - 1, after: cursors[page - 2] }, cursors),
                  next: () =>
                    move({ ...data.query, page: page + 1, after: data.next }, [...cursors.slice(0, page), data.next]),
                }),
              ),
        ),
      )
    }
    function PermissionsContent({ t, useSnapshot, refresh, loadList, loadRoles, clearFeedback, save, logout }) {
      const state = useSnapshot((value) => value)
      const [dialog, setDialog] = React.useState(null)
      const open = (kind) => {
        clearFeedback()
        setDialog(kind)
        void loadList(kind, { search: '', enabled: '', after: '', page: 1 })
      }
      return h(
        'div',
        { className: 'xlx-users' },
        h(
          'header',
          { className: 'xlx-toolbar' },
          h('div', null, h('h1', null, t('nav')), h('p', { className: 'xlx-muted' }, t('description'))),
          h(Button, { onClick: logout, disabled: state.busy }, t('logout')),
        ),
        !dialog ? h(Feedback, { state, t, retry: refresh }) : null,
        state.loading && !state.summary
          ? h('div', { className: 'xlx-skeleton', 'aria-label': t('loading'), 'aria-busy': true })
          : null,
        state.summary
          ? ['users', 'roles'].map((kind) =>
              h(
                'section',
                { key: kind, className: 'xlx-summary xlx-toolbar' },
                h(
                  'div',
                  null,
                  h('h2', null, t(kind === 'users' ? 'userManagement' : 'roleManagement')),
                  h('p', { className: 'xlx-muted' }, t(kind === 'users' ? 'isolation' : 'roleHint')),
                  h(
                    'span',
                    { className: 'xlx-count' },
                    t(kind === 'users' ? 'userCount' : 'roleCount').replace('{count}', state.summary[kind]),
                  ),
                ),
                h(
                  Button,
                  { variant: 'outline', disabled: state.busy, onClick: () => open(kind) },
                  t(kind === 'users' ? 'viewUsers' : 'viewRoles'),
                ),
              ),
            )
          : null,
        dialog
          ? h(ListDialog, {
              key: dialog,
              kind: dialog,
              state,
              t,
              loadList,
              loadRoles,
              clearFeedback,
              save,
              close: () => setDialog(null),
            })
          : null,
      )
    }
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'xlx-auth: permissions copy')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = styles
          document.head.append(style)
          return () => style.remove()
        }, 'xlx-auth: permissions styles')
        const emptyList = () => ({
          items: [],
          total: 0,
          next: null,
          query: { search: '', enabled: '', after: '', page: 1 },
          requested: { search: '', enabled: '', after: '', page: 1 },
          loading: false,
          error: null,
        })
        let state = {
          summary: null,
          loading: true,
          busy: false,
          error: null,
          saved: false,
          list: emptyList(),
          roleOptions: emptyList(),
        }
        const generations = { list: 0, roleOptions: 0 }
        const listeners = new Set()
        const abort = new AbortController()
        const snapshot = {
          getSnapshot: () => state,
          subscribe: (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
        }
        const publish = (patch) => {
          if (!abort.signal.aborted) {
            state = { ...state, ...patch }
            for (const listener of listeners) listener()
          }
        }
        const request = async (path, init) => {
          const response = await fetch(`/_xlx/${path}`, { ...init, signal: abort.signal, credentials: 'same-origin' })
          const body = await response.json()
          if (!response.ok) throw { status: response.status, code: body.error }
          return body
        }
        const errorKey = (error) =>
          error.status === 401
            ? 'loginRequired'
            : error.status === 403
              ? 'forbidden'
              : error.code === 'last-administrator'
                ? 'lastAdmin'
                : error.code === 'unknown-role'
                  ? 'unknownRole'
                  : error.code === 'invalid-query'
                    ? 'queryError'
                    : error.status === 400
                      ? 'invalid'
                      : 'error'
        const report = (error) => publish({ error: errorKey(error), loading: false, busy: false })
        const refresh = async () => {
          publish({ loading: true, error: null })
          try {
            publish({ summary: await request('summary'), loading: false })
          } catch (error) {
            publish({ error: errorKey(error), loading: false })
          }
        }
        const load = async (target, kind, query) => {
          const generation = ++generations[target]
          const previous = state[target].kind === kind ? state[target] : emptyList()
          publish({ [target]: { ...previous, kind, requested: query, loading: true, error: null } })
          const params = new URLSearchParams({
            search: query.search,
            after: query.after,
            enabled: query.enabled ?? '',
            limit: '10',
          })
          try {
            const result = await request(`${kind}?${params}`)
            if (generation !== generations[target] || abort.signal.aborted) return false
            publish({ [target]: { ...result, kind, query, requested: query, loading: false, error: null } })
            return true
          } catch (error) {
            if (generation === generations[target])
              publish({ [target]: { ...state[target], loading: false, error: errorKey(error) } })
            return false
          }
        }
        const loadList = (kind, query) => load('list', kind, query)
        const loadRoles = (query) => load('roleOptions', 'roles', query)
        const clearFeedback = () => publish({ error: null, saved: false })
        const save = async (value) => {
          if (state.busy) return false
          publish({ busy: true, error: null, saved: false })
          const body =
            value.kind === 'users'
              ? { enabled: value.enabled, roles: value.roles, ...(value.password ? { password: value.password } : {}) }
              : { useHarness: value.useHarness, manageAccounts: value.manageAccounts }
          try {
            await request(`${value.kind}/${value.name}`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            })
            publish({ saved: true })
            await refresh()
            await loadList(value.kind, state.list.query)
            publish({ busy: false })
            return true
          } catch (error) {
            report(error)
            return false
          }
        }
        const logout = async () => {
          publish({ busy: true })
          try {
            await request('logout', { method: 'POST' })
            location.assign('/_xlx/login')
          } catch (error) {
            report(error)
          }
        }
        ctx.effect(() => {
          void refresh()
          return () => {
            abort.abort()
            listeners.clear()
          }
        }, 'xlx-auth: permissions data')
        ctx.slots.inject('main', function* () {
          yield ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => ({ hooks: { snapshot }, refresh, loadList, loadRoles, clearFeedback, save, logout }),
            },
            (props) => h('div', { className: 'xlx-permissions-panel' }, h(PermissionsContent, props)),
          )
          yield ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: 6,
                label: () => ctx.locale.bind(NS)('nav'),
                locale: NS,
              },
              ({ size }) => h(IconShieldOutlineRegular, { size }),
            ),
          )
        })
      },
    }
  },
})
