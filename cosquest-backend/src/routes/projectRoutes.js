const router = require('express').Router();
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { asyncHandler: a } = require('../utils/asyncHandler');
const { projectUpload } = require('../middleware/upload');
const c = require('../controllers/projectController');
const { validate } = require('../middleware/validate');
const rules = require('../validators/planning');
router.use(['/groups/:groupId/projects', '/projects'], requireAuth, requireCompletedOnboarding);
router.get('/groups/:groupId/projects', validate(rules.listProjects), a(c.listProjects));
router.post('/groups/:groupId/projects', validate(rules.createProject), a(c.createProject));
router.get('/projects/:projectId', validate(rules.projectId), a(c.getProject));
router.patch('/projects/:projectId', validate(rules.updateProject), a(c.updateProject));
router.post('/projects/:projectId/subjects', validate(rules.addSubject), a(c.addSubject));
router.get('/projects/:projectId/files', validate(rules.listFiles), a(c.listFiles));
// Path ids only (the upload has no body fields to check), so before the upload is read.
router.post(['/projects/:projectId/files', '/projects/:projectId/subjects/:subjectId/files'], validate(rules.uploadFile), a(c.authorizeUpload), projectUpload.single('file'), a(c.uploadFile));
router.delete('/projects/:projectId/files/:fileId', validate(rules.deleteFile), a(c.deleteFile));
router.post('/projects/:projectId/sparks', validate(rules.linkSpark), a(c.linkSpark));
module.exports = router;
