#!/bin/zsh
# Installs the four phone-farm launchd agents for the current user.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs ~/Library/LaunchAgents
for f in mac/launchd/*.plist; do
  name=$(basename "$f")
  sed "s|__HOME__|$HOME|g" "$f" > ~/Library/LaunchAgents/"$name"
  launchctl bootout gui/$(id -u)/"${name%.plist}" 2>/dev/null || true
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/"$name"
  echo "loaded ${name%.plist}"
done
echo "logs: $(pwd)/logs/  dashboard: http://127.0.0.1:3000"
