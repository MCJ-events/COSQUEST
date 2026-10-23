import { File } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { createChatApi } from './chatApi.js';

export function createProjectsCallsApi({ baseUrl, getToken }) {
  const base = `${baseUrl.replace(/\/$/, '')}/api`;
  const chat = createChatApi({ baseUrl, getToken });
  const enc = encodeURIComponent;
  async function request(path, method = 'GET', body, asText = false) {
    const token = await getToken();
    if (!token) throw new Error('Please sign in.');
    const multipart = body instanceof FormData;
    const response = await fetch(base + path, { method,
      headers: { Authorization: `Bearer ${token}`, ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? multipart ? body : JSON.stringify(body) : undefined });
    if (response.ok && asText) return response.text();
    const data = await response.json();
    if (!response.ok) { const e = new Error(data.error || 'Request failed.'); e.status = response.status; e.data = data; throw e; }
    return data;
  }
  const project = id => `/projects/${enc(id)}`;
  const call = id => `/scheduled-calls/${enc(id)}`;
  return {
    listProjects: (groupId, { status = 'active', q = '', offset = 0 } = {}) => request(`/groups/${enc(groupId)}/projects?status=${status}&q=${enc(q)}&offset=${offset}`),
    createProject: (groupId, body) => request(`/groups/${enc(groupId)}/projects`, 'POST', body),
    getProject: id => request(project(id)),
    updateProject: (id, body) => request(project(id), 'PATCH', body),
    addSubject: (id, body) => request(`${project(id)}/subjects`, 'POST', body),
    listFiles: (id, { subjectId, sort = 'newest', offset = 0 } = {}) => request(`${project(id)}/files?sort=${sort}&offset=${offset}${subjectId ? `&subjectId=${enc(subjectId)}` : ''}`),
    async uploadFile(id, asset, subjectId) {
      const file = new File(asset.uri);
      if (!file.exists) throw new Error('Please select the file again.');
      if (file.size > 25 * 1024 * 1024) throw new Error('Each file must be 25 MB or smaller.');
      const form = new FormData();
      const mime = asset.mimeType || file.type;
      form.append('file', mime && mime !== file.type ? file.slice(0, file.size, mime) : file, asset.name || file.name);
      return request(`${project(id)}${subjectId ? `/subjects/${enc(subjectId)}` : ''}/files`, 'POST', form);
    },
    deleteFile: (id, fileId) => request(`${project(id)}/files/${enc(fileId)}`, 'DELETE'),
    linkSpark: (id, body) => request(`${project(id)}/sparks`, 'POST', body),
    // Start from an existing chat message, preserving duplicate/force-choice behavior.
    async startProjectSpark({ projectId, conversationId, messageId, subject, subjectId, fileId, force = false }) {
      const result = await chat.startSpark(conversationId, messageId, subject, force);
      try { await request(`${project(projectId)}/sparks`, 'POST', { sparkId: result.spark.id, subjectId, fileId }); }
      catch (e) { e.createdSpark = result.spark; throw e; } // retry linking, not Spark creation
      return result;
    },
    listSparks: groupId => chat.listSparks(groupId),
    listMembers: (groupId, search = '', page = 1) => request(`/chats/${enc(groupId)}/members?search=${enc(search)}&page=${page}&limit=50`),
    listCalls: (groupId, view = 'upcoming', offset = 0) => request(`/groups/${enc(groupId)}/scheduled-calls?view=${view}&offset=${offset}`),
    scheduleCall: (groupId, body) => request(`/groups/${enc(groupId)}/scheduled-calls`, 'POST', body),
    meetNow: (groupId, body) => request(`/groups/${enc(groupId)}/meet-now`, 'POST', body),
    getCall: id => request(call(id)),
    updateCall: (id, body) => request(call(id), 'PATCH', body),
    cancelCall: id => request(`${call(id)}/cancel`, 'POST'),
    rsvp: (id, response) => request(`${call(id)}/rsvp`, 'POST', { response }),
    calendar: id => request(`${call(id)}/calendar.ics`, 'GET', undefined, true),
    join: (id, passcode) => request(`${call(id)}/join`, 'POST', { passcode }),
    admit: (id, userId, status) => request(`${call(id)}/admission/${enc(userId)}`, 'POST', { status }),
    resolveInvite: code => request(`/call-invitations/${enc(code)}`),
  };
}
