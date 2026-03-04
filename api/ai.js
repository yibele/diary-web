module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "只支持 POST 请求" });
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";

  if (!apiKey) {
    return sendJson(res, 500, { error: "服务端没有配置 DASHSCOPE_API_KEY" });
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }

  const task = String(payload?.task || "extract");
  const title = String(payload?.title || "").trim();
  const content = String(payload?.content || "").trim();

  if (!content) {
    return sendJson(res, 400, { error: "缺少日记内容" });
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
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "你是一个中文生活记录助手，严格按要求输出。",
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
      return sendJson(res, upstream.status, {
        error: data?.error?.message || data?.message || "上游模型请求失败",
      });
    }

    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      return sendJson(res, 502, { error: "模型没有返回内容" });
    }

    if (task === "extract") {
      const extracted = parseExtractResult(text);
      if (!extracted) {
        return sendJson(res, 502, { error: "提取结果解析失败", text });
      }
      return sendJson(res, 200, { extracted, text });
    }

    return sendJson(res, 200, { text });
  } catch {
    return sendJson(res, 500, { error: "服务异常，请稍后再试" });
  }
};

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function buildPrompt(task, title, content) {
  const head = title ? `标题：${title}\n` : "";

  if (task === "extract") {
    return [
      "请从下面这段日记中提取花费和体重，严格只返回 JSON，不要解释。",
      "JSON 格式必须是：",
      '{"summary":"...","expenses":[{"item":"午饭","amount":25.5}],"weight_kg":63.4}',
      "要求：",
      "1) expenses 是数组，没有就返回 []。",
      "2) amount 必须是数字，不要加单位。",
      "3) weight_kg 没有就返回 null。",
      "4) summary 用一句话概括今天记录。",
      "",
      `${head}正文：${content}`,
    ].join("\n");
  }

  if (task === "polish") {
    return [
      "请润色下面这篇日记，保留原意，不编造事实。",
      "直接输出润色后的正文，不要解释。",
      "",
      `${head}正文：${content}`,
    ].join("\n");
  }

  return [
    "请总结下面这篇日记，用 3-5 条要点，再给一句建议。",
    "",
    `${head}正文：${content}`,
  ].join("\n");
}

function parseExtractResult(text) {
  const jsonText = findJsonText(text);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText);

    const expenses = Array.isArray(parsed.expenses)
      ? parsed.expenses
          .map((item) => ({
            item: String(item?.item || "日记提取花费").trim() || "日记提取花费",
            amount: Number(item?.amount),
          }))
          .filter((item) => Number.isFinite(item.amount) && item.amount >= 0)
          .map((item) => ({ ...item, amount: Number(item.amount.toFixed(2)) }))
      : [];

    let weightKg = null;
    const w = Number(parsed.weight_kg);
    if (Number.isFinite(w) && w > 20 && w < 300) {
      weightKg = Number(w.toFixed(1));
    }

    return {
      summary: String(parsed.summary || "已自动提取。"),
      expenses,
      weight_kg: weightKg,
    };
  } catch {
    return null;
  }
}

function findJsonText(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return "";
  }

  if (raw.startsWith("{")) {
    return raw;
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return raw.slice(first, last + 1);
  }

  return "";
}
