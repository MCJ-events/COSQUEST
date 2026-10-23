import { createElement as h, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { pickAttachment } from './attachmentPicker.js';

// Integration screens for the existing Expo app. Mount with key={groupId}.
// onOpenSpark opens the existing Spark panel; onJoin connects the existing
// LiveKit call screen using { token, livekitUrl, roomName, videoEnabled }.
const label = (value, style) => h(Text, { style: [s.text, style] }, value);
const card = (...children) => h(View, { style: s.card }, ...children);
function Button({ title, onPress, disabled = false, secondary = false }) {
  return h(Pressable, { onPress, disabled, accessibilityRole: 'button', accessibilityState: { disabled }, style: [s.button, secondary && s.secondary, disabled && { opacity: 0.5 }] }, label(title, [s.buttonText, secondary && { color: '#a62980' }]));
}
function Field({ title, value, onChangeText, ...props }) {
  return h(View, { style: s.field }, label(title, s.caption), h(TextInput, { value, onChangeText, accessibilityLabel: title, style: s.input, autoCapitalize: 'sentences', ...props }));
}
function Choices({ title, value, choices, onChange }) {
  return h(View, { style: s.field }, label(title, s.caption), h(View, { style: s.row }, ...choices.map(([id, name]) => h(Button, { key: id, title: name, secondary: value !== id, onPress: () => onChange(id) }))));
}
function Toggle({ title, value, onChange }) {
  return h(View, { style: s.between }, label(title), h(Switch, { value, onValueChange: onChange, accessibilityLabel: title, trackColor: { true: '#c54b9e', false: '#cbd5e1' } }));
}
function useTask() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const locked = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function run(fn) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { return await fn(); } catch (e) { if (mounted.current) setError(e.message); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return { busy, run, error, feedback: error ? label(error, s.error) : busy ? h(ActivityIndicator, { color: '#c54b9e' }) : null };
}
function useResource(loader, dependencies) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(true), [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true; setBusy(true); setError('');
    loader().then(value => { if (live) setData(value); }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [...dependencies, version]);
  const refresh = () => setVersion(v => v + 1);
  return { data, busy, refresh, feedback: error ? h(View, null, label(error, s.error), h(Button, { title: 'Try again', secondary: true, onPress: refresh })) : busy ? h(ActivityIndicator, { color: '#c54b9e' }) : null };
}
function Page({ title, subtitle, onBack, children }) {
  return h(ScrollView, { style: s.page, contentContainerStyle: s.content, keyboardShouldPersistTaps: 'handled' },
    onBack && h(Button, { title: '‹ Back', secondary: true, onPress: onBack }), label(title, s.title), subtitle && label(subtitle, s.caption), children);
}
const when = c => new Intl.DateTimeFormat(undefined, { timeZone: c.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(c.startsAt));

export function ProjectForm({ api, groupId, onCreated, onCancel }) {
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [location, setLocation] = useState(''), [date, setDate] = useState(''), [subjects, setSubjects] = useState('');
  const task = useTask();
  return h(Page, { title: 'New project', subtitle: 'Keep your group’s plans, files and Sparks together.', onBack: onCancel },
    card(h(Field, { title: 'Project name *', value: name, onChangeText: setName, maxLength: 100 }),
      h(Field, { title: 'Description', value: description, onChangeText: setDescription, multiline: true, maxLength: 2000 }),
      h(Field, { title: 'Location (optional)', value: location, onChangeText: setLocation, maxLength: 200 }),
      h(Field, { title: 'Target date (YYYY-MM-DD, optional)', value: date, onChangeText: setDate, autoCapitalize: 'none' }),
      h(Field, { title: 'Subjects (one per line)', value: subjects, onChangeText: setSubjects, multiline: true, placeholder: 'Route & meetup\nCostumes\nSupplies & roles' })),
    task.feedback,
    h(Button, { title: task.busy ? 'Creating…' : 'Create project', disabled: task.busy || !name.trim(), onPress: () => task.run(async () => {
      if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('Enter a valid date as YYYY-MM-DD.');
      const result = await api.createProject(groupId, { name, description, location, dueAt: date || null, subjects: subjects.split('\n').map(v => v.trim()).filter(Boolean).map(name => ({ name })) });
      onCreated(result.project);
    }) }));
}

export function ProjectUploadField({ api, projectId, subjectId, disabled = false, onUploaded }) {
  const [asset, setAsset] = useState(null), task = useTask();
  return h(View, { style: s.upload }, label('Add something for the group', s.heading),
    label('PDF, images & documents · Up to 25 MB each', s.caption),
    h(View, { style: s.row }, ...[['document', 'Choose document'], ['photo', 'Choose image']].map(([kind, title]) => h(Button, { key: kind, title, secondary: true, disabled: disabled || task.busy, onPress: () => task.run(async () => { const selected = await pickAttachment(kind); if (selected) setAsset(selected); }) }))),
    asset && label(asset.name), task.feedback,
    asset && h(Button, { title: task.busy ? 'Uploading…' : 'Upload file', disabled: disabled || task.busy, onPress: () => task.run(async () => { await api.uploadFile(projectId, asset, subjectId); setAsset(null); onUploaded(); }) }));
}

function ProjectsList({ api, groupId, onOpen, onCreate }) {
  const [status, setStatus] = useState('active'), [q, setQ] = useState(''), [search, setSearch] = useState(''), [offset, setOffset] = useState(0);
  const r = useResource(() => api.listProjects(groupId, { status, q: search, offset }), [api, groupId, status, search, offset]);
  return h(Page, { title: 'Projects', subtitle: 'Keep your plans, Sparks and files in one place.' },
    h(Button, { title: '+ New project', onPress: onCreate }),
    h(Field, { title: 'Search projects', value: q, onChangeText: setQ, returnKeyType: 'search', onSubmitEditing: () => { setOffset(0); setSearch(q); } }),
    h(Button, { title: 'Search', secondary: true, onPress: () => { setOffset(0); setSearch(q); } }),
    h(Choices, { title: 'Projects', value: status, choices: [['active', `Active · ${r.data?.activeCount ?? '…'}`], ['archived', `Archived · ${r.data?.archivedCount ?? '…'}`]], onChange: v => { setStatus(v); setOffset(0); } }), r.feedback,
    !r.busy && r.data?.projects.length === 0 && label('No projects here yet. Create one to start planning.', s.caption),
    ...(r.data?.projects || []).map(p => h(View, { key: p.id, style: s.card }, label(p.name, s.heading), label(p.description), label(`${p.subjectCount} subjects · ${p.fileCount} files · ${p.sparkCount} Sparks`, s.caption), h(Button, { title: 'Open project ›', secondary: true, onPress: () => onOpen(p.id) }))),
    offset > 0 && h(Button, { title: 'Previous projects', secondary: true, onPress: () => setOffset(Math.max(0, offset - 50)) }),
    r.data?.nextOffset != null && h(Button, { title: 'More projects', secondary: true, onPress: () => setOffset(r.data.nextOffset) }));
}

function ProjectDetail({ api, projectId, onBack, onCall, onSchedule, onOpenSpark, onStartSpark }) {
  const [subjectId, setSubjectId] = useState(null), [subjectName, setSubjectName] = useState(''), [sort, setSort] = useState('newest'), [offset, setOffset] = useState(0), [linkId, setLinkId] = useState(''), [linkedFileId, setLinkedFileId] = useState(null);
  const task = useTask(), r = useResource(() => api.getProject(projectId), [api, projectId]);
  const files = useResource(() => api.listFiles(projectId, { subjectId, sort, offset }), [api, projectId, subjectId, sort, offset]);
  const available = useResource(() => r.data ? api.listSparks(r.data.project.conversationId) : Promise.resolve({ sparks: [] }), [api, r.data?.project.conversationId]);
  const p = r.data?.project, subject = p?.subjects.find(v => v.id === subjectId);
  const refresh = () => { r.refresh(); files.refresh(); available.refresh(); };
  const chooseSubject = id => { setSubjectId(id); setOffset(0); setLinkedFileId(null); };
  const back = () => subjectId ? chooseSubject(null) : onBack();
  if (!p) return h(Page, { title: 'Project', onBack }, r.feedback);
  const sparks = (r.data.sparks || []).filter(v => !subjectId || v.subjectId === subjectId);
  return h(Page, { title: subject?.name || p.name, subtitle: subject?.description || p.description, onBack: back },
    r.feedback, task.feedback,
    label(`${p.subjectCount} subjects · ${p.fileCount} files · ${p.sparkCount} Sparks`, s.caption),
    !subjectId && card(label(p.location || 'Shared with your group', s.caption), p.dueAt && label(`Target date: ${String(p.dueAt).slice(0, 10)}`, s.caption),
      p.canManage && h(Button, { title: p.archived ? 'Restore project' : 'Archive project', secondary: true, disabled: task.busy, onPress: () => task.run(async () => { await api.updateProject(projectId, { archived: !p.archived }); refresh(); }) })),
    !subjectId && label('Subjects', s.heading),
    !subjectId && p.subjects.map(v => h(Button, { key: v.id, title: `${v.name} ›`, secondary: true, onPress: () => chooseSubject(v.id) })),
    !subjectId && !p.archived && card(h(Field, { title: 'New subject', value: subjectName, onChangeText: setSubjectName, maxLength: 100 }), h(Button, { title: '+ Add subject', disabled: task.busy || !subjectName.trim(), onPress: () => task.run(async () => { await api.addSubject(projectId, { name: subjectName }); setSubjectName(''); r.refresh(); }) })),
    !p.archived && h(ProjectUploadField, { key: subjectId || 'project', api, projectId, subjectId, onUploaded: refresh }),
    h(Choices, { title: 'Files', value: sort, choices: [['newest', 'Newest'], ['oldest', 'Oldest'], ['name', 'Name']], onChange: value => { setSort(value); setOffset(0); } }), files.feedback,
    !files.busy && files.data?.files.length === 0 && label('No files yet. Add a route, checklist or inspiration image.', s.caption),
    ...(files.data?.files || []).map(f => h(View, { key: f.id, style: s.card }, label(f.fileName, s.heading), label(`${(f.sizeBytes / 1024).toFixed(0)} KB · ${new Date(f.createdAt).toLocaleDateString()}`, s.caption),
      h(Button, { title: 'Open file', secondary: true, onPress: () => task.run(() => Linking.openURL(f.url)) }),
      !p.archived && String(f.subjectId || '') === String(subjectId || '') && h(Button, { title: linkedFileId === f.id ? '✓ Selected for Spark' : 'Attach to Spark', secondary: true, onPress: () => setLinkedFileId(linkedFileId === f.id ? null : f.id) }),
      f.canDelete && h(Button, { title: 'Remove file', secondary: true, disabled: task.busy, onPress: () => Alert.alert('Remove file?', f.fileName, [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => task.run(async () => { await api.deleteFile(projectId, f.id); if (linkedFileId === f.id) setLinkedFileId(null); refresh(); }) }]) }))),
    offset > 0 && h(Button, { title: 'Previous files', secondary: true, onPress: () => setOffset(Math.max(0, offset - 50)) }),
    files.data?.nextOffset != null && h(Button, { title: 'More files', secondary: true, onPress: () => setOffset(files.data.nextOffset) }),
    label(`Related Sparks · ${sparks.length}`, s.heading),
    ...sparks.map(spark => h(View, { key: spark.id, style: s.card }, label(spark.subject, s.heading), label(spark.summary || `${spark.participantCount} people`),
      spark.fileId && label(r.data.files.find(f => f.id === spark.fileId)?.fileName || 'Attached file', s.caption),
      h(Button, { title: 'Open Spark ›', secondary: true, disabled: !onOpenSpark, onPress: () => onOpenSpark(spark.id, p.conversationId) }))),
    !p.archived && card(label('Link an existing Spark', s.heading), available.feedback,
      ...(available.data?.sparks || []).map(v => h(Button, { key: v.id, title: `${linkId === v.id ? '✓ ' : ''}${v.subject}`, secondary: linkId !== v.id, onPress: () => setLinkId(v.id) })),
      h(Button, { title: linkedFileId ? 'Link Spark with selected file' : 'Link Spark', disabled: task.busy || !linkId, onPress: () => task.run(async () => { await api.linkSpark(projectId, { sparkId: linkId, subjectId, fileId: linkedFileId }); setLinkId(''); setLinkedFileId(null); r.refresh(); }) })),
    !p.archived && h(Button, { title: '✧ Start a project Spark', disabled: !onStartSpark, onPress: () => onStartSpark({ projectId, conversationId: p.conversationId, subjectId, fileId: linkedFileId, onLinked: refresh }) }),
    label('Upcoming calls', s.heading),
    ...(r.data.upcomingCalls || []).map(c => h(Button, { key: c.id, title: `${c.topic} · ${when(c)}`, secondary: true, onPress: () => onCall(c.id) })),
    !p.archived && h(Button, { title: 'Schedule a project call', onPress: () => onSchedule({ projectId, subjectId }) }));
}

export function ScheduleCallForm({ api, groupId, initial = {}, immediate = false, onSaved, onCancel }) {
  const zone = initial.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [topic, setTopic] = useState(initial.topic || ''), [description, setDescription] = useState(initial.description || '');
  const [date, setDate] = useState(''), [time, setTime] = useState('18:00'), [timeZone, setZone] = useState(zone), [duration, setDuration] = useState(String(initial.durationMinutes || 30));
  const [repeat, setRepeat] = useState('none'), [count, setCount] = useState('4');
  const [selected, setSelected] = useState((initial.participants || []).map(p => String(p.userId)));
  const [memberSearch, setMemberSearch] = useState(''), [memberPage, setMemberPage] = useState(1);
  const [hostVideo, setHostVideo] = useState(initial.hostVideo ?? true), [participantVideo, setParticipantVideo] = useState(initial.participantVideo ?? false), [waitingRoom, setWaitingRoom] = useState(initial.waitingRoom ?? true), [whoCanJoin, setWhoCanJoin] = useState(initial.whoCanJoin || 'invited');
  const [sparkId, setSparkId] = useState(initial.sparkId || null), [projectId, setProjectId] = useState(initial.projectId || null);
  const task = useTask(), members = useResource(() => api.listMembers(groupId, memberSearch, memberPage), [api, groupId, memberSearch, memberPage]);
  const sparks = useResource(() => api.listSparks(groupId), [api, groupId]);
  const [projectOffset, setProjectOffset] = useState(0);
  const projects = useResource(() => api.listProjects(groupId, { offset: projectOffset }), [api, groupId, projectOffset]);
  // Editing starts with the original wall time, independent of the phone's zone.
  useEffect(() => {
    if (!initial.startsAt) return;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: initial.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(initial.startsAt)).map(p => [p.type, p.value]));
    setDate(`${parts.year}-${parts.month}-${parts.day}`); setTime(`${parts.hour}:${parts.minute}`);
  }, [initial.startsAt, initial.timeZone]);
  return h(Page, { title: initial.id ? 'Edit this call' : immediate ? 'Meet now' : 'Schedule a call', subtitle: 'Bring your group together, wherever you are.', onBack: onCancel },
    card(h(Field, { title: 'Topic *', value: topic, onChangeText: setTopic, maxLength: 150 }), h(Field, { title: 'Description', value: description, onChangeText: setDescription, multiline: true, maxLength: 2000 }),
      !immediate && h(Field, { title: 'Date (YYYY-MM-DD) *', value: date, onChangeText: setDate, placeholder: '2026-11-07', autoCapitalize: 'none' }),
      !immediate && h(Field, { title: 'Start time (24-hour HH:mm) *', value: time, onChangeText: setTime, autoCapitalize: 'none' }),
      h(Field, { title: 'Time zone *', value: timeZone, onChangeText: setZone, placeholder: 'Africa/Lagos', autoCapitalize: 'none' }),
      h(Field, { title: 'Duration in minutes', value: duration, onChangeText: setDuration, keyboardType: 'number-pad' }),
      !initial.id && !immediate && h(Choices, { title: 'Repeat', value: repeat, choices: [['none', 'Does not repeat'], ['daily', 'Daily'], ['weekly', 'Weekly']], onChange: setRepeat }),
      repeat !== 'none' && h(Field, { title: 'Number of calls (1–52)', value: count, onChangeText: setCount, keyboardType: 'number-pad' })),
    card(label('Linked project (optional)', s.heading), projects.feedback,
      h(Button, { title: 'No project', secondary: projectId !== null, onPress: () => setProjectId(null) }),
      ...(projects.data?.projects || []).map(p => h(Button, { key: p.id, title: p.name, secondary: projectId !== p.id, onPress: () => setProjectId(p.id) })),
      projectOffset > 0 && h(Button, { title: 'Previous projects', secondary: true, onPress: () => setProjectOffset(Math.max(0, projectOffset - 50)) }),
      projects.data?.nextOffset != null && h(Button, { title: 'More projects', secondary: true, onPress: () => setProjectOffset(projects.data.nextOffset) })),
    card(label('Linked Spark (optional)', s.heading), sparks.feedback,
      h(Button, { title: 'No Spark', secondary: sparkId !== null, onPress: () => setSparkId(null) }),
      ...(sparks.data?.sparks || []).map(v => h(Button, { key: v.id, title: v.subject, secondary: sparkId !== v.id, onPress: () => setSparkId(v.id) }))),
    card(label(`Participants · ${selected.length} invited`, s.heading), label('You are the host.', s.caption),
      h(Field, { title: 'Find group members', value: memberSearch, onChangeText: v => { setMemberSearch(v); setMemberPage(1); } }), members.feedback,
      ...(members.data?.members || []).map(m => h(Button, { key: m.id, title: `${selected.includes(m.id) ? '✓ ' : ''}${m.name || m.username}`, secondary: !selected.includes(m.id), onPress: () => setSelected(ids => ids.includes(m.id) ? ids.filter(id => id !== m.id) : [...ids, m.id]) })),
      memberPage > 1 && h(Button, { title: 'Previous members', secondary: true, onPress: () => setMemberPage(p => p - 1) }),
      members.data?.pagination.hasMore && h(Button, { title: 'More members', secondary: true, onPress: () => setMemberPage(p => p + 1) })),
    card(label('Video & meeting access', s.heading), h(Toggle, { title: 'Host camera starts on', value: hostVideo, onChange: setHostVideo }), h(Toggle, { title: 'Participants can use cameras', value: participantVideo, onChange: setParticipantVideo }),
      h(Choices, { title: 'Who can join', value: whoCanJoin, choices: [['invited', 'Invited members'], ['group', 'All group members']], onChange: setWhoCanJoin }), h(Toggle, { title: 'Waiting room', value: waitingRoom, onChange: setWaitingRoom })),
    task.feedback,
    h(Button, { title: task.busy ? 'Saving…' : initial.id ? 'Save changes' : immediate ? 'Create meeting' : 'Schedule call', disabled: task.busy || !topic.trim(), onPress: () => task.run(async () => {
      const body = { topic, description, date, startTime: time, timeZone, durationMinutes: Number(duration), participantIds: selected, hostVideo, participantVideo, waitingRoom, whoCanJoin, projectId, subjectId: projectId === initial.projectId ? initial.subjectId || null : null, sparkId,
        ...(!initial.id && !immediate ? { repeat, occurrences: repeat === 'none' ? 1 : Number(count) } : {}) };
      const result = initial.id ? await api.updateCall(initial.id, body) : immediate ? await api.meetNow(groupId, body) : await api.scheduleCall(groupId, body);
      onSaved(result.call);
    }) }));
}

function CallsList({ api, groupId, onOpen, onSchedule, onMeet }) {
  const [view, setView] = useState('upcoming'), [offset, setOffset] = useState(0);
  const r = useResource(() => api.listCalls(groupId, view, offset), [api, groupId, view, offset]);
  return h(Page, { title: 'Calls', subtitle: 'A little planning. More time together.' },
    h(View, { style: s.row }, h(Button, { title: 'Schedule a call', onPress: onSchedule }), h(Button, { title: 'Meet now', secondary: true, onPress: onMeet })),
    h(Choices, { title: 'Calls', value: view, choices: [['upcoming', 'Upcoming'], ['past', 'Past'], ['cancelled', 'Cancelled']], onChange: v => { setView(v); setOffset(0); } }), r.feedback,
    !r.busy && r.data?.calls.length === 0 && label('No calls here yet.', s.caption),
    ...(r.data?.calls || []).map(c => h(View, { key: c.id, style: s.card }, label(c.topic, s.heading), label(`${when(c)} · ${c.durationMinutes} min`, s.caption), label(c.timeZone, s.caption), label(c.description),
      label(`${c.participants.filter(p => p.response === 'accepted').length} accepted · ${c.participants.filter(p => p.response === 'pending').length} awaiting`, s.caption),
      h(Button, { title: 'View call & invitation ›', secondary: true, onPress: () => onOpen(c.id) }))),
    offset > 0 && h(Button, { title: 'Previous calls', secondary: true, onPress: () => setOffset(Math.max(0, offset - 50)) }),
    r.data?.nextOffset != null && h(Button, { title: 'More calls', secondary: true, onPress: () => setOffset(r.data.nextOffset) }));
}

export function ScheduledCallDetail({ api, callId, onBack, onEdit, onJoin, onOpenSpark }) {
  const r = useResource(() => api.getCall(callId), [api, callId]), task = useTask();
  const c = r.data?.call;
  // Refresh admission and RSVP while this detail view is mounted.
  useEffect(() => { const timer = setInterval(r.refresh, 15000); return () => clearInterval(timer); }, [callId]);
  if (!c) return h(Page, { title: 'Call details', onBack }, r.feedback);
  const name = id => r.data.people.find(p => p.id === String(id))?.name || 'Group member';
  const active = !['past', 'cancelled'].includes(c.status);
  const invitation = `${c.topic}\n${when(c)} · ${c.timeZone}\n${c.inviteUrl}\nPasscode: ${c.passcode}`;
  return h(Page, { title: 'Call details', onBack }, r.feedback, task.feedback,
    card(label(c.status === 'cancelled' ? 'Call cancelled' : c.status === 'past' ? 'Past call' : 'Call scheduled', s.pink), label(c.topic, s.title), label(c.description), label(`${when(c)} · ${c.durationMinutes} minutes`), label(c.timeZone, s.caption), label(`Hosted by ${name(c.hostId)}`, s.caption),
      c.repeat !== 'none' && label(`${c.repeat} series · occurrence ${c.occurrence}`, s.caption),
      c.sparkId && h(Button, { title: 'Open linked Spark', secondary: true, disabled: !onOpenSpark, onPress: () => onOpenSpark(c.sparkId, c.conversationId) })),
    c.canJoin && card(label('Invitation', s.heading), label(c.inviteUrl), label(`Passcode: ${c.passcode}`, s.caption),
      h(Button, { title: 'Share invitation', disabled: task.busy, onPress: () => task.run(() => Share.share({ message: invitation })) }),
      h(Button, { title: 'Copy invitation', secondary: true, disabled: task.busy, onPress: () => task.run(async () => { await Clipboard.setStringAsync(invitation); Alert.alert('Copied', 'The invitation is ready to paste.'); }) })),
    card(label(`Participants · ${c.participants.length + 1}`, s.heading), label(`${name(c.hostId)} · Host`), ...c.participants.map(p => h(Text, { key: p.userId, style: s.text }, `${name(p.userId)} · ${p.response}`))),
    active && !c.canManage && c.canJoin && h(View, { style: s.row }, ...[['accepted', 'Accept'], ['declined', 'Decline']].map(([response, title]) => h(Button, { key: response, title, secondary: true, disabled: task.busy, onPress: () => task.run(async () => { await api.rsvp(callId, response); r.refresh(); }) }))),
    c.canManage && c.admission.filter(a => a.status === 'waiting').map(a => h(View, { key: a.userId, style: s.card }, label(`${name(a.userId)} is waiting`), ...[['admitted', 'Admit'], ['denied', 'Decline']].map(([status, title]) => h(Button, { key: status, title, secondary: true, disabled: task.busy, onPress: () => task.run(async () => { await api.admit(callId, a.userId, status); r.refresh(); }) })))),
    label(`${c.whoCanJoin === 'invited' ? 'Invited members' : 'Group members'} · Waiting room ${c.waitingRoom ? 'on' : 'off'}`, s.caption),
    active && c.canJoin && h(Button, { title: 'Join call', disabled: task.busy || !onJoin, onPress: () => task.run(async () => { const result = await api.join(callId, c.passcode); if (result.status === 'waiting') Alert.alert('Waiting for the host', 'Once the host admits you, tap Join call again.'); else onJoin(result, c); r.refresh(); }) }),
    c.canJoin && h(Button, { title: 'Add to calendar', secondary: true, disabled: task.busy, onPress: () => task.run(async () => {
      if (!await Sharing.isAvailableAsync()) throw new Error('Calendar sharing is unavailable on this device.');
      const ics = await api.calendar(callId), file = new File(Paths.cache, `cosquest-call-${callId}.ics`);
      file.create({ overwrite: true }); file.write(ics);
      try { await Sharing.shareAsync(file.uri, { mimeType: 'text/calendar', UTI: 'public.calendar-event' }); } finally { file.delete(); }
    }) }),
    c.canManage && c.status === 'upcoming' && h(Button, { title: 'Edit this call / manage participants', secondary: true, onPress: () => onEdit(c) }),
    c.canManage && active && h(Button, { title: 'Cancel this call', secondary: true, disabled: task.busy, onPress: () => Alert.alert('Cancel this call?', 'Participants will receive an update.', [{ text: 'Keep call', style: 'cancel' }, { text: 'Cancel call', style: 'destructive', onPress: () => task.run(async () => { await api.cancelCall(callId); r.refresh(); }) }]) }));
}

export function ProjectsAndCalls({ api, groupId, onOpenSpark, onStartSpark, onJoin }) {
  const [tab, setTab] = useState('projects'), [screen, setScreen] = useState({ type: 'list' });
  const back = () => setScreen({ type: 'list' });
  let content;
  if (screen.type === 'new-project') content = h(ProjectForm, { api, groupId, onCancel: back, onCreated: p => setScreen({ type: 'project', id: p.id }) });
  else if (screen.type === 'project') content = h(ProjectDetail, { api, projectId: screen.id, onBack: back, onOpenSpark, onStartSpark, onCall: id => setScreen({ type: 'call', id }), onSchedule: context => setScreen({ type: 'schedule', initial: context }) });
  else if (screen.type === 'schedule') content = h(ScheduleCallForm, { key: screen.initial?.id || 'new', api, groupId, initial: screen.initial, immediate: screen.immediate, onCancel: back, onSaved: c => setScreen({ type: 'call', id: c.id }) });
  else if (screen.type === 'call') content = h(ScheduledCallDetail, { api, callId: screen.id, onBack: back, onJoin, onOpenSpark, onEdit: initial => setScreen({ type: 'schedule', initial }) });
  else content = tab === 'projects' ? h(ProjectsList, { api, groupId, onOpen: id => setScreen({ type: 'project', id }), onCreate: () => setScreen({ type: 'new-project' }) }) : h(CallsList, { api, groupId, onOpen: id => setScreen({ type: 'call', id }), onSchedule: () => setScreen({ type: 'schedule' }), onMeet: () => setScreen({ type: 'schedule', immediate: true }) });
  return h(View, { style: { flex: 1, backgroundColor: '#d4f2ff' } }, h(Choices, { title: 'Group planning', value: tab, choices: [['projects', 'Projects'], ['calls', 'Calls']], onChange: value => { setTab(value); back(); } }), content);
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#def5ff' }, content: { padding: 18, gap: 12, paddingBottom: 40 },
  text: { color: '#252c45', fontSize: 14, lineHeight: 21 }, title: { fontSize: 25, fontWeight: '700', lineHeight: 32 }, heading: { fontSize: 16, fontWeight: '600' },
  caption: { color: '#667895', fontSize: 12 }, pink: { color: '#b52c87' }, error: { color: '#ad203b', fontSize: 14 },
  card: { padding: 16, borderRadius: 18, backgroundColor: '#fff', gap: 10 },
  field: { gap: 7, marginVertical: 6 }, input: { backgroundColor: '#f3f5f9', borderRadius: 10, padding: 12, color: '#252c45', fontSize: 15 },
  button: { borderRadius: 24, paddingVertical: 12, paddingHorizontal: 17, backgroundColor: '#c54b9e', alignItems: 'center', marginVertical: 3 },
  secondary: { backgroundColor: '#f8e7f3' }, buttonText: { color: '#fff', fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  upload: { padding: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: '#dc9dc9', borderRadius: 18, backgroundColor: '#f8fdff', gap: 10 },
});
