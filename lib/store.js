import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

export function createStore(directory) {
  const dir = resolve(directory);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'games.json');
  // 壊れた保存データは空で上書きせず、起動を止めて復旧可能にする。
  let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { games: {} };
  if (!state.games || typeof state.games !== 'object') throw new Error('保存データの形式が不正です。');
  return {
    read: () => state,
    transaction(action) {
      const next = structuredClone(state);
      const result = action(next);
      writeFileSync(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
      renameSync(file + '.tmp', file);
      state = next;
      return result;
    },
  };
}
