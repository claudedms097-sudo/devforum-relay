import fs from "node:fs";

const WEBHOOK = process.env.DISCORD_WEBHOOK;
const FEED = process.env.FEED_URL ?? "https://devforum.roblox.com/c/updates/announcements/36.json";
const BASE = "https://devforum.roblox.com";
const STATE = "state.json";
const HEADERS = { "User-Agent": "devforum-discord-relay/1.0", Accept: "application/json" };

const ICON = "https://devforum.roblox.com/user_avatar/devforum.roblox.com/roblox/120/4100645_2.png";
const CATEGORIES = { 36: "Announcements", 62: "Release Notes", 90: "Community & Events" };

// urutan = prioritas. [tag, emoji, warna]
const STYLES = [
  ["critical-change", "🚨", 0xe74c3c],
  ["weekly-recap", "📰", 0xf1c40f],
  ["beta", "🧪", 0xe67e22],
  ["safety", "🛡️", 0xe74c3c],
  ["policy", "📜", 0xe74c3c],
  ["monetization", "💰", 0x2ecc71],
  ["avatar", "🧍", 0xe91e63],
  ["ai", "🤖", 0x1abc9c],
  ["engine", "⚙️", 0x9b59b6],
  ["luau", "🌙", 0x9b59b6],
  ["studio", "🛠️", 0x3498db],
  ["analytics", "📊", 0x3498db],
  ["discovery", "🔎", 0x3498db],
  ["social", "💬", 0x3498db],
];
function style(t, tags) {
  if (/^release notes/i.test(t.title)) return ["📋", 0x95a5a6];
  for (const [tag, emoji, color] of STYLES) if (tags.includes(tag)) return [emoji, color];
  return ["📢", 0x5865f2];
}

const SECTION_ICONS = [
  [/key takeaway|tl;dr|summary/i, "🔑"],
  [/what'?s new|introduc|announc/i, "✨"],
  [/\bhow\b|get started|set ?up|\busage\b|\btry\b/i, "🚀"],
  [/timeline|rollout|availab|\bwhen\b|schedule|\bdate/i, "📅"],
  [/known|limit|\bnotes?\b|caveat|warning|important/i, "⚠️"],
  [/\bfaq\b|question/i, "❓"],
  [/feedback|let us know/i, "💬"],
];
const icon = txt => SECTION_ICONS.find(([re]) => re.test(txt))?.[1] ?? "▫️";

const decode = s => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const abs = u => (u.startsWith("//") ? "https:" + u : u.startsWith("/") ? BASE + u : u);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function toMarkdown(h) {
  const s = h
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, "")
    .replace(/<div class="meta">[\s\S]*?<\/div>/g, "")
    .replace(/<video[\s\S]*?<\/video>/g, "")
    .replace(/<aside[^>]*data-onebox-src="([^"]+)"[^>]*>[\s\S]*?<\/aside>/g, (_, u) => `\n🔗 ${decode(u)}\n`)
    .replace(/<table[\s\S]*?<\/table>/g, tb => "\n```\n" + [...tb.matchAll(/<tr[\s\S]*?<\/tr>/g)]
      .map(r => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)]
        .map(c => c[1].replace(/<[^>]+>/g, "").trim()).join(" | ")).join("\n") + "\n```\n")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, (_, c) => {
      const lang = c.match(/class="lang-(\w+)"/)?.[1] ?? "";
      return "\n```" + lang + "\n" + c.replace(/<[^>]+>/g, "").trim() + "\n```\n";
    })
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/g, (_, q) =>
      "\n" + toMarkdown(q).split("\n").map(l => "> " + l).join("\n") + "\n")
    .replace(/<a [^>]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, inner) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      if (!text) return "";
      const u = abs(decode(href));
      return text === href || text === u ? u : `[${text}](${u})`;
    })
    .replace(/<img[^>]*>/g, "")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g, (_, n, inner) => {
      const txt = inner.replace(/<[^>]+>/g, "").trim();
      return `\n\n${n <= 2 ? "##" : "###"} ${icon(txt)} ${txt}\n`;
    })
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/g, "**$2**")
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/g, "*$2*")
    .replace(/<(s|del)>([\s\S]*?)<\/\1>/g, "~~$2~~")
    .replace(/<code>([\s\S]*?)<\/code>/g, "`$1`")
    .replace(/<hr\s*\/?>/g, "\n──────────\n")
    .replace(/<li[^>]*>/g, "• ")
    .replace(/<\/(li|ul|ol|tr)>/g, "\n")
    .replace(/<\/(p|div|h\d)>/g, "\n\n")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return decode(s).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function clip(text, url) {
  const LIMIT = 3400; // batas total embed Discord = 6000 karakter
  if (text.length <= LIMIT) return text;
  let cut = text.slice(0, LIMIT);
  const p = cut.lastIndexOf("\n\n");
  cut = (p > 1200 ? cut.slice(0, p) : cut.replace(/\s+\S*$/, "")).trimEnd();
  if ((cut.match(/```/g) ?? []).length % 2) cut += "\n```";
  return cut + `\n\n…\n**[📖 Baca selengkapnya di DevForum](${url})**`;
}

async function getPost(id) {
  const r = await fetch(`${BASE}/t/${id}.json`, { headers: HEADERS });
  if (!r.ok) return null;
  const p = (await r.json()).post_stream.posts[0];
  const images = [...new Set([...p.cooked.matchAll(/<img[^>]*>/g)]
    .map(m => m[0])
    .filter(t => !/class="[^"]*\b(emoji|avatar)\b/.test(t))
    .map(t => t.match(/src="([^"]+)"/)?.[1])
    .filter(Boolean)
    .map(u => abs(decode(u)))
    .filter(u => /^https?:/.test(u) && !/\.svg(\?|$)/i.test(u)))];
  return {
    text: toMarkdown(p.cooked),
    images,
    hasVideo: /<video/i.test(p.cooked),
    name: p.name || p.username,
    username: p.username,
    avatar: p.avatar_template ? abs(p.avatar_template.replace("{size}", "120")) : ICON,
    staff: p.primary_group_name === "Roblox_Staff" || p.staff === true,
  };
}

async function send(payload) {
  let r;
  for (let i = 0; i < 3; i++) {
    r = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.status !== 429) return r;
    const wait = (await r.json().catch(() => ({}))).retry_after ?? 2;
    await sleep(wait * 1000 + 250);
  }
  return r;
}

const res = await fetch(`${FEED}?order=created`, { headers: HEADERS });
if (!res.ok) throw new Error(`DevForum HTTP ${res.status}`);
const topics = (await res.json()).topic_list.topics.filter(t => !t.pinned);

// run pertama: cuma catat baseline, jangan kirim topik lama
if (!fs.existsSync(STATE)) {
  fs.writeFileSync(STATE, JSON.stringify({ lastId: Math.max(...topics.map(t => t.id)) }));
  process.exit(0);
}

const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
const fresh = topics.filter(t => t.id > state.lastId).sort((a, b) => a.id - b.id);

for (const t of fresh) {
  const url = `${BASE}/t/${t.slug}/${t.id}`;
  const tags = (t.tags ?? []).map(x => x.name ?? x).filter(n => !n.startsWith("topic-"));
  const [emoji, color] = style(t, tags);
  const category = CATEGORIES[t.category_id] ?? "DevForum";
  const post = await getPost(t.id);

  let text = clip(post?.text ?? "", url);
  if (post?.hasVideo) text += "\n\n🎬 *Post ini juga berisi video, tonton di DevForum.*";

  const fields = [{ name: "📂 Kategori", value: category, inline: true }];
  if (tags.length) fields.push({ name: "🏷️ Tag", value: tags.map(x => `\`${x}\``).join(" "), inline: true });
  fields.push({ name: "💬 Diskusi", value: `[Buka thread](${url})`, inline: true });

  const images = post?.images ?? [];
  const main = {
    author: post ? {
      name: post.name + (post.staff ? " • Roblox Staff" : ""),
      url: `${BASE}/u/${post.username}`,
      icon_url: post.avatar,
    } : undefined,
    title: `${emoji} ${t.title}`.slice(0, 256),
    url,
    description: text || undefined,
    color,
    fields,
    image: images[0] ? { url: images[0] } : undefined,
    footer: { text: `Roblox Developer Forum • ${category}`, icon_url: ICON },
    timestamp: t.created_at,
  };
  // embed dengan url yang sama otomatis digabung Discord jadi galeri gambar
  const gallery = images.slice(1, 4).map(u => ({ url, image: { url: u } }));

  let r = await send({
    username: "Roblox DevForum",
    avatar_url: ICON,
    content: `${emoji} **Post baru di DevForum!**`,
    embeds: [main, ...gallery],
  });
  if (r.status === 400) {
    console.error("Embed ditolak, kirim versi sederhana:", await r.text());
    r = await send({ username: "Roblox DevForum", avatar_url: ICON, content: `${emoji} **${t.title}**\n${url}` });
  }
  if (!r.ok) { console.error("Discord error", r.status, await r.text()); break; } // dicoba lagi di run berikutnya

  state.lastId = t.id;
  fs.writeFileSync(STATE, JSON.stringify(state));
  await sleep(1500);
}
