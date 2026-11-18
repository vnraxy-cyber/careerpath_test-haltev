import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method tidak diizinkan." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      console.error("Konfigurasi server belum lengkap.");
      return jsonResponse(
        { error: "Konfigurasi server belum lengkap." },
        500,
      );
    }

    const body = await req.json();

    const { attemptId, submissionToken, answers } = body;

    if (
      (typeof attemptId !== "number" &&
        typeof attemptId !== "string") ||
      !String(attemptId).trim() ||
      typeof submissionToken !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        .test(submissionToken) ||
      !Array.isArray(answers) ||
      answers.length === 0 ||
      answers.length > 200
    ) {
      return jsonResponse(
        { error: "Data pengiriman kuis tidak valid." },
        400,
      );
    }

    for (const answer of answers) {
      if (
        !answer ||
        !Number.isInteger(answer.question_number) ||
        answer.question_number < 1 ||
        typeof answer.answer_text !== "string" ||
        !answer.answer_text.trim() ||
        answer.answer_text.length > 1000 ||
        typeof answer.category !== "string" ||
        !answer.category.trim() ||
        answer.category.length > 100
      ) {
        return jsonResponse(
          { error: "Format jawaban tidak valid." },
          400,
        );
      }
    }

    const questionNumbers = answers.map(
      (answer: { question_number: number }) => answer.question_number,
    );

    if (new Set(questionNumbers).size !== questionNumbers.length) {
      return jsonResponse(
        { error: "Nomor pertanyaan tidak boleh duplikat." },
        400,
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Pastikan percobaan ada dan token cocok.
    const { data: attempt, error: findError } = await supabase
      .from("quiz_attempts")
      .select("id, status, submission_token")
      .eq("id", attemptId)
      .eq("submission_token", submissionToken)
      .maybeSingle();

    if (findError) {
      console.error("Gagal memeriksa percobaan:", findError);
      return jsonResponse(
        { error: "Gagal memeriksa percobaan kuis." },
        500,
      );
    }

    if (!attempt) {
      return jsonResponse(
        { error: "Token tidak valid atau percobaan tidak ditemukan." },
        403,
      );
    }

    if (attempt.status === "completed") {
      return jsonResponse(
        { error: "Percobaan kuis ini sudah selesai dikirim." },
        409,
      );
    }

    const answerRows = answers.map(
      (answer: {
        question_number: number;
        answer_text: string;
        category: string;
      }) => ({
        attempt_id: attempt.id,
        question_number: answer.question_number,
        answer_text: answer.answer_text.trim(),
        category: answer.category.trim(),
      }),
    );

    // Simpan jawaban hanya setelah token berhasil diverifikasi.
    const { error: insertError } = await supabase
      .from("quiz_answers")
      .insert(answerRows);

    if (insertError) {
      console.error("Gagal menyimpan jawaban:", insertError);
      return jsonResponse(
        { error: "Jawaban gagal disimpan." },
        500,
      );
    }

    // Tandai percobaan selesai.
    const { data: updatedAttempt, error: updateError } = await supabase
      .from("quiz_attempts")
      .update({
        completed_at: new Date().toISOString(),
        status: "completed",
      })
      .eq("id", attempt.id)
      .eq("submission_token", submissionToken)
      .neq("status", "completed")
      .select("id")
      .maybeSingle();

    if (updateError || !updatedAttempt) {
      console.error(
        "Gagal memperbarui status percobaan:",
        updateError,
      );

      return jsonResponse(
        {
          error:
            "Jawaban mungkin sudah tersimpan, tetapi status percobaan belum terkonfirmasi. Jangan kirim ulang sebelum diperiksa.",
        },
        500,
      );
    }

    return jsonResponse({
      success: true,
      message: "Jawaban kuis berhasil disimpan.",
    });
  } catch (error) {
    console.error("submit-career-quiz:", error);
    return jsonResponse(
      { error: "Terjadi kesalahan saat menyimpan hasil kuis." },
      500,
    );
  }
});
