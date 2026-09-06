/**
 * 兩岸交流活動彙整追蹤器 — 獨立抓取腳本（GitHub Actions 版）
 * -------------------------------------------------
 * 這個腳本原本是 Firebase Cloud Function，但排程函式（Scheduled Functions）
 * 一定要 Blaze（用量計費）方案才能用，即使實際費用是 $0 也需要先綁信用卡。
 * 為了完全避開這個門檻，改成用 GitHub Actions 的免費排程功能來執行這支腳本，
 * 執行時直接用「服務帳戶金鑰」透過 firebase-admin 寫入 Firestore——
 * Firestore 資料庫本身跟 Hosting 看板網頁都在 Spark（免費）方案額度內，
 * 完全不需要 Blaze、不需要綁信用卡。
 *
 * 運作原理：
 *   大陸官方網站（gwytb.gov.cn、各省市台辦）多半有反爬機制，且部分列表頁
 *   是前端 JS 動態載入，單純用 fetch 抓 HTML 常常抓不到內容、或直接被擋。
 *   改用 Google News 的公開 RSS 搜尋端點作為主要抓取來源，因為這是伺服器對
 *   伺服器的請求（GitHub Actions 執行環境直接發送，不透過任何公開代理服務），
 *   不會遇到瀏覽器版本那種代理服務被 Google 封鎖的問題。
 *
 * 已知限制：
 *   1. 抓到的是「新聞報導」，不是官方活動行事曆本身。文章發布日期 ≠ 活動實際
 *      舉辦日期，確切日期仍需人工開啟連結確認。
 *   2. 每組關鍵字查詢上限約 100 筆，過舊的報導會被排擠掉。
 *   3. 不保證涵蓋率 100%——地方台辦網站若未被任何新聞轉載，就搜不到；某些
 *      透過私人邀請函/群組流通的行程（未公開發布的）任何工具都抓不到。
 */

const {initializeApp, cert} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const Parser = require("rss-parser");
const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// 從環境變數讀取服務帳戶金鑰（GitHub Actions 會把 GitHub Secret 注入成環境變數）
// ---------------------------------------------------------------------------
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountJson) {
  console.error("找不到環境變數 FIREBASE_SERVICE_ACCOUNT，請確認 GitHub Secret 是否已設定。");
  process.exit(1);
}
const serviceAccount = JSON.parse(serviceAccountJson);

initializeApp({credential: cert(serviceAccount)});
const db = getFirestore();
const parser = new Parser({timeout: 15000});

// ---------------------------------------------------------------------------
// 直接爬取的中國官方網站清單 — 實測過「抓得到、非 JS 動態載入」的網站，跟
// gwytb.gov.cn（國台辦本站，實測會被擋、連不上）不同，省市級台辦網站有些
// 反而沒有這層防護。每個項目對應一個列表頁 + 固定的地區標籤。
// 目前只驗證福建省台辦一個來源，其餘省市可依相同模式擴充，但需要先個別測試
// 該網站是否會擋爬蟲、頁面是否為靜態 HTML。
// ---------------------------------------------------------------------------
const DIRECT_SOURCES = [
  {
    name: "福建省台辦-台海新聞",
    url: "http://www.fj.taiwan.cn/news/",
    region: "福建",
  },
];

async function fetchDirectSource(src) {
  const res = await axios.get(src.url, {
    timeout: 15000,
    headers: {"User-Agent": "Mozilla/5.0 (compatible; CrossStraitTracker/1.0)"},
  });
  const $ = cheerio.load(res.data);
  const results = [];

  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!/t\d{8}_\d+\.htm|\/\d{4}-\d{2}-\d{2}\/\d+\.html/.test(href)) return;

    const raw = $(el).text().trim();
    const m = raw.match(/^(.*?)(\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2})(.*)$/);
    if (!m) return;

    const title = m[1].trim();
    if (!title) return;
    const link = href.startsWith("http") ? href : new URL(href, src.url).toString();

    results.push({title, link, pubDate: m[2].trim(), source: src.name});
  });

  return results;
}

// ---------------------------------------------------------------------------
// 關鍵字清單 — 依需求自行增減。
// ---------------------------------------------------------------------------
const KEYWORDS = [
  "兩岸",
  "陸台",
  "港台",
  "港澳台",
  "台商",
  "台胞",
  "台青",
  "台生",
  "海峽兩岸",
  "國台辦",
  "海協會",
  "海基會",
  "陸委會 兩岸",
  "台聯 通知",
  "兩岸 活動 通知",
  "報名 台青",
  "全國台聯 通知",
  "台青e家",
  "兩岸 研習營",
  "兩岸 研學營",
  "兩岸 領袖營",
  "川渝山水",
  "紋枰協道",
  "蘭臺青少年",
  "兩岸融合發展示範區",
  "臺胞臺屬",
  "走進長三角 台灣青年",
  "兩岸同胞 音樂採風",
  "台灣光復 交流活動",
  "西王母文化交流",
  "醫藥衛生交流協會",
  "兩岸文化發展圓桌會議",
  "閩臺 交流",
  "台胞 考察",
  "台胞 參訪團",
  "魯台",
  "蘇台",
  "浙台",
  "晉台",
  "遼台",
  "鄂台",
  "川台",
  "桂台",
  "赴陸",
  "赴台",
  "兩岸座談",
  "兩岸研習",
  "兩岸宗親",
  "兩岸 參觀",
  "兩岸 參訪",
  "兩岸創業基地",
  "兩岸非遺",
  "兩岸觀光",
  "兩岸合作大會",
  "兩岸論壇",
  "兩岸考察",
  "兩岸聯誼",
];

const REGION_KEYWORDS = [
  "福建", "廈門", "泉州", "福州", "江蘇", "南京", "蘇州", "昆山", "廣東", "廣州", "深圳", "珠海",
  "浙江", "上海", "北京", "河南", "鄭州", "湖北", "武漢", "江西", "南昌", "四川", "成都", "貴州",
  "貴陽", "山東", "陝西", "雲南", "廣西", "湖南", "安徽", "河北", "遼寧", "天津", "重慶", "山西",
  "內蒙古", "寧夏", "海南", "甘肅", "香港", "澳門",
];

const FIELD_KEYWORDS = {
  "青年": ["青年", "青少年", "學生", "研學", "營隊"],
  "體育": ["體育", "籃球", "足球", "棒球", "羽毛球", "乒乓球", "跆拳道", "運動會", "球賽"],
  "文化": ["文化", "民俗", "戲曲", "書畫", "音樂", "舞蹈", "文創", "非遺", "武術"],
  "經貿": ["經貿", "產業", "招商", "投資", "博覽會", "對接會", "峰會", "商會"],
  "宗教信俗": ["媽祖", "宮廟", "進香", "信俗", "祖廟"],
  "學術": ["論壇", "研討會", "學術", "研究會"],
  "婚姻家庭": ["婚姻", "家庭", "聯誼"],
  "影視娛樂": ["演唱會", "電影", "綜藝", "戲劇", "明星", "影展", "歌手"],
  "教育": ["交換生", "遊學", "校際", "招生", "獎學金", "姊妹校"],
  "營隊": ["營隊", "夏令營", "冬令營", "研習營"],
  "科技": ["科技", "半導體", "晶片", "AI", "人工智慧"],
  "旅遊": ["旅遊", "觀光", "自由行", "團客"],
};

const EXCLUDE_KEYWORDS = [
  "時論", "社論", "投書", "觀點投書", "評論員", "民調", "評論", "梅花評論",
  "國民黨", "民進黨", "總統大選", "立委選舉", "罷免",
  "標普", "信評", "主權評等", "主權評級", "貿易戰", "關稅", "股市", "匯率",
  "普丁", "普京", "俄羅斯", "俄媒", "俄稱", "落馬", "稀土", "國防動員法", "台海衝突",
  "美東", "美西", "東西兩岸", "美鐵", "中美貿易", "貿易休戰",
  "出訪", "上合峰會", "ECFA",
  "时论", "社论", "投书", "观点投书", "评论员", "民调", "评论", "梅花评论",
  "国民党", "民进党", "总统大选", "立委选举", "罢免",
  "标普", "信评", "主权评等", "主权评级", "贸易战", "关税", "股市", "汇率",
  "俄罗斯", "俄媒", "俄称", "落马", "国防动员法", "台海冲突",
  "美东", "美西", "东西两岸", "美铁", "中美贸易", "贸易休战",
  "出访", "上合峰会",
  "新闻发布会文字实录", "重要讲话", "重要指示", "重要文章", "党建思想",
];

function isExcluded(text){
  return EXCLUDE_KEYWORDS.some((k) => text.includes(k));
}

const TRUSTED_SERIES = ["川渝山水", "紋枰協道", "蘭臺青少年"];

const REQUIRE_KEYWORDS = [
  "交流", "參訪", "訪問", "互訪", "來訪", "座談", "論壇", "研討會", "研學", "研習營",
  "營隊", "領袖營", "通知", "報名", "招募", "合作", "締結", "簽署", "協議",
  "開幕", "揭牌", "啟動", "儀式", "舉辦", "舉行", "登場", "博覽會", "對接會",
  "洽談會", "懇談會", "聯誼", "考察團", "踏查", "交易會", "峰會", "招商",
  "参访", "访问", "互访", "来访", "座谈", "论坛", "研讨会", "研学", "研习营",
  "营队", "领袖营", "报名", "招募", "缔结", "签署", "协议",
  "开幕", "启动", "仪式", "举办", "举行", "登场", "博览会", "对接会",
  "洽谈会", "恳谈会", "联谊", "考察团", "踏查", "交易会", "峰会", "招商", "启用",
];

function isTrustedSeries(kw){
  return TRUSTED_SERIES.includes(kw);
}
function hasEventSignal(text){
  return REQUIRE_KEYWORDS.some((k) => text.includes(k));
}
function guessTags(text, list) {
  return list.filter((k) => text.includes(k));
}
function guessFields(text) {
  const hit = [];
  for (const [field, kws] of Object.entries(FIELD_KEYWORDS)) {
    if (kws.some((k) => text.includes(k))) hit.push(field);
  }
  return hit;
}
function hashId(link) {
  return crypto.createHash("sha1").update(link).digest("hex");
}

// 用 AbortController 實作真正會生效的逾時機制 —— rss-parser 內建的 timeout
// 選項在某些網路狀況下不會確實中斷連線，導致整個腳本卡住不會結束，改成自己
// 控制 fetch + 逾時，逾時後保證會拋出錯誤，讓迴圈可以繼續跑下一組關鍵字。
async function fetchTextWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {signal: controller.signal});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAndStore() {
  let totalNew = 0;
  const results = [];

  for (let i = 0; i < KEYWORDS.length; i++) {
    const kw = KEYWORDS[i];
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(kw)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    console.log(`[${i + 1}/${KEYWORDS.length}] 查詢「${kw}」…`);
    try {
      const xml = await fetchTextWithTimeout(url, 10000);
      const feed = await parser.parseString(xml);
      console.log(`  → 取得 ${feed.items.length} 筆結果`);
      for (const item of feed.items) {
        if (!item.link) continue;
        const id = hashId(item.link);
        const docRef = db.collection("activities").doc(id);
        const existing = await docRef.get();
        if (existing.exists) continue;

        const text = `${item.title || ""} ${item.contentSnippet || ""}`;
        if (isExcluded(text)) continue;
        if (!isTrustedSeries(kw) && !hasEventSignal(text)) continue;
        const sourceMatch = (item.title || "").match(/-\s*([^-]+)$/);

        const record = {
          title: item.title || "",
          link: item.link,
          source: sourceMatch ? sourceMatch[1].trim() : "",
          pubDate: item.pubDate || null,
          fetchedAt: FieldValue.serverTimestamp(),
          matchedKeyword: kw,
          regions: guessTags(text, REGION_KEYWORDS),
          fields: guessFields(text),
          status: "unverified",
        };
        await docRef.set(record);
        totalNew++;
        results.push(record.title);
      }
    } catch (err) {
      console.error(`關鍵字「${kw}」抓取失敗:`, err.message);
    }
  }

  console.log(`Google News 關鍵字抓取完成，新增 ${totalNew} 筆。`);

  for (const src of DIRECT_SOURCES) {
    try {
      const items = await fetchDirectSource(src);
      for (const it of items) {
        const id = hashId(it.link);
        const docRef = db.collection("activities").doc(id);
        const existing = await docRef.get();
        if (existing.exists) continue;

        if (isExcluded(it.title)) continue;
        if (!hasEventSignal(it.title)) continue;

        const record = {
          title: it.title,
          link: it.link,
          source: src.name,
          pubDate: it.pubDate || null,
          fetchedAt: FieldValue.serverTimestamp(),
          matchedKeyword: `直接爬取:${src.name}`,
          regions: Array.from(new Set([src.region, ...guessTags(it.title, REGION_KEYWORDS)])),
          fields: guessFields(it.title),
          status: "unverified",
        };
        await docRef.set(record);
        totalNew++;
        results.push(record.title);
      }
    } catch (err) {
      console.error(`直接爬取來源「${src.name}」失敗:`, err.message);
    }
  }

  console.log(`本次執行完成，總計新增 ${totalNew} 筆。`);
  console.log(`新增項目範例：`, results.slice(0, 10));
  return {totalNew, sample: results.slice(0, 10)};
}

// 安全網：萬一還是有地方卡住，5 分鐘後強制結束整支腳本，避免 Actions 空轉浪費額度
const watchdog = setTimeout(() => {
  console.error("執行超過 5 分鐘，強制中止（安全網逾時）");
  process.exit(1);
}, 5 * 60 * 1000);

fetchAndStore()
    .then((r) => {
      clearTimeout(watchdog);
      console.log("執行成功", r);
      process.exit(0);
    })
    .catch((err) => {
      clearTimeout(watchdog);
      console.error("執行失敗", err);
      process.exit(1);
    });
