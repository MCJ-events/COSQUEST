const fs = require('fs/promises');
const Project = require('../models/Project');
const ProjectFile = require('../models/ProjectFile');
const ScheduledCall = require('../models/ScheduledCall');
const ConversationMember = require('../models/ConversationMember');
const { storeChatMedia, deleteChatMedia } = require('../utils/imageHost');
const { fail, objectId, text, groupFor, projectFor, subjectFor, sparkFor } = require('../utils/projectAccess');
const { emitToConversation } = require('../realtime/socket');

const fileJson = (f) => ({ id: String(f._id), subjectId: f.subjectId, uploadedBy: f.uploadedBy, fileName: f.fileName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, url: f.url, createdAt: f.createdAt });
function projectJson(p, fileCount = 0) {
  return { id: String(p._id), conversationId: p.conversation, createdBy: p.createdBy, name: p.name, description: p.description, location: p.location, dueAt: p.dueAt, archived: p.archived,
    subjects: p.subjects.map(s => ({ id: String(s._id), name: s.name, description: s.description })), subjectCount: p.subjects.length, fileCount, sparkCount: p.sparkLinks.length, updatedAt: p.updatedAt };
}
function changed(project) { emitToConversation(String(project.conversation), 'project:updated', { projectId: String(project._id) }); }
function dueDate(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(400, 'dueAt must be an ISO date or null.');
  return new Date(value);
}
async function createProject(req, res) {
  const group = await groupFor(req.params.groupId, req.user);
  const b = req.body || {};
  if (b.subjects !== undefined && (!Array.isArray(b.subjects) || b.subjects.length > 100)) fail(400, 'Provide up to 100 subjects.');
  const project = await Project.create({ conversation: group._id, createdBy: req.userId,
    name: text(b.name, 'Project name', 100, true), description: text(b.description ?? '', 'Description', 2000),
    location: text(b.location ?? '', 'Location', 200), dueAt: dueDate(b.dueAt ?? null),
    subjects: (b.subjects || []).map(s => ({ name: text(s?.name, 'Subject name', 100, true), description: text(s?.description ?? '', 'Subject description', 1000) })) });
  changed(project);
  res.status(201).json({ project: projectJson(project) });
}
async function listProjects(req, res) {
  const group = await groupFor(req.params.groupId, req.user);
  if (req.query.status && !['active', 'archived'].includes(req.query.status)) fail(400, 'status must be active or archived.');
  const filter = { conversation: group._id, archived: req.query.status === 'archived' };
  if (req.query.q) filter.name = { $regex: text(req.query.q, 'Search', 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
  const projects = await Project.find(filter).sort({ updatedAt: -1, _id: -1 }).skip(offset).limit(50);
  const counts = await ProjectFile.aggregate([{ $match: { project: { $in: projects.map(p => p._id) } } }, { $group: { _id: '$project', count: { $sum: 1 } } }]);
  const [total, activeCount, archivedCount] = await Promise.all([Project.countDocuments(filter), Project.countDocuments({ conversation: group._id, archived: false }), Project.countDocuments({ conversation: group._id, archived: true })]);
  res.json({ projects: projects.map(p => projectJson(p, counts.find(c => String(c._id) === String(p._id))?.count || 0)), total, activeCount, archivedCount, nextOffset: offset + projects.length < total ? offset + projects.length : null });
}
async function getProject(req, res) {
  const project = await projectFor(req.params.projectId, req.user);
  const canManage = String(project.createdBy) === req.userId || Boolean(await ConversationMember.exists({ conversation: project.conversation, user: req.userId, role: { $in: ['owner', 'admin'] } }));
  const [files, upcomingCalls, sparks] = await Promise.all([
    ProjectFile.find({ project: project._id }).sort({ createdAt: -1 }).limit(500),
    ScheduledCall.find({ projectId: project._id, cancelledAt: null, endsAt: { $gt: new Date() } }).sort({ startsAt: 1 }).limit(10).select('topic startsAt endsAt timeZone subjectId sparkId'),
    Promise.all(project.sparkLinks.map(async link => {
      try { return { ...await sparkFor(project.conversation, link.sparkId, link.engine), subjectId: link.subjectId, fileId: link.fileId }; }
      catch (e) { if (e.status === 404) return null; throw e; }
    })),
  ]);
  const total = await ProjectFile.countDocuments({ project: project._id });
  res.json({ project: { ...projectJson(project, total), canManage }, files: files.map(fileJson), filesTruncated: total > files.length, sparks: sparks.filter(Boolean), upcomingCalls: upcomingCalls.map(c => ({ id: String(c._id), topic: c.topic, startsAt: c.startsAt, endsAt: c.endsAt, timeZone: c.timeZone, subjectId: c.subjectId, sparkId: c.sparkId })) });
}
async function updateProject(req, res) {
  const p = await projectFor(req.params.projectId, req.user, { manage: true });
  const b = req.body || {};
  if (b.name !== undefined) p.name = text(b.name, 'Project name', 100, true);
  if (b.description !== undefined) p.description = text(b.description, 'Description', 2000);
  if (b.location !== undefined) p.location = text(b.location, 'Location', 200);
  if (b.dueAt !== undefined) p.dueAt = dueDate(b.dueAt);
  if (b.archived !== undefined) { if (typeof b.archived !== 'boolean') fail(400, 'archived must be boolean.'); p.archived = b.archived; }
  await p.save(); changed(p);
  res.json({ project: projectJson(p, await ProjectFile.countDocuments({ project: p._id })) });
}
async function addSubject(req, res) {
  const p = await projectFor(req.params.projectId, req.user, { write: true });
  if (p.subjects.length >= 100) fail(400, 'A project can have up to 100 subjects.');
  p.subjects.push({ name: text(req.body?.name, 'Subject name', 100, true), description: text(req.body?.description ?? '', 'Description', 1000) });
  await p.save(); changed(p);
  const s = p.subjects[p.subjects.length - 1];
  res.status(201).json({ subject: { id: String(s._id), name: s.name, description: s.description } });
}
// Runs before multer: unauthorized requests never write files to disk.
async function authorizeUpload(req, res, next) {
  req.project = await projectFor(req.params.projectId, req.user, { write: true });
  subjectFor(req.project, req.params.subjectId);
  next();
}
async function uploadFile(req, res) {
  if (!req.file) fail(400, 'Select a file using the multipart field "file".');
  let media;
  try {
    // Recheck after the upload in case the project was archived meanwhile.
    const p = await projectFor(req.params.projectId, req.user, { write: true });
    media = await storeChatMedia(req.file, req.file.mimetype.startsWith('image/') ? 'image' : 'file');
    await Project.updateOne({ _id: p._id }, { $set: { updatedAt: new Date() } });
    const file = await ProjectFile.create({ ...media, project: p._id, subjectId: req.params.subjectId || null, uploadedBy: req.userId });
    changed(p);
    res.status(201).json({ file: fileJson(file) });
  } catch (e) { if (media) await deleteChatMedia(media); throw e; }
  finally { await fs.unlink(req.file.path).catch(() => {}); }
}
async function listFiles(req, res) {
  const p = await projectFor(req.params.projectId, req.user);
  const subject = subjectFor(p, req.query.subjectId);
  const filter = { project: p._id, ...(subject ? { subjectId: subject._id } : {}) };
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  if (req.query.sort && !['newest', 'oldest', 'name'].includes(req.query.sort)) fail(400, 'sort must be newest, oldest or name.');
  const sort = req.query.sort === 'name' ? { fileName: 1, _id: 1 } : { createdAt: req.query.sort === 'oldest' ? 1 : -1, _id: 1 };
  const [files, total] = await Promise.all([ProjectFile.find(filter).sort(sort).skip(offset).limit(50), ProjectFile.countDocuments(filter)]);
  const canManage = String(p.createdBy) === req.userId || Boolean(await ConversationMember.exists({ conversation: p.conversation, user: req.userId, role: { $in: ['owner', 'admin'] } }));
  res.json({ files: files.map(f => ({ ...fileJson(f), canDelete: !p.archived && (canManage || String(f.uploadedBy) === req.userId) })), total, nextOffset: offset + files.length < total ? offset + files.length : null });
}
async function deleteFile(req, res) {
  const p = await projectFor(req.params.projectId, req.user, { write: true });
  const file = await ProjectFile.findOne({ _id: objectId(req.params.fileId, 'file ID'), project: p._id }).select('+publicId +resourceType');
  if (!file) fail(404, 'File not found.');
  if (String(file.uploadedBy) !== req.userId) await projectFor(req.params.projectId, req.user, { manage: true });
  await deleteChatMedia(file);
  await file.deleteOne();
  await Project.updateOne({ _id: p._id }, { $set: { 'sparkLinks.$[link].fileId': null } }, { arrayFilters: [{ 'link.fileId': file._id }] });
  changed(p); res.json({ deleted: true });
}
async function linkSpark(req, res) {
  const p = await projectFor(req.params.projectId, req.user, { write: true });
  const subject = subjectFor(p, req.body?.subjectId);
  const spark = await sparkFor(p.conversation, req.body?.sparkId);
  let file = null;
  if (req.body?.fileId) {
    file = await ProjectFile.findOne({ _id: objectId(req.body.fileId, 'file ID'), project: p._id, subjectId: subject?._id || null });
    if (!file) fail(404, 'File not found in the selected subject.');
  }
  const engine = require('../sparks').engine();
  const link = { sparkId: spark.id, engine, subjectId: subject?._id || null, fileId: file?._id || null };
  const current = p.sparkLinks.find(l => l.sparkId === spark.id && l.engine === engine);
  if (current) Object.assign(current, link);
  else { if (p.sparkLinks.length >= 500) fail(400, 'A project can link up to 500 Sparks.'); p.sparkLinks.push(link); }
  await p.save(); changed(p); res.json({ spark, link });
}
module.exports = { createProject, listProjects, getProject, updateProject, addSubject, authorizeUpload, uploadFile, listFiles, deleteFile, linkSpark };
