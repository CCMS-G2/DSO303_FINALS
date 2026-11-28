// k6 load test for CCMS (NFR-01 and NFR-02, demo scenario 5).
// Logins are CPU-heavy (bcrypt verification), so they push the Auth Service past the
// 60% CPU scaling target; complaint listing exercises the Complaint Service.
// Stays under the API Gateway throttle (50 req/s) so results show the app, not 429s.
//
// Run: k6 run -e API=https://<id>.execute-api.ap-south-1.amazonaws.com tests/load/k6-load.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const API = __ENV.API;
const HEADERS = { 'Content-Type': 'application/json' };

export const options = {
  stages: [
    { duration: '1m', target: 30 },
    { duration: __ENV.HOLD || '5m', target: 30 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // NFR-01: 95% under 1 second
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const login = http.post(`${API}/api/auth/login`,
    JSON.stringify({ email: 'student@ccms.edu', password: 'Password123!' }), { headers: HEADERS });
  check(login, { 'login 200': (r) => r.status === 200 });
  const token = login.json('token');

  const list = http.get(`${API}/api/complaints`, { headers: { Authorization: `Bearer ${token}` } });
  check(list, { 'list 200': (r) => r.status === 200 });
  sleep(1);
}
