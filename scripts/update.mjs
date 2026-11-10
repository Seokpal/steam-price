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

// 游戏资料（中文名、简介、类型、开发商、年份、封面）：只给新加的游戏查一次，之后缓存
const clean = s => (s || "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
async function details(prev) {
  const out = {};
  for (const g of GAMES) {
    const cached = prev?.[g.id]?.img;
    if (cached && g.zh && g.intro) { out[g.id] = cached; continue; }
    try {
      const j = await getJSON(`https://store.steampowered.com/api/appdetails?appids=${g.id}&l=schinese&cc=cn`);
      const d = j?.[g.id]?.data;
      out[g.id] = d?.header_image || cached || null;
      if (d) {
        g.zh ||= d.name;
        g.intro ||= clean(d.short_description).slice(0, 90);
        g.genre ||= (d.genres || []).slice(0, 3).map(x => x.description).join(" · ");
        g.dev ||= (d.developers || [])[0] || "";
        g.year ||= (clean(d.release_date?.date).match(/(19|20)\d\d/) || [""])[0];
      }
      if (!g.en) {
        await sleep(1600);
        const e = await getJSON(`https://store.steampowered.com/api/appdetails?appids=${g.id}&l=english&filters=basic`);
        g.en = e?.[g.id]?.data?.name || "";
      }
    } catch { out[g.id] = cached || null; }
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
const imgs = await details(prev);
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
