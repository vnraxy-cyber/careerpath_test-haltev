// Supabase Edge Function: analyze-career
// Menerima jawaban quiz, mengirimnya ke Groq AI, lalu mengembalikan analisis karier.
// API key Groq disimpan sebagai secret GROQ_API_KEY (tidak pernah dikirim ke browser).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CATEGORY_LABELS: Record<string, string> = {
  web: "Web Development",
  data: "Data Analyst",
  scientist: "Data Scientist",
  marketing: "Digital Marketing",
  security: "Cyber Security",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
  const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.3-70b-versatile";
  if (!GROQ_API_KEY) return json({ error: "GROQ_API_KEY belum di-set di Supabase Secrets." }, 500);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body harus JSON." }, 400);
  }

  const { attempt_id, name, top_category, scores, answers } = body ?? {};
  if (!attempt_id || !Array.isArray(answers) || answers.length === 0) {
    return json({ error: "attempt_id dan answers wajib diisi." }, 400);
  }

  // Client admin (service role otomatis tersedia di Edge Function).
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Pastikan attempt benar-benar ada, dan pakai hasil lama jika sudah pernah dianalisis
  // (supaya kuota Groq tidak terbuang saat halaman di-refresh / dipanggil ulang).
  const { data: attempt, error: attemptError } = await admin
    .from("quiz_attempts")
    .select("id, ai_analysis")
    .eq("id", attempt_id)
    .maybeSingle();

  if (attemptError) return json({ error: attemptError.message }, 500);
  if (!attempt) return json({ error: "Attempt tidak ditemukan." }, 404);
  if (attempt.ai_analysis) return json({ analysis: attempt.ai_analysis, cached: true });

  const answerLines = answers
    .slice(0, 50)
    .map((a: any, i: number) =>
      `${i + 1}. ${String(a.question ?? "").slice(0, 300)}\n   Jawaban: ${String(a.answer ?? "").slice(0, 300)} (kategori: ${CATEGORY_LABELS[a.category] ?? a.category})`
    )
    .join("\n");

  const scoreLines = Object.entries(scores ?? {})
    .map(([k, v]) => `- ${CATEGORY_LABELS[k] ?? k}: ${v}`)
    .join("\n");

  const systemPrompt =
    "Kamu adalah konselor karier digital dari Haltev IT Learning Center. " +
    "Analisis jawaban tes minat karier peserta dan berikan insight yang personal, hangat, dan jujur " +
    "dalam Bahasa Indonesia yang santai tapi profesional. Jangan mengarang fakta tentang peserta di luar jawabannya. " +
    "Balas HANYA dengan JSON valid dengan format:\n" +
    '{"ringkasan": string (2-3 kalimat), ' +
    '"kekuatan": string[] (3 poin singkat), ' +
    '"perlu_dikembangkan": string[] (2 poin singkat), ' +
    '"alasan_rekomendasi": string (2-3 kalimat kenapa bidang utama cocok, kaitkan dengan jawaban spesifik), ' +
    '"alternatif": string (1-2 kalimat tentang bidang alternatif yang juga potensial), ' +
    '"langkah_awal": string[] (3 langkah konkret untuk mulai belajar minggu ini)}';

  const userPrompt =
    `Nama peserta: ${String(name ?? "Peserta").slice(0, 100)}\n` +
    `Bidang dengan skor tertinggi: ${CATEGORY_LABELS[top_category] ?? top_category}\n\n` +
    `Skor per bidang:\n${scoreLines}\n\n` +
    `Jawaban peserta:\n${answerLines}`;

  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.6,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!groqRes.ok) {
    const detail = await groqRes.text();
    console.error("Groq error:", groqRes.status, detail);
    return json({ error: "Groq API error", status: groqRes.status, detail }, 502);
  }

  const groqData = await groqRes.json();
  let analysis: unknown;
  try {
    analysis = JSON.parse(groqData.choices?.[0]?.message?.content ?? "");
  } catch {
    return json({ error: "Respons AI bukan JSON valid." }, 502);
  }

  // Simpan hasil analisis ke database. Kalau gagal, analisis tetap dikirim ke browser.
  const { error: saveError } = await admin
    .from("quiz_attempts")
    .update({ ai_analysis: analysis })
    .eq("id", attempt_id);
  if (saveError) console.error("Gagal menyimpan ai_analysis:", saveError);

  return json({ analysis, cached: false });
});
