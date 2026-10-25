#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
if command -v node >/dev/null 2>&1; then
  exec node server.js
fi
bundled_node="/Users/nonaka/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [[ -x "$bundled_node" ]]; then
  exec "$bundled_node" server.js
fi
print 'Node.js 22以上をインストールしてから、もう一度開いてください。'
read '?Enterキーで閉じます。'
