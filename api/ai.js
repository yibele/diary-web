module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "只支持 POST 请求" }));
    return;
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";

  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "服务端没有配置 DASHSCOPE_API_KEY" }));
    return;
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }

  const task = String(payload?.task || "summary");
  const title = String(payload?.title || "").trim();
  const content = String(payload?.content || "").trim();

  if (!content) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "缺少日记内容" }));
    return;
  }

  const prompt = buildPrompt(task, title, content);

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.DASHSCOPE_MODEL || "qwen-plus",
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content: "你是一个温和、简洁、会写中文的生活日记助手。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: data?.error?.message || data?.message || "上游模型请求失败" }));
      return;
    }

    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "模型没有返回内容" }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ text }));
  } catch {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "服务异常，请稍后再试" }));
  }
};

function buildPrompt(task, title, content) {
  const head = title ? `标题：${title}\n` : "";

  if (task === "polish") {
    return [
      "请润色下面这篇日记：",
      "1. 保留原意，不要编造事实。",
      "2. 语言自然、真诚、清晰。",
      "3. 输出直接给润色后的正文，不要加解释。",
      "",
      `${head}正文：${content}`,
    ].join("\n");
  }

  return [
    "请总结下面这篇日记：",
    "1. 用 3-5 条要点总结今天发生的事。",
    "2. 再给一句简短建议（20字以内）。",
    "3. 输出中文，不要加多余前缀。",
    "",
    `${head}正文：${content}`,
  ].join("\n");
}
