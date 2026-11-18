import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Batas pendaftaran (anti-spam). Pendaftaran tetap terbuka untuk siapa saja;
// batas ini hanya menahan pengulangan berlebihan.
const MAX_ATTEMPTS_PER_PHONE_PER_HOUR = 5;
const MAX_ATTEMPTS_GLOBAL_PER_10_MIN = 300;

function tooMany(message: string) {
  return Response.json(
    { error: message },
    { status: 429, headers: { ...corsHeaders, "Retry-After": "600" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return Response.json(
      { error: "Method tidak diizinkan." },
      { status: 405, headers: corsHeaders },
    );
  }

  try {
    const { name, phone } = await req.json();

    if (
      typeof name !== "string" ||
      typeof phone !== "string" ||
      !name.trim() ||
      !phone.trim()
    ) {
      return Response.json(
        { error: "Nama dan nomor HP wajib diisi." },
        { status: 400, headers: corsHeaders },
      );
    }

    if (name.trim().length > 150 || phone.trim().length > 30) {
      return Response.json(
        { error: "Nama atau nomor HP terlalu panjang." },
        { status: 400, headers: corsHeaders },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      throw new Error("Konfigurasi server belum lengkap.");
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const cleanName = name.trim();
    const cleanPhone = phone.trim();

    // Batas global: cegah banjir pendaftaran dari script.
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count: recentGlobal, error: globalError } = await supabase
      .from("quiz_attempts")
      .select("id", { count: "exact", head: true })
      .gte("started_at", tenMinAgo);

    if (globalError) throw globalError;

    if ((recentGlobal ?? 0) >= MAX_ATTEMPTS_GLOBAL_PER_10_MIN) {
      return tooMany(
        "Server sedang ramai. Silakan coba lagi dalam beberapa menit.",
      );
    }

    const { data: existingUser, error: findError } = await supabase
      .from("users")
      .select("id")
      .eq("phone", cleanPhone)
      .maybeSingle();

    if (findError) throw findError;

    let userId = existingUser?.id;

    // Batas per nomor HP: cegah satu nomor membuat attempt berulang-ulang.
    if (userId) {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count: recentByUser, error: userCountError } = await supabase
        .from("quiz_attempts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("started_at", hourAgo);

      if (userCountError) throw userCountError;

      if ((recentByUser ?? 0) >= MAX_ATTEMPTS_PER_PHONE_PER_HOUR) {
        return tooMany(
          "Terlalu banyak percobaan dari nomor ini. Silakan coba lagi dalam 1 jam.",
        );
      }
    }

    if (!userId) {
      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert({ name: cleanName, phone: cleanPhone })
        .select("id")
        .single();

      if (insertError) throw insertError;
      userId = newUser.id;
    }

    const { data: attemptId, error: attemptError } = await supabase.rpc(
      "create_quiz_attempt",
      { p_user_id: userId },
    );

    if (attemptError) throw attemptError;

    const submissionToken = crypto.randomUUID();

    const { error: tokenError } = await supabase
      .from("quiz_attempts")
      .update({
        submission_token: submissionToken,
        participant_name: cleanName,
      })
      .eq("id", attemptId);

    if (tokenError) throw tokenError;

    return Response.json(
      { userId, attemptId, submissionToken },
      { status: 200, headers: corsHeaders },
    );
  } catch (error) {
    console.error("register-career-participant:", error);

    return Response.json(
      { error: "Pendaftaran gagal. Silakan coba lagi." },
      { status: 500, headers: corsHeaders },
    );
  }
});
