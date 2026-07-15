#!/usr/bin/env node
'use strict';
/* Taiga MCP server — zero-dependency stdio JSON-RPC. Requires Node 18+. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

/* ---------- config ---------- */

function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.taiga-mcp.json'), 'utf8'));
  } catch (_) { /* no config file */ }
  return {
    baseUrl: (process.env.TAIGA_API_URL || file.baseUrl || 'https://api.taiga.io').replace(/\/+$/, ''),
    username: process.env.TAIGA_USERNAME || file.username || null,
    password: process.env.TAIGA_PASSWORD || file.password || null,
    token: process.env.TAIGA_TOKEN || file.token || null,
  };
}
const CFG = loadConfig();
const API = CFG.baseUrl + '/api/v1';

/* ---------- auth + http ---------- */

let authToken = CFG.token;
let refreshToken = null;

async function doFetch(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (err) {
    const code = err.cause && err.cause.code ? ` (${err.cause.code})` : '';
    throw new Error(`Cannot reach Taiga at ${CFG.baseUrl}${code}. Check your network connection and the baseUrl setting.`);
  }
}

async function login() {
  if (!CFG.username || !CFG.password) {
    throw new Error(
      'Taiga credentials not configured. Set TAIGA_USERNAME and TAIGA_PASSWORD environment variables, ' +
      'or create ~/.taiga-mcp.json with {"username": "...", "password": "..."} ' +
      '(add "baseUrl" for self-hosted Taiga).'
    );
  }
  const res = await doFetch(API + '/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'normal', username: CFG.username, password: CFG.password }),
  });
  if (!res.ok) throw new Error(`Taiga login failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  authToken = data.auth_token;
  refreshToken = data.refresh || null;
}

async function api(method, apiPath, { query, body } = {}, _retried = false) {
  if (!authToken) await login();
  let url = API + apiPath;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += '?' + s;
  }
  const res = await doFetch(url, {
    method,
    headers: {
      Authorization: 'Bearer ' + authToken,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !_retried && !CFG.token) {
    authToken = null;
    return api(method, apiPath, { query, body }, true);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Taiga API ${method} ${apiPath} failed (${res.status}): ${text.slice(0, 500)}`);
  const out = text ? JSON.parse(text) : null;
  return { data: out, headers: res.headers };
}

const get = (p, query) => api('GET', p, { query }).then(r => r.data);
const getWithHeaders = (p, query) => api('GET', p, { query });
const post = (p, body) => api('POST', p, { body }).then(r => r.data);
const patch = (p, body) => api('PATCH', p, { body }).then(r => r.data);
const del = (p) => api('DELETE', p).then(r => r.data);

/* ---------- resolution helpers ---------- */

const cache = { projects: new Map(), me: null };

async function me() {
  if (!cache.me) cache.me = await get('/users/me');
  return cache.me;
}

async function resolveProject(project) {
  const key = String(project).toLowerCase();
  if (cache.projects.has(key)) return cache.projects.get(key);
  const detail = /^\d+$/.test(String(project))
    ? await get('/projects/' + project)
    : await get('/projects/by_slug', { slug: project });
  cache.projects.set(key, detail);
  cache.projects.set(String(detail.id), detail);
  return detail;
}

async function resolveUser(proj, who) {
  if (who === undefined || who === null) return undefined;
  if (who === 'none' || who === '') return null;
  if (String(who).toLowerCase() === 'me') return (await me()).id;
  if (/^\d+$/.test(String(who))) return Number(who);
  const w = String(who).toLowerCase();
  const m = (proj.members || []).find(
    x => (x.username || '').toLowerCase() === w || (x.full_name || x.full_name_display || '').toLowerCase() === w
  );
  if (!m) {
    const names = (proj.members || []).map(x => `${x.username} (${x.full_name || ''})`).join(', ');
    throw new Error(`No member "${who}" in project "${proj.name}". Members: ${names}`);
  }
  return m.id;
}

const STATUS_PATHS = { userstory: '/userstory-statuses', task: '/task-statuses', epic: '/epic-statuses' };

async function resolveStatus(kind, projectId, status) {
  if (status === undefined || status === null) return undefined;
  if (/^\d+$/.test(String(status))) return Number(status);
  const list = await get(STATUS_PATHS[kind], { project: projectId });
  const s = list.find(x => x.name.toLowerCase() === String(status).toLowerCase());
  if (!s) throw new Error(`No ${kind} status "${status}". Available: ${list.map(x => x.name).join(', ')}`);
  return s.id;
}

async function resolveMilestone(projectId, milestone) {
  if (milestone === undefined || milestone === null) return undefined;
  if (milestone === 'none' || milestone === '') return null;
  if (/^\d+$/.test(String(milestone))) return Number(milestone);
  const list = await get('/milestones', { project: projectId });
  const m = list.find(x => x.name.toLowerCase() === String(milestone).toLowerCase());
  if (!m) throw new Error(`No sprint "${milestone}". Available: ${list.map(x => x.name).join(', ')}`);
  return m.id;
}

const REF_PATHS = { userstory: '/userstories', task: '/tasks', epic: '/epics' };

async function byRefOrId(kind, args) {
  const base = REF_PATHS[kind];
  if (args.id) return get(`${base}/${args.id}`);
  if (args.project && args.ref) {
    const proj = await resolveProject(args.project);
    return get(`${base}/by_ref`, { ref: args.ref, project: proj.id });
  }
  throw new Error('Provide either "id", or both "project" and "ref".');
}

/* ---------- output shaping ---------- */

const userName = u => (u ? u.full_name_display || u.full_name || u.username : null);

function slimStory(s) {
  return {
    id: s.id, ref: s.ref, subject: s.subject,
    status: s.status_extra_info ? s.status_extra_info.name : s.status,
    is_closed: s.is_closed,
    assigned_to: userName(s.assigned_to_extra_info),
    sprint: s.milestone_name || null,
    epics: (s.epics || []).map(e => ({ id: e.id, ref: e.ref, subject: e.subject })),
    points: s.total_points ?? null,
    tags: (s.tags || []).map(t => (Array.isArray(t) ? t[0] : t)),
    version: s.version,
  };
}

function slimTask(t) {
  return {
    id: t.id, ref: t.ref, subject: t.subject,
    status: t.status_extra_info ? t.status_extra_info.name : t.status,
    is_closed: t.is_closed,
    assigned_to: userName(t.assigned_to_extra_info),
    user_story: t.user_story_extra_info
      ? { id: t.user_story_extra_info.id, ref: t.user_story_extra_info.ref, subject: t.user_story_extra_info.subject }
      : null,
    sprint: t.milestone_slug || t.milestone || null,
    tags: (t.tags || []).map(x => (Array.isArray(x) ? x[0] : x)),
    version: t.version,
  };
}

function slimEpic(e) {
  return {
    id: e.id, ref: e.ref, subject: e.subject,
    status: e.status_extra_info ? e.status_extra_info.name : e.status,
    is_closed: e.is_closed,
    assigned_to: userName(e.assigned_to_extra_info),
    color: e.color,
    progress: e.user_stories_counts
      ? { total_stories: e.user_stories_counts.total, closed_stories: e.user_stories_counts.progress }
      : undefined,
    version: e.version,
  };
}

async function comments(kind, id, limit = 10) {
  try {
    const hist = await get(`/history/${kind}/${id}`, { type: 'comment' });
    return hist
      .filter(h => h.comment)
      .slice(0, limit)
      .map(h => ({ author: h.user ? h.user.name || h.user.username : null, date: h.created_at, comment: h.comment }));
  } catch (_) {
    return [];
  }
}

function detail(kind, slim, full) {
  return {
    ...slim,
    description: full.description || '',
    owner: userName(full.owner_extra_info),
    created: full.created_date,
    modified: full.modified_date,
    due_date: full.due_date || undefined,
    blocked: full.is_blocked ? full.blocked_note || true : undefined,
  };
}

function paged(headers, page, items) {
  const total = headers.get('x-pagination-count');
  return { total: total ? Number(total) : items.length, page: page || 1, count: items.length, items };
}

/* ---------- tools ---------- */

const T = (name, description, properties, required = []) => ({
  name, description,
  inputSchema: { type: 'object', properties, required },
});

const P = {
  project: { type: 'string', description: 'Project id or slug (slug is in the project URL, e.g. "mycompany-backend")' },
  ref: { type: 'number', description: 'Item reference number, the #123 shown in Taiga' },
  id: { type: 'number', description: 'Internal id (alternative to project+ref)' },
  page: { type: 'number', description: 'Page number for paginated results (30 per page)' },
  assigned: { type: 'string', description: 'Username, full name, "me", or "none" to unassign' },
  sprint: { type: 'string', description: 'Sprint (milestone) name or id; "none" to remove from sprint' },
  tags: { type: 'array', items: { type: 'string' }, description: 'Tags (replaces existing tags on update)' },
  desc: { type: 'string', description: 'Description in Markdown' },
};

const TOOLS = [
  T('list_projects', 'List Taiga projects you are a member of.', {}),
  T('get_project',
    'Get project details: members, sprints, and the valid statuses for user stories, tasks and epics. Call this before creating or updating items to learn valid status names and assignees.',
    { project: P.project }, ['project']),
  T('list_user_stories',
    'List user stories in a project, optionally filtered by sprint, status, assignee or epic.',
    { project: P.project, sprint: P.sprint, status: { type: 'string', description: 'Status name, e.g. "In progress"' }, assigned_to: P.assigned, epic_ref: { type: 'number', description: 'Only stories in this epic (epic ref number)' }, page: P.page },
    ['project']),
  T('get_user_story', 'Get a user story with description and recent comments. Identify by project+ref or id.',
    { project: P.project, ref: P.ref, id: P.id }),
  T('create_user_story', 'Create a user story.',
    { project: P.project, subject: { type: 'string' }, description: P.desc, status: { type: 'string', description: 'Status name (project default if omitted)' }, sprint: P.sprint, assigned_to: P.assigned, epic_ref: { type: 'number', description: 'Link the new story to this epic (ref number)' }, tags: P.tags },
    ['project', 'subject']),
  T('update_user_story',
    'Update a user story (any subset of fields). Identify by project+ref or id. Version conflicts are handled automatically.',
    { project: P.project, ref: P.ref, id: P.id, subject: { type: 'string' }, description: P.desc, status: { type: 'string' }, sprint: P.sprint, assigned_to: P.assigned, tags: P.tags, due_date: { type: 'string', description: 'YYYY-MM-DD, or empty string to clear' } }),
  T('list_tasks',
    'List tasks in a project, optionally filtered by user story, sprint, status or assignee.',
    { project: P.project, user_story_ref: { type: 'number', description: 'Only tasks of this user story (ref number)' }, sprint: P.sprint, status: { type: 'string' }, assigned_to: P.assigned, page: P.page },
    ['project']),
  T('get_task', 'Get a task with description and recent comments. Identify by project+ref or id.',
    { project: P.project, ref: P.ref, id: P.id }),
  T('create_task', 'Create a task, optionally attached to a user story.',
    { project: P.project, subject: { type: 'string' }, description: P.desc, user_story_ref: { type: 'number', description: 'Attach to this user story (ref number)' }, status: { type: 'string' }, sprint: P.sprint, assigned_to: P.assigned, tags: P.tags },
    ['project', 'subject']),
  T('update_task',
    'Update a task (any subset of fields). Identify by project+ref or id.',
    { project: P.project, ref: P.ref, id: P.id, subject: { type: 'string' }, description: P.desc, status: { type: 'string' }, sprint: P.sprint, assigned_to: P.assigned, user_story_ref: { type: 'number', description: 'Move to this user story; 0 to detach' }, tags: P.tags, due_date: { type: 'string', description: 'YYYY-MM-DD, or empty string to clear' } }),
  T('list_epics', 'List epics in a project.',
    { project: P.project, status: { type: 'string' }, assigned_to: P.assigned, page: P.page }, ['project']),
  T('get_epic', 'Get an epic with description, recent comments and its user stories. Identify by project+ref or id.',
    { project: P.project, ref: P.ref, id: P.id }),
  T('create_epic', 'Create an epic.',
    { project: P.project, subject: { type: 'string' }, description: P.desc, status: { type: 'string' }, assigned_to: P.assigned, color: { type: 'string', description: 'Hex color like #A9AABC' }, tags: P.tags },
    ['project', 'subject']),
  T('update_epic', 'Update an epic (any subset of fields). Identify by project+ref or id.',
    { project: P.project, ref: P.ref, id: P.id, subject: { type: 'string' }, description: P.desc, status: { type: 'string' }, assigned_to: P.assigned, color: { type: 'string' }, tags: P.tags }),
  T('add_comment', 'Add a comment to a user story, task or epic. Identify by project+ref or id.',
    { item_type: { type: 'string', enum: ['userstory', 'task', 'epic'] }, project: P.project, ref: P.ref, id: P.id, comment: { type: 'string', description: 'Comment text (Markdown)' } },
    ['item_type', 'comment']),
  T('delete_user_story',
    'Permanently delete a user story. This cannot be undone. Identify by project+ref or id. Confirm with the user before calling.',
    { project: P.project, ref: P.ref, id: P.id }),
  T('delete_task',
    'Permanently delete a task. This cannot be undone. Identify by project+ref or id. Confirm with the user before calling.',
    { project: P.project, ref: P.ref, id: P.id }),
  T('delete_epic',
    'Permanently delete an epic. This cannot be undone; contained user stories are unlinked but not deleted. Identify by project+ref or id. Confirm with the user before calling.',
    { project: P.project, ref: P.ref, id: P.id }),
];

/* ---------- shared build/update logic ---------- */

async function buildFields(kind, proj, args) {
  const f = {};
  if (args.subject !== undefined) f.subject = args.subject;
  if (args.description !== undefined) f.description = args.description;
  if (args.status !== undefined) f.status = await resolveStatus(kind, proj.id, args.status);
  if (args.assigned_to !== undefined) f.assigned_to = await resolveUser(proj, args.assigned_to);
  if (args.sprint !== undefined) f.milestone = await resolveMilestone(proj.id, args.sprint);
  if (args.tags !== undefined) f.tags = args.tags;
  if (args.color !== undefined) f.color = args.color;
  if (args.due_date !== undefined) f.due_date = args.due_date === '' ? null : args.due_date;
  if (args.user_story_ref !== undefined && kind === 'task') {
    if (args.user_story_ref === 0) f.user_story = null;
    else {
      const us = await get('/userstories/by_ref', { ref: args.user_story_ref, project: proj.id });
      f.user_story = us.id;
    }
  }
  return f;
}

async function updateItem(kind, args, slimmer) {
  const current = await byRefOrId(kind, args);
  const proj = await resolveProject(String(current.project));
  const fields = await buildFields(kind, proj, args);
  if (Object.keys(fields).length === 0) throw new Error('No fields to update.');
  const updated = await patch(`${REF_PATHS[kind]}/${current.id}`, { ...fields, version: current.version });
  return slimmer(updated);
}

async function deleteItem(kind, args) {
  const item = await byRefOrId(kind, args);
  await del(`${REF_PATHS[kind]}/${item.id}`);
  return { ok: true, deleted: { type: kind, id: item.id, ref: item.ref, subject: item.subject } };
}

/* ---------- tool handlers ---------- */

const HANDLERS = {
  async list_projects() {
    const my = await me();
    const list = await get('/projects', { member: my.id, order_by: 'user_order' });
    return list.map(p => ({
      id: p.id, slug: p.slug, name: p.name,
      description: (p.description || '').slice(0, 200),
      is_private: p.is_private,
    }));
  },

  async get_project(args) {
    const p = await resolveProject(args.project);
    const milestones = await get('/milestones', { project: p.id });
    return {
      id: p.id, slug: p.slug, name: p.name, description: p.description,
      members: (p.members || []).map(m => ({ username: m.username, full_name: m.full_name, role: m.role_name })),
      sprints: milestones.map(m => ({
        id: m.id, name: m.name, closed: m.closed,
        start: m.estimated_start, finish: m.estimated_finish,
        open_stories: m.total_userstories ? m.total_userstories.length : undefined,
      })),
      userstory_statuses: (p.us_statuses || []).map(s => s.name),
      task_statuses: (p.task_statuses || []).map(s => s.name),
      epic_statuses: (p.epic_statuses || []).map(s => s.name),
      total_activity: p.total_activity,
    };
  },

  async list_user_stories(args) {
    const proj = await resolveProject(args.project);
    const query = { project: proj.id, page: args.page };
    if (args.status !== undefined) query.status = await resolveStatus('userstory', proj.id, args.status);
    if (args.sprint !== undefined) query.milestone = await resolveMilestone(proj.id, args.sprint);
    if (args.assigned_to !== undefined) query.assigned_to = await resolveUser(proj, args.assigned_to);
    if (args.epic_ref !== undefined) {
      const epic = await get('/epics/by_ref', { ref: args.epic_ref, project: proj.id });
      query.epic = epic.id;
    }
    const { data, headers } = await getWithHeaders('/userstories', query);
    return paged(headers, args.page, data.map(slimStory));
  },

  async get_user_story(args) {
    const s = await byRefOrId('userstory', args);
    return { ...detail('userstory', slimStory(s), s), comments: await comments('userstory', s.id) };
  },

  async create_user_story(args) {
    const proj = await resolveProject(args.project);
    const fields = await buildFields('userstory', proj, args);
    const created = await post('/userstories', { project: proj.id, ...fields });
    let epicLink;
    if (args.epic_ref !== undefined) {
      const epic = await get('/epics/by_ref', { ref: args.epic_ref, project: proj.id });
      await post(`/epics/${epic.id}/related_userstories`, { epic: epic.id, user_story: created.id });
      epicLink = { epic_ref: epic.ref, epic_subject: epic.subject };
    }
    return { ...slimStory(created), linked_to_epic: epicLink };
  },

  async update_user_story(args) { return updateItem('userstory', args, slimStory); },

  async list_tasks(args) {
    const proj = await resolveProject(args.project);
    const query = { project: proj.id, page: args.page };
    if (args.status !== undefined) query.status = await resolveStatus('task', proj.id, args.status);
    if (args.sprint !== undefined) query.milestone = await resolveMilestone(proj.id, args.sprint);
    if (args.assigned_to !== undefined) query.assigned_to = await resolveUser(proj, args.assigned_to);
    if (args.user_story_ref !== undefined) {
      const us = await get('/userstories/by_ref', { ref: args.user_story_ref, project: proj.id });
      query.user_story = us.id;
    }
    const { data, headers } = await getWithHeaders('/tasks', query);
    return paged(headers, args.page, data.map(slimTask));
  },

  async get_task(args) {
    const t = await byRefOrId('task', args);
    return { ...detail('task', slimTask(t), t), comments: await comments('task', t.id) };
  },

  async create_task(args) {
    const proj = await resolveProject(args.project);
    const fields = await buildFields('task', proj, args);
    const created = await post('/tasks', { project: proj.id, ...fields });
    return slimTask(created);
  },

  async update_task(args) { return updateItem('task', args, slimTask); },

  async list_epics(args) {
    const proj = await resolveProject(args.project);
    const query = { project: proj.id, page: args.page };
    if (args.status !== undefined) query.status = await resolveStatus('epic', proj.id, args.status);
    if (args.assigned_to !== undefined) query.assigned_to = await resolveUser(proj, args.assigned_to);
    const { data, headers } = await getWithHeaders('/epics', query);
    return paged(headers, args.page, data.map(slimEpic));
  },

  async get_epic(args) {
    const e = await byRefOrId('epic', args);
    const stories = await get('/userstories', { epic: e.id, project: e.project });
    return {
      ...detail('epic', slimEpic(e), e),
      user_stories: stories.map(s => ({ ref: s.ref, subject: s.subject, status: s.status_extra_info?.name, is_closed: s.is_closed })),
      comments: await comments('epic', e.id),
    };
  },

  async create_epic(args) {
    const proj = await resolveProject(args.project);
    const fields = await buildFields('epic', proj, args);
    const created = await post('/epics', { project: proj.id, ...fields });
    return slimEpic(created);
  },

  async update_epic(args) { return updateItem('epic', args, slimEpic); },

  async add_comment(args) {
    const kind = args.item_type;
    if (!REF_PATHS[kind]) throw new Error('item_type must be userstory, task or epic.');
    const item = await byRefOrId(kind, args);
    await patch(`${REF_PATHS[kind]}/${item.id}`, { comment: args.comment, version: item.version });
    return { ok: true, commented_on: { type: kind, ref: item.ref, subject: item.subject } };
  },

  async delete_user_story(args) { return deleteItem('userstory', args); },
  async delete_task(args) { return deleteItem('task', args); },
  async delete_epic(args) { return deleteItem('epic', args); },
};

/* ---------- JSON-RPC over stdio ---------- */

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(req) {
  const { id, method, params } = req;
  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: (params && params.protocolVersion) || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'taiga', version: '0.1.0' },
        },
      });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      const { name, arguments: args } = params;
      const handler = HANDLERS[name];
      if (!handler) {
        return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool: ' + name } });
      }
      try {
        const result = await handler(args || {});
        return send({
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] },
        });
      } catch (err) {
        return send({
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: 'Error: ' + err.message }], isError: true },
        });
      }
    }
    if (id !== undefined && id !== null) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
    }
  } catch (err) {
    if (id !== undefined && id !== null) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
    }
  }
}

let pending = 0;
let stdinClosed = false;
function maybeExit() {
  if (stdinClosed && pending === 0) process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', line => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch (_) { return; }
  pending++;
  handle(msg).finally(() => { pending--; maybeExit(); });
});
rl.on('close', () => { stdinClosed = true; maybeExit(); });
