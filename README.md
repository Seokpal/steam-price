# Steam 比价：乌克兰区 vs 国区

网站：https://seokpal.github.io/steam-price/

- 每天自动收集游戏：Steam 热销榜前 2000、国区/乌区所有正在打折的游戏、在线人数前 100
- 每小时自动更新所有游戏的两区价格和汇率（`.github/workflows/update.yml` → `scripts/update.mjs`）
- 新游戏的中文简介、类型、开发商、封面会分批自动补全
- 手动加游戏：在 `data/games.json` 里加 `{"id": AppID}`（没有 `auto` 字段的游戏永远保留）
