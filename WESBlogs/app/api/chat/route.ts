// app/api/chat/route.ts
import { siteConfig } from '../../../siteConfig'; // 确保这里的路径指向你的 siteConfig

export const runtime = 'edge';

type GeminiErrorPayload = {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: Array<{
      '@type'?: string;
      violations?: Array<{
        quotaMetric?: string;
        quotaId?: string;
      }>;
    }>;
  };
};

function classifyQuotaError(data: GeminiErrorPayload) {
  const error = data.error;
  if (error?.code !== 429 && error?.status !== 'RESOURCE_EXHAUSTED') {
    return 'gemini_api_error';
  }

  const violations = (error.details || [])
    .filter((detail) => detail['@type']?.includes('QuotaFailure'))
    .flatMap((detail) => detail.violations || []);
  const quotaText = violations
    .map((violation) => `${violation.quotaMetric || ''} ${violation.quotaId || ''}`)
    .join(' ')
    .toLowerCase();

  // Daily limits include RPD/TPD and are deliberately checked first.
  if (/daily|perday|per_day|requestsperday|tokensperday|requests_per_day|tokens_per_day/.test(quotaText)) {
    return 'gemini_daily_quota_exhausted';
  }

  if (/minute|perminute|per_minute|rpm|tpm/.test(quotaText)) {
    return 'gemini_short_rate_limit';
  }

  // Do not guess that an underspecified 429 is a daily-limit error.
  return 'gemini_api_error';
}

export async function POST(req: Request) {
  console.log("🚀 [1/5] 路由进入：开始对接 Gemini 脑回路");

  try {
    const { message } = await req.json();

    // 🌟 纯粹靠环境变量读取 API Key
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
      console.error("❌ 找不到 API Key");
      return new Response(JSON.stringify({ error: "Key missing" }), { status: 500 });
    }

    // 调用 siteConfig 的参数
    const modelId = siteConfig.geminiConfig.modelId;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    console.log(`📡 [2/5] 正在呼叫模型: ${modelId}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{
            text: siteConfig.geminiConfig.systemPrompt
          }]
        },
        contents: [{
          parts: [{ text: message }]
        }],
        generationConfig: {
          maxOutputTokens: siteConfig.geminiConfig.maxOutputTokens,
          temperature: siteConfig.geminiConfig.temperature,
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const code = classifyQuotaError(data);
      console.error("🚨 Gemini 拒绝了请求:", JSON.stringify({ status: response.status, code, error: data.error }));
      return new Response(JSON.stringify({
        error: `模型拒绝访问: ${response.status}`,
        code,
        details: data.error?.message || "未知错误",
      }), { status: response.status });
    }

    console.log("✅ [3/5] Google 成功响应");
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "本喵现在不想理你喵...";

    console.log("🎉 [4/5] 回复已生成，准备传回前端");

    return new Response(JSON.stringify({ reply }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error("🔥 [5/5] 运行时崩溃:", error.message);
    return new Response(JSON.stringify({
      error: error.message,
      code: 'gemini_network_error',
    }), { status: 500 });
  }
}

export async function GET() {
  return new Response(JSON.stringify({ status: "Ready", model: siteConfig.geminiConfig.modelId }), { status: 200 });
}
