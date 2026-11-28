const crypto = require('crypto');

// Structured JSON logs with a request ID (proposal NFR-08). API Gateway sends
// x-request-id; locally one is generated. CloudWatch Logs Insights can then
// filter every line of one request with: filter requestId = "<id>".
function log(fields) {
  console.log(JSON.stringify({ time: new Date().toISOString(), service: 'complaint-service', ...fields }));
}

function requestLogger(req, res, next) {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/health') return; // ALB health checks would drown out real traffic
    log({
      level: res.statusCode >= 500 ? 'error' : 'info', msg: 'request', requestId: req.id,
      method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode,
      durationMs: Number((process.hrtime.bigint() - start) / 1000000n), userId: req.user && req.user.sub,
    });
  });
  next();
}

module.exports = { log, requestLogger };
