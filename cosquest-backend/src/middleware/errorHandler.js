function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // The JSON body could not be read (express.json): the client's mistake, not ours.
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'The request body is too large.' });
  console.error(err);
  if (err?.name === 'VersionError') return res.status(409).json({ error: 'This item changed. Refresh and try again.' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File exceeds the upload size limit.' });
  if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Upload one file using the expected form field.' });
  // Multer's other limits (too many or too large form fields/parts): a bad request, not a crash.
  if (['LIMIT_FIELD_COUNT', 'LIMIT_FIELD_KEY', 'LIMIT_FIELD_VALUE', 'LIMIT_PART_COUNT'].includes(err?.code)) {
    return res.status(400).json({ error: 'The upload form has too many or too large fields.' });
  }
  if (err?.code === 11000) {
    const duplicateField = Object.keys(err.keyPattern || {})[0] || '';
    const message = duplicateField.includes('email')
      ? 'An account with this email already exists.'
      : 'That username is already taken.';
    return res.status(409).json({ error: message });
  }
  // A value that couldn't be turned into an id, number or date for a query: bad input.
  if (err?.name === 'CastError') return res.status(400).json({ error: `Invalid ${err.path || 'value'}.` });
  // Errors we raise on purpose carry a status and a message meant for the app.
  // Anything else is unexpected: the details stay in the server log, not the reply.
  if (err?.status || err?.statusCode) return res.status(err.status || err.statusCode).json({ error: err.message || 'Request failed.' });
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
}

module.exports = { notFound, errorHandler };
