import fs from "node:fs";

const WEBHOOK = process.env.DISCORD_WEBHOOK;
const FEED = process.env.FEED_URL ?? "https://devforum.roblox.com/c/updates/announcements/36.json";
const BASE = "https://devforum.roblox.com";
const STATE = "state.json";
const HEADERS = { "User-Agent": "devforum-discord-relay/1.0", Accept: "application/json" };

const decode = s => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const abs = u => (u.startsWith("/") ? BASE + u : u);

function toMarkdown(h) {
  const s = h
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, "")
    .replace(/<div class="meta">[\s\S]*?<\/div>/g, "")
    .replace(/<a [^>]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, inner) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      if (!text) return "";
      return text === href ? href : `[${text}](${abs(decode(href))})`;
    })
    .replace(/<img[^>]*>/g, "")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, (_, c) => "\n```\n" + c.replace(/<[^>]+>/g, "") + "\n```\n")
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g, "\n\n**$1**\n")
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/g, "**$2**")
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/g, "*$2*")
    .replace(/<code>([\s\S]*?)<\/code>/g, "`$1`")
    .replace(/<li[^>]*>/g, "• ")
    .replace(/<\/(p|li|div|tr|ul|ol|blockquote)>/g, "\n")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return decode(s).replace(/\n{3,}/g, "\n\n").trim();
}

async function getPost(id) {
  const r = await fetch(`${BASE}/t/${id}.json`, { headers: HEADERS });
  if (!r.ok) return null;
  const cooked = (await r.json()).post_stream.posts[0].cooked;
  const image = [...cooked.matchAll(/<img[^>]*>/g)]
    .map(m => m[0]).find(t => !/emoji/.test(t))?.match(/src="(https:[^"]+)"/)?.[1];
  return { text: toMarkdown(cooked), image };
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
  const tags = (t.tags ?? []).map(x => x.name ?? x).join(", ");
  const url = `${BASE}/t/${t.slug}/${t.id}`;
  const post = await getPost(t.id);

  let text = post?.text ?? "";
  if (text.length > 3800) {
    text = text.slice(0, 3800).replace(/\s+\S*$/, "") + "…";
    if ((text.match(/```/g) ?? []).length % 2) text += "\n```";
    text += `\n\n[Baca selengkapnya](${url})`;
  }

  const r = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: t.title.slice(0, 256),
        url,
        description: text || undefined,
        image: post?.image ? { url: post.image } : undefined,
        color: 0x5865f2,
        timestamp: t.created_at,
        footer: { text: tags || "DevForum" },
      }],
    }),
  });
  if (!r.ok) { console.error("Discord error", r.status); break; } // dicoba lagi di run berikutnya

  state.lastId = t.id;
  fs.writeFileSync(STATE, JSON.stringify(state));
  await new Promise(r => setTimeout(r, 1500));
}
