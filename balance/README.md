# Startup Lab v0.3 バランス設計・シミュレーション

このフォルダは計算モデルの設計・検証一式です。検証したW1をゲーム本体v0.3へ反映済みです。シミュレーションはゲームとは独立に実行できます。

設計書は `docs/BALANCE-DESIGN-v0.3.md` を参照してください。

## 再実行

Node.js 22以上、追加ライブラリ不要。解凍フォルダで実行します。

```sh
node balance/simulate.js
node --test balance/model.test.js
```

開発フォルダでは `npm run simulate:balance` でも同じです。このMacでnodeが見つからない場合は、`node` を `/Users/nonaka/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` に置き換えてください。

集計結果は `balance/results/` にJSONで保存します。乱数seedを固定したので、同じコード・条件で再現できます。実行すると集計結果を上書きします。授業データは読み書きしません。

線形の市場配分効果を使った見送り候補V11の再検証：

```sh
node balance/simulate.js --candidate=V11
```

この場合は `balance/results/V11/` に保存します。

## 内容

- `balance/model.js`：44候補と推奨案W1、顧客配分・損益計算・相手固定時の最適反応探索。
- `balance/simulate.js`：候補校正、スクリーニング、独立seedでの旧新版比較、全1%刻みの配分探索、3ラウンドの変更テスト。
- `balance/model.test.js`：8件の計算・人数保存・分岐点テスト。
- `lib/model-v2.js`：比較対象のv0.2計算モデルのスナップショット。
- `balance/results/`：集計結果。旧版・新版は同じ選択を与えて比較。

広告収入・課金率・顧客選好は、すべて授業用の仮定です。実際の市場推定や、生徒の行動を予測するモデルではありません。
