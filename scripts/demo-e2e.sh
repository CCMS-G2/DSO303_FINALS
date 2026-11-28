#!/usr/bin/env bash
# End-to-end check of the deployed CCMS (demo scenarios 1 and 2).
# Walks one complaint through the whole lifecycle with a photo, then shows the
# in-app notifications created by the SQS -> Lambda path.
#
# Usage: scripts/demo-e2e.sh            (reads the API URL from Terraform)
#        API=https://... scripts/demo-e2e.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export AWS_PROFILE="${AWS_PROFILE_NAME:-ccms}"
API="${API:-$(terraform -chdir=infra/terraform output -raw api_url)}"
PW='Password123!'
say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
call() { # method path token [body]
  curl -sS -f -X "$1" "$API$2" -H "Authorization: Bearer $3" -H 'Content-Type: application/json' ${4:+-d "$4"}
}
login() {
  curl -sS -f -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$PW\"}" | json 'd["token"]'
}

echo "API: $API"
STUDENT=$(login student@ccms.edu); STAFF=$(login staff@ccms.edu); ADMIN=$(login admin@ccms.edu)
STAFF_ID=$(call GET /api/auth/me "$STAFF" | json 'd.get("id") or d.get("user",{}).get("id")')

say "Student uploads a photo with a pre-signed S3 URL"
IMG=$(mktemp --suffix=.png)
python3 -c "import base64,sys;open(sys.argv[1],'wb').write(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='))" "$IMG"
SIZE=$(stat -c%s "$IMG")
UP=$(call POST /api/complaints/uploads "$STUDENT" "{\"contentType\":\"image/png\",\"size\":$SIZE}")
KEY=$(echo "$UP" | json 'd["key"]'); URL=$(echo "$UP" | json 'd["uploadUrl"]')
curl -sS -f -X PUT "$URL" -H 'Content-Type: image/png' --data-binary @"$IMG" >/dev/null
echo "uploaded $KEY"

say "Student submits the complaint"
CAT=$(call GET /api/categories "$STUDENT" | json 'd[0]["id"]')
LOC=$(call GET /api/locations "$STUDENT" | json 'd[0]["id"]')
C=$(call POST /api/complaints "$STUDENT" \
  "{\"categoryId\":$CAT,\"locationId\":$LOC,\"title\":\"Wi-Fi down in lab\",\"description\":\"No connection since morning\",\"imageKeys\":[\"$KEY\"]}")
ID=$(echo "$C" | json 'd["id"]'); echo "reference $(echo "$C" | json 'd["reference_no"]')"

say "Admin assigns staff";       call PATCH "/api/complaints/$ID/assign" "$ADMIN" "{\"staffId\":\"$STAFF_ID\"}" | json 'd["status"]'
say "Staff starts work";         call PATCH "/api/complaints/$ID/status" "$STAFF" '{"status":"IN_PROGRESS"}' | json 'd["status"]'
say "Staff resolves with note";  call PATCH "/api/complaints/$ID/status" "$STAFF" '{"status":"RESOLVED","note":"Router restarted"}' | json 'd["status"]'
say "Student confirms and closes"; call PATCH "/api/complaints/$ID/status" "$STUDENT" '{"status":"CLOSED"}' | json 'd["status"]'

say "Invalid transition is rejected (expect 409)"
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH "$API/api/complaints/$ID/status" \
  -H "Authorization: Bearer $STUDENT" -H 'Content-Type: application/json' -d '{"status":"IN_PROGRESS"}'

say "Notifications delivered through SQS -> Lambda (waiting 10 s)"
sleep 10
call GET /api/notifications "$STUDENT" | json '"\n".join(n.get("message","") for n in (d if isinstance(d,list) else d.get("notifications",[]))[:5])'
rm -f "$IMG"
