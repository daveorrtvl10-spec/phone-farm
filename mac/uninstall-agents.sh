#!/bin/zsh
for p in appium wda-service worker web; do
  launchctl bootout gui/$(id -u)/com.phonefarm.$p 2>/dev/null && echo "stopped $p"
  rm -f ~/Library/LaunchAgents/com.phonefarm.$p.plist
done
