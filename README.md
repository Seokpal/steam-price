# Steam 比价：乌克兰区 vs 国区

- 网页：`index.html`（GitHub Pages）
- 数据：`data/prices.json` 由 `.github/workflows/update.yml` 每小时调用 Steam 官方接口自动更新
- 加游戏：在 `data/games.json` 里加一行 `{"id": AppID, "zh": "中文名"}`，下次更新会自动抓价格和封面
