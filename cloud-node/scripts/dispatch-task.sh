#!/usr/bin/env bash
# Quick task dispatch from any terminal (iPhone SSH, laptop, etc.)
# Usage: ./dispatch-task.sh "Fix the auth bug in credit-repair-agent"
# Usage: ./dispatch-task.sh "Deploy content-extractor update" --repo https://github.com/Browningdigital/claude-mem
#
# Requires: DISPATCHER_URL and TASK_AUTH_TOKEN env vars
#   export DISPATCHER_URL=https://cloud-node-dispatcher.devin-b58.workers.dev
#   export TASK_AUTH_TOKEN=<your-token>

set -euo pipefail

PROMPT="${1:?Usage: dispatch-task.sh \"your prompt\" [--repo URL] [--branch NAME] [--timeout MINUTES]}"
shift

# Parse optional args
REPO=""
BRANCH=""
TIMEOUT=30
SKIP_PERMS="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        --repo) REPO="$2"; shift 2 ;;
        --branch) BRANCH="$2"; shift 2 ;;
        --timeout) TIMEOUT="$2"; shift 2 ;;
        --skip-permissions) SKIP_PERMS="true"; shift ;;
        *) shift ;;
    esac
done

DISPATCHER_URL="${DISPATCHER_URL:?Set DISPATCHER_URL env var}"
TASK_AUTH_TOKEN="${TASK_AUTH_TOKEN:?Set TASK_AUTH_TOKEN env var}"

# Build JSON body
BODY=$(jq -n \
    --arg prompt "$PROMPT" \
    --arg repo "$REPO" \
    --arg branch "$BRANCH" \
    --argjson timeout "$TIMEOUT" \
    --argjson skip "$SKIP_PERMS" \
    '{
        prompt: $prompt,
        timeout_minutes: $timeout,
        skip_permissions: $skip
    }
    + (if $repo != "" then {repo: $repo} else {} end)
    + (if $branch != "" then {branch: $branch} else {} end)')

RESULT=$(curl -s -X POST "${DISPATCHER_URL}/task" \
    -H "Authorization: Bearer ${TASK_AUTH_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$BODY")

TASK_ID=$(echo "$RESULT" | jq -r '.task_id // empty')

if [[ -n "$TASK_ID" ]]; then
    echo "Task dispatched: $TASK_ID"
    echo "  Prompt: $PROMPT"
    echo "  Check status: curl -s ${DISPATCHER_URL}/task/${TASK_ID} -H 'Authorization: Bearer <token>'"
else
    echo "ERROR: $RESULT"
    exit 1
fi
