// 由 GitHub Actions 运行。
//  MODE=discover（每天一次）：自动收集游戏 —— 热销榜、两区所有在打折的游戏、在线人数最多的游戏
//  每次都会：抓取所有游戏在乌克兰区(cc=ua)和国区(cc=cn)的价格 + 汇率，写入 data/prices.json
//  另外每次给最多 DETAILS_PER_RUN 款还没有简介的游戏补全资料（中文简介、类型、开发商、年份、封面）
// 本地运行：MODE=discover node scripts/update.mjs   （需要 Node 18+）
import fs from "node:fs/promises";

const MODE = process.env.MODE || "prices";
const DETAILS_PER_RUN = +(process.env.DETAILS_PER_RUN || 150);
const OUT = "data/prices.json";
let GAMES = JSON.parse(await fs.readFile("data/games.json", "utf8"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HEADERS = { "User-Agent": "steam-price-compare (github pages)" };
const today = new Date().toISOString().slice(0, 10);

async function get(url, type = "json", tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.status === 429 || r.status === 403) { await sleep(60000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(r.status + " " + url);
      return type === "json" ? await r.json() : await r.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(4000 * (i + 1));
    }
  }
  throw new Error("rate limited: " + url);
}

// ---------- 自动收集游戏 ----------
async function searchPages(params, max) {
  const found = [];
  for (let start = 0; start < max; start += 100) {
    let j;
    try { j = await get(`https://store.steampowered.com/search/results/?query&start=${start}&count=100&category1=998&infinite=1&l=schinese&${params}`); }
    catch (e) { console.log("search failed", params, start, e.message); break; }
    const html = j?.results_html || "";
    const rows = html.split("search_result_row").slice(1);
    for (const row of rows) {
      const id = (row.match(/data-ds-appid="(\d+)"/) || [])[1];   // 捆绑包的 appid 是逗号列表，不匹配，自动跳过
      if (!id) continue;
      const title = (row.match(/<span class="title">([^<]*)<\/span>/) || [])[1] || "";
      const cap = (row.match(/<img src="([^"]+)"/) || [])[1] || "";
      found.push({ id: +id, zh: title.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"), cap });
    }
    if (rows.length < 100 || start + 100 >= (j?.total_count || 0)) break;
    await sleep(2500);
  }
  return found;
}

async function discover() {
  const lists = [];
  lists.push(await searchPages("filter=topsellers&cc=cn", 2000));   // 热销榜前 2000
  lists.push(await searchPages("specials=1&cc=cn", 3000));          // 国区所有打折
  lists.push(await searchPages("specials=1&cc=ua", 3000));          // 乌区所有打折
  try {                                                              // 在线人数前 100
    const j = await get("https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/");
    lists.push((j?.response?.ranks || []).map(r => ({ id: r.appid })));
  } catch (e) { console.log("most played failed", e.message); }

  const byId = new Map(GAMES.map(g => [g.id, g]));
  let added = 0;
  for (const list of lists) for (const f of list) {
    const g = byId.get(f.id);
    if (g) { if (g.auto) g.seen = today; if (!g.cap && f.cap) g.cap = f.cap; continue; }
    const ng = { id: f.id, zh: f.zh || "", cap: f.cap || "", auto: true, seen: today };
    byId.set(f.id, ng); GAMES.push(ng); added++;
  }
  // 自动加入、但 45 天没再出现在任何榜单里的游戏移除（手动加的永远保留）
  const cutoff = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
  const before = GAMES.length;
  GAMES = GAMES.filter(g => !g.auto || (g.seen || today) >= cutoff);
  console.log(`discover: +${added} new, -${before - GAMES.length} stale, total ${GAMES.length}`);
}

// ---------- 价格 ----------
async function prices(cc) {
  const out = {};
  const ids = GAMES.map(g => g.id);
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    try {
      const j = await get(`https://store.steampowered.com/api/appdetails?appids=${batch.join(",")}&cc=${cc}&filters=price_overview`);
      for (const id of batch) {
        const d = j?.[id];
        if (!d) continue;                                  // 没返回：保留旧价格
        const p = d.data?.price_overview;
        out[id] = p ? [p.initial, p.final, p.discount_percent] : null;
      }
    } catch (e) { console.log("price batch failed", cc, i, e.message); }
    await sleep(1500);
  }
  return out;
}

// ---------- 资料补全 ----------
const clean = s => (s || "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
async function details(prev) {
  const imgs = {};
  let n = 0;
  for (const g of GAMES) {
    imgs[g.id] = prev?.[g.id]?.img || null;
    if ((g.intro !== undefined && imgs[g.id]) || n >= DETAILS_PER_RUN) continue;
    n++;
    try {
      const j = await get(`https://store.steampowered.com/api/appdetails?appids=${g.id}&l=schinese&cc=cn`);
      const d = j?.[g.id]?.data;
      if (d) {
        imgs[g.id] = d.header_image || imgs[g.id];
        g.zh ||= d.name;
        g.intro ??= clean(d.short_description).slice(0, 90);
        g.genre ||= (d.genres || []).slice(0, 3).map(x => x.description).join(" · ");
        g.dev ||= (d.developers || [])[0] || "";
        g.year ||= (clean(d.release_date?.date).match(/(19|20)\d\d/) || [""])[0];
      } else { g.intro ??= ""; }
      if (!g.en) {
        await sleep(1500);
        const e = await get(`https://store.steampowered.com/api/appdetails?appids=${g.id}&l=english&filters=basic`);
        g.en = e?.[g.id]?.data?.name || "";
      }
    } catch (e) { console.log("details failed", g.id, e.message); }
    await sleep(1500);
  }
  console.log("details filled:", n);
  return imgs;
}

async function rate() {
  try {
    const j = await get("https://open.er-api.com/v6/latest/UAH");
    if (j?.rates?.CNY) return { UAH_CNY: j.rates.CNY, src: "open.er-api.com " + (j.time_last_update_utc || "") };
  } catch {}
  return null;
}

// ---------- 主流程 ----------
let prevFile = {};
try { prevFile = JSON.parse(await fs.readFile(OUT, "utf8")); } catch {}
const prev = prevFile.prices || {};

if (MODE === "discover") await discover();

const ua = await prices("ua");
const cn = await prices("cn");
const imgs = await details(prev);
const r = (await rate()) || prevFile.rate;

const result = { updated: new Date().toISOString(), rate: r, prices: {} };
for (const g of GAMES) {
  result.prices[g.id] = {
    ua: g.id in ua ? ua[g.id] : (prev[g.id]?.ua ?? null),
    cn: g.id in cn ? cn[g.id] : (prev[g.id]?.cn ?? null),
    img: imgs[g.id] || null,
  };
}
await fs.writeFile(OUT, JSON.stringify(result));
await fs.writeFile("data/games.json", JSON.stringify(GAMES));
const sale = Object.values(result.prices).filter(p => (p.ua && p.ua[2]) || (p.cn && p.cn[2])).length;
console.log(`done: ${GAMES.length} games, ${sale} on sale, rate ${r?.UAH_CNY}`);
