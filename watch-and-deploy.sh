#!/bin/bash
# Auto-push watcher for kccp-attendance
# Watches for file changes and pushes to GitHub automatically

REPO="/Users/shrla/downloads/kccp-attendance"
INTERVAL=3  # check every 3 seconds

echo "👀 Watching $REPO for changes..."
echo "   Any file edits will auto-commit and push to GitHub."
echo "   Press Ctrl+C to stop."
echo ""

cd "$REPO"

while true; do
  # Check if there are any changes (tracked or untracked, excluding gitignored)
  CHANGES=$(git status --porcelain 2>/dev/null | grep -v "^?? \s*$" | head -1)

  if [ -n "$CHANGES" ]; then
    echo "📝 Change detected — pushing..."
    git add -A
    git commit -m "auto-update $(date '+%Y-%m-%d %H:%M:%S')"
    git push
    if [ $? -eq 0 ]; then
      echo "✅ Pushed successfully at $(date '+%H:%M:%S')"
    else
      echo "❌ Push failed — check your network or token"
    fi
  fi

  sleep $INTERVAL
done
