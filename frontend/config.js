// Runtime configuration. Locally this stays empty and app.js falls back to
// the three localhost ports. On AWS, Terraform uploads its own config.js to
// the frontend bucket with apiUrl set to the API Gateway URL.
window.CCMS_CONFIG = {};
