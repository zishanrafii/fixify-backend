const { error } = require('../utils/responseHandler');

// Wraps a Zod schema into Express middleware. Validates req.body, and on
// success replaces req.body with the parsed (and type-coerced/trimmed) data
// so controllers always work with clean input.
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const message = firstIssue ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : 'Invalid request body';
      return error(res, message, 422);
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validate };
