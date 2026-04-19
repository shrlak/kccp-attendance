#!/bin/bash
# Direct deploy watcher for kccp-attendance
# Watches for file changes and SCPs directly to Oracle Cloud server

REPO="/Users/shrla/downloads/kccp-attendance"
SSH_KEY="$REPO/ssh-key-2026-04-11.key"
SERVER="ubuntu@158.101.118.21"
REMOTE_DIR="~/kccp-repo"
INTERVAL=3

echo "👀 Watching for changes — deploying directly to server..."
echo "   Press Ctrl+C to stop."
echo ""

LAST_HASH=""

while true; do
  # Hash the files we care about
  CURRENT_HASH=$(md5 -q "$REPO/index.html" "$REPO/server.js" 2>/dev/null)

  if [ "$CURRENT_HASH" != "$LAST_HASH" ] && [ -n "$LAST_HASH" ]; then
    echo "📝 Change detected — deploying at $(date '+%H:%M:%S')..."

    # SCP files to server
    scp -o StrictHostKeyChecking=no -i "$SSH_KEY" \
      "$REPO/index.html" \
      "$REPO/server.js" \
      "$SERVER:$REMOTE_DIR/"

    if [ $? -eq 0 ]; then
      # Restart node
      ssh -o StrictHostKeyChecking=no -i "$SSH_KEY" "$SERVER" \
        "killall node 2>/dev/null || true; nohup node $REMOTE_DIR/server.js > ~/server.log 2>&1 &"
      echo "✅ Deployed successfully at $(date '+%H:%M:%S')"
    else
      echo "❌ Deploy failed — check your network connection"
    fi
  fi

  LAST_HASH="$CURRENT_HASH"
  sleep $INTERVAL
done
