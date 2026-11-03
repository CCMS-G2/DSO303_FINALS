// Express 4 does not catch rejected promises thrown inside async route
// handlers - an unhandled rejection crashes the whole process. Wrap every
// async handler with this so a database or network error becomes a normal
// error response instead of taking the service down.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
