#!/bin/bash
# Change le prix du casque (défaut 95), puis recharge l'onglet du casque dans Chrome.
P=${1:-95}
curl -s -o /dev/null -w "prix → $P € : HTTP %{http_code}\n" -d "prix=$P" http://127.0.0.1:4310/prix
osascript <<'APPLE'
tell application "Google Chrome"
  repeat with w in windows
    repeat with t in tabs of w
      if (URL of t starts with "http://127.0.0.1:4310") and (URL of t does not contain "/iss") then reload t
    end repeat
  end repeat
end tell
APPLE
