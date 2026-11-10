// 每天由 GitHub Actions 运行：从 Steam 官方接口抓取乌克兰区(cc=ua)和国区(cc=cn)价格，写入 data/prices.json
// 本地运行：node scripts/update.mjs   （需要 Node 18+）
import fs from "node:fs/promises";

const GAMES = JSON.parse(await fs.readFile("data/games.json", "utf8"));
const OUT = "data/prices.json";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA_HEADERS = { "User-Agent": "steam-price-compare (github pages)", "Accept-Language": "zh-CN" };

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA_HEADERS });
      if (r.status === 429) { await sleep(30000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(r.status + " " + url);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(3000 * (i + 1));
    }
  }
}

// 价格：多个 appid 一次查询（filters=price_overview 时支持）
async function prices(cc) {
  const out = {};
  const ids = GAMES.map(g => g.id);
  for (let i = 0; i < ids.length; i += 40) {
    const batch = ids.slice(i, i + 40);
    const j = await getJSON(`https://store.steampowered.com/api/appdetails?appids=${batch.join(",")}&cc=${cc}&filters=price_overview`);
    for (const id of batch) {
      const p = j?.[id]?.data?.price_overview;
      out[id] = p ? [p.initial, p.final, p.discount_percent, p.currency] : null;
    }
    await sleep(1500);
  }
  return out;
}

// 封面图：每款游戏查一次（结果缓存，之后只查新加的游戏）
async function headerImages(prev) {
  const out = {};
  for (const g of GAMES) {
    if (prev?.[g.id]?.img) { out[g.id] = prev[g.id].img; continue; }
    try {
      const j = await getJSON(`https://store.steampowered.com/api/appdetails?appids=${g.id}&l=schinese&cc=cn`);
      const d = j?.[g.id]?.data;
      out[g.id] = d?.header_image || null;
      if (d && !g.zh) g.zh = d.name;
    } catch { out[g.id] = null; }
    await sleep(1600);
  }
  return out;
}

async function rate() {
  try {
    const j = await getJSON("https://open.er-api.com/v6/latest/UAH");
    if (j?.rates?.CNY) return { UAH_CNY: j.rates.CNY, src: "open.er-api.com " + (j.time_last_update_utc || "") };
  } catch {}
  return null;
}

let prev = {};
try { prev = JSON.parse(await fs.readFile(OUT, "utf8")).prices || {}; } catch {}
let prevRate = null;
try { prevRate = JSON.parse(await fs.readFile(OUT, "utf8")).rate; } catch {}

const [ua, cn] = [await prices("ua"), await prices("cn")];
const imgs = await headerImages(prev);
const r = (await rate()) || prevRate;

const result = { updated: new Date().toISOString(), rate: r, prices: {} };
for (const g of GAMES) {
  const u = ua[g.id], c = cn[g.id];
  result.prices[g.id] = {
    ua: u ? u.slice(0, 3) : (prev[g.id]?.ua || null),
    cn: c ? c.slice(0, 3) : (prev[g.id]?.cn || null),
    img: imgs[g.id] || null,
  };
}
await fs.writeFile(OUT, JSON.stringify(result));
await fs.writeFile("data/games.json", JSON.stringify(GAMES, null, 1));
console.log("updated", Object.keys(result.prices).length, "games, rate", r?.UAH_CNY);
