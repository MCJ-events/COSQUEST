const mongoose = require('mongoose');
const Project = require('../models/Project');
const { loadConversationForUser, groupRoleOf, isAdminRole } = require('../controllers/chatController');

function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function objectId(value, label = 'ID') {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail(400, `Invalid ${label}.`);
  return value;
}
function text(value, label, max, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(400, `${label} must be ${required ? '1' : '0'}-${max} characters.`);
  return value.trim();
}
async function groupFor(id, user) {
  objectId(id, 'group ID');
  const { conversation, error } = await loadConversationForUser(id, user);
  if (error) fail(error.status, error.message);
  if (conversation.type !== 'group') fail(400, 'Projects and scheduled calls belong to a group.');
  return conversation;
}
async function projectFor(id, user, { write = false, manage = false } = {}) {
  objectId(id, 'project ID');
  const project = await Project.findById(id);
  if (!project) fail(404, 'Project not found.');
  const group = await groupFor(String(project.conversation), user);
  if (manage && String(project.createdBy) !== String(user._id) && !isAdminRole(await groupRoleOf(group, user))) fail(403, 'Only the project creator or a group admin can edit this project.');
  if (write && project.archived) fail(409, 'Restore the archived project before making changes.');
  return project;
}
function subjectFor(project, id) {
  if (id == null || id === '') return null;
  objectId(id, 'subject ID');
  const subject = project.subjects.id(id);
  if (!subject) fail(404, 'Subject not found in this project.');
  return subject;
}
async function sparkFor(conversationId, id, engine = require('../sparks').engine()) {
  if (typeof id !== 'string' || !id || id.length > 200) fail(400, 'Invalid Spark ID.');
  if (engine === 'module') {
    const host = require('../sparks');
    if (!host.isReady()) fail(503, 'Sparks are unavailable right now.');
    const row = await host.store.getSpark(id);
    if (!row || row.chatId !== String(conversationId) || !['active', 'dormant'].includes(row.state)) fail(404, 'Spark not found in this group.');
    return require('../sparks/compat').serializeRow(host.store, row);
  }
  if (!mongoose.isValidObjectId(id)) fail(404, 'Spark not found.');
  const row = await require('../models/Spark').findOne({ _id: id, conversation: conversationId, deletedAt: null, mergedInto: null });
  if (!row) fail(404, 'Spark not found in this group.');
  return require('./sparks').serializeSpark(row);
}
module.exports = { fail, objectId, text, groupFor, projectFor, subjectFor, sparkFor };
