/* ---------------- Supabase connection ---------------- */

const SUPABASE_URL = 'https://wkpkaqdvkdzlhudcywtj.supabase.co';

const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_J6Ntk0SV3x0sQS7V99zEyQ_duLZKL8n';



const supabaseClient = window.supabase.createClient(

  SUPABASE_URL,

  SUPABASE_PUBLISHABLE_KEY

);



async function testSupabaseConnection(){

  try {

    const { data, error } = await supabaseClient

      .from('quiz_questions')

      .select('id, question_text, question_number')

      .order('question_number', { ascending: true })

      .limit(1);



    if(error) throw error;

    console.log('Supabase terhubung.');

    return true;

  } catch(error) {

    console.error('Supabase belum bisa diakses:', error);

    return false;

  }

}



/* ---------------- Footer injection ---------------- */

(function(){

  const tpl = document.getElementById('footer-template');

  ['footer-home','footer-bio','footer-quiz','footer-result'].forEach(id=>{

    document.getElementById(id).appendChild(tpl.content.cloneNode(true));

  });

})();



/* ---------------- View switching ---------------- */

function showView(id){

  ['view-home','view-bio','view-quiz','view-result'].forEach(v=>{

    document.getElementById(v).hidden = (v!==id);

  });

  window.scrollTo({top:0,behavior:'instant' in window ? 'instant':'auto'});

}

function goHome(e){ if(e) e.preventDefault(); showView('view-home'); }

function goHomeAnchor(e,anchor){

  if(e) e.preventDefault();

  showView('view-home');

  setTimeout(()=>{ const el=document.getElementById(anchor); if(el) el.scrollIntoView({behavior:'smooth'}); },30);

}



/* ---------------- Biodata (nama & no HP) ---------------- */

let userName = '';

let userPhone = '';

let currentUserId = null;
let currentAttemptId = null;
let currentSubmissionToken = null;

try { localStorage.removeItem('nama'); } catch(err) {}



function showBioForm(){

  userName = '';

  userPhone = '';

currentUserId = null;
currentAttemptId = null;
currentSubmissionToken = null;

  document.getElementById('bio-name').value = '';

  document.getElementById('bio-phone').value = '';

  showView('view-bio');

}
window.showBioForm = showBioForm;

async function submitBioForm(e) {
  e.preventDefault();

  userName = document.getElementById('bio-name').value.trim();
  userPhone = document.getElementById('bio-phone').value.trim();

  if (!userName || !userPhone) {
    alert('Nama dan nomor HP wajib diisi.');
    return;
  }

  const btn = e.submitter ||
    e.target.querySelector('button[type="submit"]');

  if (!btn) {
    console.error('Tombol submit tidak ditemukan.');
    return;
  }

  const btnText = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.textContent = 'Menyiapkan tes...';

  const slowTimer = setTimeout(() => {
    btn.textContent = 'Koneksi lambat, mohon tunggu...';
  }, 6000);

  try {
    // Simpan peserta dan buat percobaan kuis.
    const ok = await createUserAndAttempt();

    if (!ok) return;

    // Mulai tes setelah penyimpanan berhasil.
    await startQuiz();

  } catch (error) {
    console.error('Gagal memulai tes:', error);
    alert('Tes gagal dimulai. Periksa Console (F12).');
  } finally {
    clearTimeout(slowTimer);
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.innerHTML = btnText;
  }
}



/* ---------------- Supabase write helpers ---------------- */

async function createUserAndAttempt(){

  try {

    return await withTimeout(saveUserAndAttempt(), 30000);

  } catch(error) {

    console.error('Gagal menyimpan user/attempt ke Supabase:', error);

    alert(error && error.message === 'timeout'

      ? 'Koneksi internet terlalu lambat, data belum tersimpan. Periksa koneksimu lalu coba lagi.'

      : 'Data belum bisa disimpan ke database. Cek Console (F12) untuk detail error.');

    return false;

  }

}



function withTimeout(promise, ms){

  return Promise.race([promise, new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')), ms))]);

}






async function saveUserAndAttempt() {
  if (!userName?.trim() || !userPhone?.trim()) {
    throw new Error('Nama dan nomor HP wajib diisi.');
  }

  const { data, error } = await supabaseClient.functions.invoke(
    'register-career-participant',
    {
      body: {
        name: userName.trim(),
        phone: userPhone.trim()
      }
    }
  );

  if (error) {
    console.error('Edge Function pendaftaran gagal:', error);
    throw new Error(
      'Pendaftaran gagal. Periksa Logs pada register-career-participant.'
    );
  }

  if (
    !data ||
    data.userId == null ||
    data.attemptId == null ||
    !data.submissionToken
  ) {
    console.error('Respons pendaftaran tidak lengkap:', data);
    throw new Error(
      data?.error || 'ID peserta, ID percobaan, atau token tidak ditemukan.'
    );
  }

  currentUserId = data.userId;
  currentAttemptId = data.attemptId;
  currentSubmissionToken = data.submissionToken;

  console.log('Pendaftaran berhasil melalui Edge Function.');
  console.log('Attempt ID:', currentAttemptId);
  console.log('Submission token diterima.');

  return true;
}


async function saveQuizResultToSupabase(topKey, rawScores) {
  if (!currentAttemptId) {
    throw new Error(
      'ID percobaan tidak tersedia. Silakan mulai kuis kembali.'
    );
  }

  const answerRows = answers
    .map((selectedIndex, questionIndex) => {
      if (selectedIndex === null) return null;

      const question = QUESTIONS[questionIndex];
      const option = question?.opts?.[selectedIndex];

      if (!option) return null;

      return {
        attempt_id: currentAttemptId,
        question_number: Number(
          question.question_number ?? questionIndex + 1
        ),
        answer_text: String(option[0]),
        category: String(option[1])
      };
    })
    .filter(Boolean);

  if (answerRows.length === 0) {
    throw new Error('Tidak ada jawaban yang dapat disimpan.');
  }

  try {
    const { error: answerError } = await supabaseClient
      .from('quiz_answers')
      .insert(answerRows);

    if (answerError) {
      throw answerError;
    }

    const { error: updateError } = await supabaseClient
      .from('quiz_attempts')
      .update({
        completed_at: new Date().toISOString(),
        status: 'completed',
        top_category: topKey,
        scores: rawScores
      })
      .eq('id', currentAttemptId);

    if (updateError) {
      throw updateError;
    }

    console.log('Jawaban kuis berhasil disimpan ke database local.');
    return;
  } catch (dbError) {
    console.warn(
      'Insert langsung ke tabel gagal, mencoba Edge Function fallback:',
      dbError
    );
  }

  if (!currentSubmissionToken) {
    throw new Error(
      'Token pengiriman tidak tersedia. Silakan mulai kuis kembali.'
    );
  }

  const { data, error } = await supabaseClient.functions.invoke(
    'submit-career-quiz',
    {
      body: {
        attemptId: currentAttemptId,
        submissionToken: currentSubmissionToken,
        answers: answerRows,
        topKey,
        scores: rawScores
      }
    }
  );

  if (error) {
    console.error('Gagal mengirim hasil kuis:', error);
    throw new Error(
      'Hasil kuis gagal disimpan. Periksa log Edge Function.'
    );
  }

  if (!data?.success) {
    console.error('Respons penyimpanan tidak sesuai:', data);
    throw new Error(
      data?.error || 'Server belum mengonfirmasi penyimpanan hasil.'
    );
  }

  console.log('Jawaban kuis berhasil disimpan melalui server.');
}





/* ---------------- Quiz data ---------------- */

const CATS = {
  web: {
    label: 'Programming & Coding',
    emoji: '💻',
    color: '#0B6FF2',
    bg: '#E9F0FF',
    about: 'Programming & Coding berfokus pada pembuatan aplikasi, website, dan sistem digital melalui kode serta logika pemrograman.',
    roadmap: [
      ['Dasar Pemrograman', 'Memahami variabel, logika, kondisi, dan perulangan.'],
      ['HTML & CSS', 'Membangun struktur dan tampilan website.'],
      ['JavaScript', 'Membuat website interaktif.'],
      ['Database & Backend', 'Mengelola data dan logika aplikasi.'],
      ['Proyek Portofolio', 'Membuat aplikasi atau website sendiri.']
    ],
    curriculum: [
      ['Fundamental Coding', '💻'],
      ['HTML & CSS', '🎨'],
      ['JavaScript', '🟨'],
      ['Database', '🗄️'],
      ['Project', '🚀']
    ],
    fits: [
      ['Kamu Suka Memecahkan Masalah', 'Kamu menikmati tantangan logika dan mencari solusi.','🧩'],
      ['Kamu Tekun dan Sistematis', 'Kamu suka mengerjakan sesuatu secara terstruktur.','🎯'],
      ['Kamu Tertarik dengan Teknologi', 'Kamu ingin memahami cara kerja sistem digital.','💻'],
      ['Kamu Suka Membangun Sesuatu', 'Kamu senang mengubah ide menjadi produk nyata.','🚀']
    ],
    scores: [
      ['Logical Thinking', 90, '💡'],
      ['Problem Solving', 92, '🧩'],
      ['Technology Interest', 88, '💻'],
      ['Persistence', 85, '🎯']
    ]
  },

  data: {
    label: 'Data Science',
    emoji: '📊',
    color: '#1E9E5A',
    bg: '#E9F7EE',
    about: 'Data Science berfokus pada pengolahan dan analisis data untuk menemukan pola, menghasilkan insight, serta mendukung pengambilan keputusan.',
    roadmap: [
      ['Excel & SQL', 'Mengolah dan mengambil data.'],
      ['Statistik', 'Memahami pola dan hubungan dalam data.'],
      ['Python', 'Mengolah data dengan pemrograman.'],
      ['Visualisasi Data', 'Menyajikan temuan secara jelas.'],
      ['Proyek Data', 'Membuat analisis dari data nyata.']
    ],
    curriculum: [
      ['Fundamental Data', '📂'],
      ['SQL & Excel', '🧮'],
      ['Statistika', '📊'],
      ['Visualisasi Data', '📈'],
      ['Project', '🚀']
    ],
    fits: [
      ['Kamu Suka Angka dan Pola', 'Kamu senang menemukan pola tersembunyi dalam data.','🔢'],
      ['Kamu Teliti', 'Kamu memperhatikan detail dan ketepatan informasi.','🔍'],
      ['Kamu Berpikir Analitis', 'Kamu mempertimbangkan bukti sebelum menyimpulkan.','💡'],
      ['Kamu Suka Menemukan Insight', 'Kamu ingin mengubah data menjadi informasi berguna.','📊']
    ],
    scores: [
      ['Analytical Thinking', 92, '🔢'],
      ['Attention to Detail', 90, '🔍'],
      ['Logical Thinking', 86, '💡'],
      ['Data Interpretation', 89, '📊']
    ]
  },

  design: {
    label: 'Desain Visual',
    emoji: '🎨',
    color: '#D9468F',
    bg: '#FCEAF3',
    about: 'Desain Visual mengubah ide menjadi komunikasi visual melalui komposisi, warna, tipografi, ilustrasi, dan tata letak.',
    roadmap: [
      ['Dasar Desain', 'Memahami warna, bentuk, komposisi, dan hierarki visual.'],
      ['Tipografi & Layout', 'Menyusun teks dan elemen agar mudah dibaca.'],
      ['Tools Desain', 'Berlatih menggunakan aplikasi desain.'],
      ['Branding & UI', 'Membuat identitas visual dan antarmuka.'],
      ['Portofolio', 'Mengumpulkan karya terbaik.']
    ],
    curriculum: [
      ['Prinsip Desain', '🎨'],
      ['Warna & Tipografi', '🖌️'],
      ['Tools Desain', '🧰'],
      ['Branding & UI', '🖼️'],
      ['Portofolio', '🚀']
    ],
    fits: [
      ['Kamu Kreatif', 'Kamu senang menghasilkan ide visual yang menarik.','🎨'],
      ['Kamu Peka terhadap Detail', 'Kamu memperhatikan warna, bentuk, dan kerapian.','🔍'],
      ['Kamu Suka Berkarya', 'Kamu menikmati mengubah ide menjadi karya visual.','🖼️'],
      ['Kamu Suka Bereksperimen', 'Kamu senang mencoba gaya dan pendekatan baru.','✨']
    ],
    scores: [
      ['Creativity', 93, '🎨'],
      ['Visual Sense', 92, '🖼️'],
      ['Attention to Detail', 88, '🔍'],
      ['Communication', 80, '💬']
    ]
  },

  marketing: {
    label: 'Digital Marketing',
    emoji: '📣',
    color: '#E07A1E',
    bg: '#FFF1E4',
    about: 'Digital Marketing adalah strategi pemasaran melalui kanal digital, termasuk media sosial, SEO, konten, dan iklan online.',
    roadmap: [
      ['Dasar Pemasaran', 'Memahami target pasar dan brand.'],
      ['SEO & Content', 'Meningkatkan visibilitas online.'],
      ['Social Media', 'Mengelola konten dan komunitas.'],
      ['Digital Ads', 'Mempelajari kampanye iklan digital.'],
      ['Analytics & Strategy', 'Mengukur performa dan menyusun strategi.']
    ],
    curriculum: [
      ['Fundamental Marketing', '📣'],
      ['SEO & SEM', '🔍'],
      ['Social Media', '📱'],
      ['Content Strategy', '✍️'],
      ['Project', '🚀']
    ],
    fits: [
      ['Kamu Suka Berkomunikasi', 'Kamu senang menyampaikan pesan kepada orang lain.','💬'],
      ['Kamu Kreatif', 'Kamu suka membuat ide dan konten menarik.','🎨'],
      ['Kamu Peka terhadap Tren', 'Kamu cepat menangkap perubahan tren.','📈'],
      ['Kamu Suka Membangun Brand', 'Kamu tertarik membantu brand tumbuh dan dikenal.','🚀']
    ],
    scores: [
      ['Communication', 92, '💬'],
      ['Creativity', 88, '🎨'],
      ['Trend Awareness', 89, '📈'],
      ['Strategic Thinking', 86, '♟️']
    ]
  },

  security: {
    label: 'Cyber Security',
    emoji: '🛡️',
    color: '#2B6FE0',
    bg: '#E8F1FF',
    about: 'Cyber Security berfokus pada perlindungan sistem, jaringan, aplikasi, dan data dari ancaman serta serangan digital.',
    roadmap: [
      ['Dasar Jaringan', 'Memahami cara kerja jaringan komputer.'],
      ['Sistem Operasi & Linux', 'Mempelajari sistem dan administrasi.'],
      ['Keamanan Aplikasi', 'Mengenali celah keamanan.'],
      ['Ethical Hacking', 'Menguji keamanan secara legal dan terkontrol.'],
      ['Incident Response', 'Memahami penanganan insiden keamanan.']
    ],
    curriculum: [
      ['Fundamental Security', '🛡️'],
      ['Jaringan Komputer', '🌐'],
      ['Linux', '💻'],
      ['Keamanan Aplikasi', '🔐'],
      ['Project', '🚀']
    ],
    fits: [
      ['Kamu Teliti dan Waspada', 'Kamu memperhatikan detail dan risiko.','🔍'],
      ['Kamu Suka Memecahkan Masalah', 'Kamu tertarik menemukan dan memperbaiki celah.','🧩'],
      ['Kamu Berpikir Sistematis', 'Kamu mempertimbangkan langkah dengan hati-hati.','♟️'],
      ['Kamu Suka Menjaga Keamanan', 'Kamu peduli terhadap perlindungan data dan pengguna.','🛡️']
    ],
    scores: [
      ['Attention to Detail', 93, '🔍'],
      ['Problem Solving', 90, '🧩'],
      ['Logical Thinking', 88, '💡'],
      ['Risk Awareness', 92, '🛡️']
    ]
  },

  scientist: {
    label: 'Teknologi AI',
    emoji: '🤖',
    color: '#7C5CE0',
    bg: '#F1ECFE',
    about: 'Teknologi AI berfokus pada pemanfaatan kecerdasan buatan untuk membantu manusia memahami informasi, membuat prediksi, dan mengotomatisasi pekerjaan.',
    roadmap: [
      ['Dasar AI', 'Memahami konsep dan penerapan kecerdasan buatan.'],
      ['Python', 'Mengenal bahasa pemrograman untuk AI.'],
      ['Machine Learning', 'Memahami model yang belajar dari data.'],
      ['Generative AI', 'Mengeksplorasi AI untuk teks, gambar, dan produktivitas.'],
      ['Proyek AI', 'Membuat prototipe sederhana berbasis AI.']
    ],
    curriculum: [
      ['Fundamental AI', '🤖'],
      ['Python Dasar', '🐍'],
      ['Machine Learning', '🧪'],
      ['Generative AI', '✨'],
      ['Proyek AI', '🚀']
    ],
    fits: [
      ['Kamu Penasaran dengan Teknologi Baru', 'Kamu senang mengeksplorasi teknologi baru.','🔭'],
      ['Kamu Suka Bereksperimen', 'Kamu tertarik menguji kemampuan teknologi.','🧪'],
      ['Kamu Berpikir Kreatif', 'Kamu mencari cara baru memanfaatkan teknologi.','💡'],
      ['Kamu Suka Belajar Mandiri', 'Kamu mau terus mengikuti perkembangan AI.','📚']
    ],
    scores: [
      ['Curiosity', 92, '🔭'],
      ['Experimentation', 90, '🧪'],
      ['Creative Thinking', 88, '💡'],
      ['Technology Interest', 93, '🤖']
    ]
  }
};

const QUESTIONS = [
  {
    q: 'Baru banget dapet HP atau gadget baru. Apa yang langsung kamu lakuin?',
    opts: [
      ['Nyobain semua fitur barunya, apalagi yang katanya pakai AI', 'scientist', '🤖'],
      ['Pasang kunci layar dan atur privasi dulu, biar tenang', 'security', '🛡️'],
      ['Langsung ngoprek pengaturannya sampai ngerti semua cara kerjanya', 'web', '💻'],
      ['Ganti wallpaper dan tema, terus ngatur ikon satu-satu biar enak dilihat', 'design', '🎨'],
      ['Cek spesifikasinya dulu, terus bandingin sama yang lain: worth it nggak ya?', 'data', '📊'],
      ['Foto terus pamerin ke temen-temen, sekalian rekomendasiin', 'marketing', '📣']
    ]
  },
  {
    q: 'Kamu lagi pakai aplikasi atau website yang bikin pusing banget. Yang kamu rasain...',
    opts: [
      ['Gemes banget sama tampilannya, rasanya pengin kamu desain ulang', 'design', '🎨'],
      ['Penasaran ini sebenernya dibikin kayak gimana, dan kepikiran cara benerinnya', 'web', '💻'],
      ['Mulai ragu: aman nggak ya naruh data pribadi di sini?', 'security', '🛡️'],
      ['Mikir, "harusnya bisa lebih pintar dan otomatis dong"', 'scientist', '🤖'],
      ['Mikirin gimana caranya biar makin banyak orang mau pakai', 'marketing', '📣'],
      ['Kepo, di bagian mana sih kebanyakan orang akhirnya nyerah?', 'data', '📊']
    ]
  },
  {
    q: 'Lagi scroll, ketemu konten yang viral banget. Hal pertama yang muncul di kepalamu...',
    opts: [
      ['Ini beneran atau hoaks ya? Jangan-jangan penipuan.', 'security', '🛡️'],
      ['Ini dibikin pakai AI nggak sih? Kok keren banget.', 'scientist', '🤖'],
      ['Angkanya dari mana? Ada buktinya nggak?', 'data', '📊'],
      ['Gimana ya caranya bikin yang kayak gini sendiri?', 'web', '💻'],
      ['Kenapa ini bisa meledak? Pasti ada strateginya.', 'marketing', '📣'],
      ['Visualnya bagus banget, ini pakai gaya apa ya?', 'design', '🎨']
    ]
  },
  {
    q: 'Lagi nyusun liburan bareng temen-temen. Biasanya kamu yang...',
    opts: [
      ['Bikin grup rame dan ngajak semua orang biar semangat', 'marketing', '📣'],
      ['Mikirin rencana cadangan, takut hujan, telat, atau ada barang ketinggalan', 'security', '🛡️'],
      ['Nyusun jadwal per jam biar semuanya jalan rapi dan nggak ada yang kelewat', 'web', '💻'],
      ['Ngusulin rute atau kegiatan yang beda dari biasanya', 'scientist', '🤖'],
      ['Nyari tempat-tempat paling cakep buat foto', 'design', '🎨'],
      ['Bandingin harga, ulasan, dan rute sampai nemu yang paling worth it', 'data', '📊']
    ]
  },
  {
    q: 'Pas lagi stres atau capek banget, yang bikin kamu balik tenang...',
    opts: [
      ['Mastiin sekitarku aman dan semuanya terkendali', 'security', '🛡️'],
      ['Dengerin musik, nonton film, atau ngeliat hal-hal yang indah', 'design', '🎨'],
      ['Nyoba hal baru yang bikin pikiran jadi fresh lagi', 'scientist', '🤖'],
      ['Duduk tenang dan mikir pelan-pelan, nyari tahu akar masalahnya', 'data', '📊'],
      ['Beres-beres sampai semuanya rapi dan tertata', 'web', '💻'],
      ['Curhat dan ngobrol sama orang terdekat', 'marketing', '📣']
    ]
  },
  {
    q: 'Kalau kamu nanya ke temen, "menurut kamu aku orangnya kayak gimana?", jawabannya mungkin...',
    opts: [
      ['Kamu tuh kreatif dan punya selera sendiri.', 'design', '🎨'],
      ['Kamu penasaran terus, ide-idenya suka nggak biasa.', 'scientist', '🤖'],
      ['Kamu gampang akrab dan jago bikin orang percaya.', 'marketing', '📣'],
      ['Kamu tuh tekun, semuanya dikerjain rapi dan urut.', 'web', '💻'],
      ['Kamu teliti dan mikirnya masuk akal.', 'data', '📊'],
      ['Kamu waspada dan bisa banget diandelin.', 'security', '🛡️']
    ]
  },
  {
    q: 'Misalnya kamu punya kesempatan bikin satu hal buat bantu banyak orang. Kamu bakal bikin...',
    opts: [
      ['Aplikasi yang bikin urusan sehari-hari jadi jauh lebih gampang', 'web', '💻'],
      ['Survei yang nunjukin masalah sebenarnya di sekitar kita, lengkap sama buktinya', 'data', '📊'],
      ['Kampanye visual yang bikin orang jadi peduli', 'design', '🎨'],
      ['Sistem yang ngelindungin orang dari penipuan online', 'security', '🛡️'],
      ['Gerakan online yang bikin banyak orang ikut terlibat', 'marketing', '📣'],
      ['Asisten pintar yang bisa bantu siapa pun belajar hal baru', 'scientist', '🤖']
    ]
  },
  {
    q: 'Waktu buka medsos, kamu lebih sering...',
    opts: [
      ['Bikin konten dan seneng banget liat yang like, komen, sama share-nya', 'marketing', '📣'],
      ['Ngintip statistik, siapa aja yang nonton dan jam berapa paling rame', 'data', '📊'],
      ['Nyobain filter, tren, dan fitur AI yang baru keluar', 'scientist', '🤖'],
      ['Ngatur privasi dan blokir akun yang kelihatan mencurigakan', 'security', '🛡️'],
      ['Penasaran gimana fitur-fiturnya bisa jalan di balik layar', 'web', '💻'],
      ['Ngerapiin feed biar tampilannya enak dan warnanya senada', 'design', '🎨']
    ]
  },
  {
    q: 'Hal yang paling bikin kamu kesel...',
    opts: [
      ['Orang ngomong seenaknya tanpa bukti', 'data', '📊'],
      ['Pesan penting yang nggak nyampe, atau nggak ada yang mau dengerin', 'marketing', '📣'],
      ['Kerjaan yang dikerjain asal-asalan terus ditinggal', 'web', '💻'],
      ['Semuanya harus sama terus, dan nyoba hal baru dianggap salah', 'scientist', '🤖'],
      ['Orang yang santai banget soal risiko dan aturan keselamatan', 'security', '🛡️'],
      ['Tampilan atau suasana yang berantakan dan nggak enak dilihat', 'design', '🎨']
    ]
  },
  {
    q: 'Temenmu minta diajarin sesuatu. Cara kamu ngajarin...',
    opts: [
      ['Pakai cerita dan gaya ngobrol biar seru dan gampang nempel', 'marketing', '📣'],
      ['Pakai gambar, warna, atau contoh yang bisa dilihat langsung', 'design', '🎨'],
      ['Ngasih tahu kesalahan yang sering kejadian biar dia lebih hati-hati', 'security', '🛡️'],
      ['Jelasin alasannya dulu biar dia ngerti kenapa harus begitu', 'data', '📊'],
      ['Ngajak dia coba-coba sendiri sampai nemu caranya', 'scientist', '🤖'],
      ['Ngasih langkahnya satu per satu sampai dia bisa praktik', 'web', '💻']
    ]
  },
  {
    q: 'Game atau permainan apa yang bikin kamu betah berjam-jam?',
    opts: [
      ['Yang bisa bikin dan ngerakit sesuatu sendiri', 'web', '💻'],
      ['Yang dunianya luas, bebas dijelajahi, dan boleh coba apa aja', 'scientist', '🤖'],
      ['Yang dimainin ramean, ngatur tim, dan jadi pemimpinnya', 'marketing', '📣'],
      ['Yang visual dan karakternya cakep, bisa didandanin sesuka hati', 'design', '🎨'],
      ['Yang harus bertahan hidup dan jagain markas dari serangan', 'security', '🛡️'],
      ['Yang butuh strategi, hitung-hitungan peluang, dan atur sumber daya', 'data', '📊']
    ]
  },
  {
    q: 'Bayangin hari kerja yang paling kamu banget. Isinya...',
    opts: [
      ['Ngulik ide dan hal baru tiap hari', 'scientist', '🤖'],
      ['Menggali informasi sampai nemu kesimpulan yang tajam', 'data', '📊'],
      ['Mastiin semuanya berjalan aman tanpa kejutan yang nggak enak', 'security', '🛡️'],
      ['Ketemu banyak orang, ngobrol, dan nyari peluang bareng', 'marketing', '📣'],
      ['Ngerjain proyek yang hasilnya makin kelihatan dari hari ke hari', 'web', '💻'],
      ['Berkarya dan bebas ngeluarin selera sendiri', 'design', '🎨']
    ]
  },
  {
    q: 'Kalau dikasih satu kekuatan super, kamu mau...',
    opts: [
      ['Nyulap sekitar jadi seindah yang ada di bayanganmu', 'design', '🎨'],
      ['Bisa bikin atau benerin apa pun dalam sekejap', 'web', '💻'],
      ['Bikin semua orang langsung paham dan percaya sama kamu', 'marketing', '📣'],
      ['Ngelindungin orang-orang tersayang dari bahaya apa pun', 'security', '🛡️'],
      ['Langsung tahu kebenaran di balik setiap kejadian', 'data', '📊'],
      ['Ngintip masa depan dan nemuin penemuan sebelum orang lain', 'scientist', '🤖']
    ]
  },
  {
    q: 'Lagi heboh teknologi baru, misalnya AI. Reaksi kamu...',
    opts: [
      ['Nyari tahu dulu: ini beneran berguna atau cuma hype?', 'data', '📊'],
      ['Kepikiran risikonya, terus gimana caranya biar nggak disalahgunain', 'security', '🛡️'],
      ['Langsung nyoba, penasaran banget sampai mana batas kemampuannya', 'scientist', '🤖'],
      ['Pengin ngerti cara kerjanya, terus nyoba bikin sesuatu pakai itu', 'web', '💻'],
      ['Penasaran, bisa dipakai buat bikin karya visual apa aja ya?', 'design', '🎨'],
      ['Mikirin cara ngenalin dan nawarinnya ke banyak orang', 'marketing', '📣']
    ]
  },
  {
    q: 'Beberapa tahun lagi, kamu pengin ngerasa...',
    opts: [
      ['Berpengaruh, karena banyak orang yang dengerin dan percaya sama kamu', 'marketing', '📣'],
      ['Dikenal, karena karyamu punya ciri khas', 'design', '🎨'],
      ['Bangga jadi yang pertama nemuin hal baru', 'scientist', '🤖'],
      ['Bangga, karena bisa bikin sesuatu yang berguna dan awet', 'web', '💻'],
      ['Tenang, karena kamu dan orang-orang terdekatmu terlindungi', 'security', '🛡️'],
      ['Dihormati, karena pendapatmu selalu tepat dan ada dasarnya', 'data', '📊']
    ]
  }
];


const QUESTIONS_PER_PAGE = 5;

let currentQ = 0;

let answers = new Array(QUESTIONS.length).fill(null);



let quizLoadedFromSupabase = false;



const CATEGORY_MAP = {
  PRG: 'web',
  DAT: 'data',
  DSN: 'design',
  MKT: 'marketing',
  SEC: 'security',
  AI: 'scientist'
};

function normalizeOption(row, fallbackCategory = 'web') {
  const text =
    row.option_text ??
    row.text ??
    row.answer_text ??
    row.label ??
    row.option ??
    '';

  const rawCategory = String(
    row.category ??
    row.cat ??
    row.result_category ??
    fallbackCategory
  );

  const cat =
    CATEGORY_MAP[rawCategory.toUpperCase()] ||
    rawCategory;

  const emoji = row.emoji ?? row.icon ?? '•';

  return [String(text), String(cat), String(emoji)];
}



async function loadQuestionsFromSupabase(){

  const { data: questionRows, error: questionError } = await supabaseClient

    .from('quiz_questions')

    .select('*')

    .order('question_number', { ascending: true });



  if(questionError) throw questionError;

  if(!questionRows || !questionRows.length) throw new Error('quiz_questions kosong.');



  const questionIds = questionRows.map(row => row.id);

  const { data: optionRows, error: optionError } = await supabaseClient

    .from('quiz_options')

    .select('*');



  if(optionError) throw optionError;



  const normalized = questionRows.map((q, index) => {

    const qId = q.id;

    const qNumber = q.question_number ?? index + 1;

    const qOptions = (optionRows || [])

      .filter(o => String(o.question_id ?? o.quiz_question_id ?? o.question ?? '') === String(qId))

      .sort((a,b) => Number(a.option_number ?? a.option_order ?? a.sort_order ?? a.id ?? 0) - Number(b.option_number ?? b.option_order ?? b.sort_order ?? b.id ?? 0))

      .map(o => normalizeOption(o));



    return {

      id: qId,

      question_number: qNumber,

      q: q.question_text ?? q.question ?? q.text ?? '',

      opts: qOptions

    };

  });



  if(normalized.some(q => !q.q || q.opts.length === 0)) {

    throw new Error('Struktur quiz_options belum cocok dengan kode. Data lokal tetap digunakan.');

  }



  return normalized;

}



async function startQuiz(){

  currentQ = 0;

  answers = new Array(QUESTIONS.length).fill(null);

  showView('view-quiz');



  try {

    const dbQuestions = await loadQuestionsFromSupabase();

    QUESTIONS.length = 0;

    dbQuestions.forEach(q => QUESTIONS.push(q));

    answers = new Array(QUESTIONS.length).fill(null);

    quizLoadedFromSupabase = true;

  } catch(error) {

    quizLoadedFromSupabase = false;

    console.warn('Quiz Supabase tidak dipakai, menggunakan data lokal:', error);

  }



  renderQuestion();

}



function updateProgress(){

  const total = QUESTIONS.length;

  const answered = answers.filter(answer=>answer!==null).length;

  const pct = total ? Math.round((answered/total)*100) : 0;

  document.getElementById('q-percent').textContent = pct+'% selesai';

  document.getElementById('progress-fill').style.width = pct+'%';

}



function renderQuestion(){

  const total = QUESTIONS.length;

  const pageEnd = Math.min(currentQ + QUESTIONS_PER_PAGE, total);

  document.getElementById('q-counter').textContent = 'Pertanyaan '+(currentQ+1)+'–'+pageEnd+' dari '+total;

  updateProgress();



  const wrap = document.getElementById('q-list');

  wrap.innerHTML = '';

  for(let questionIndex=currentQ; questionIndex<pageEnd; questionIndex++){

    const data = QUESTIONS[questionIndex];

    const block = document.createElement('section');

    block.className = 'q-card question-block';



    const title = document.createElement('h2');

    title.textContent = (questionIndex+1)+'. '+data.q;

    block.appendChild(title);



    const options = document.createElement('div');

    options.className = 'question-options';

    data.opts.forEach((opt,idx)=>{

      const [text] = opt;

      const selected = answers[questionIndex]===idx;

      const label = document.createElement('label');

      label.className = 'option'+(selected?' selected':'');



      const input = document.createElement('input');

      input.type = 'radio';

      input.name = 'opt-'+questionIndex;

      input.checked = selected;



      const answerText = document.createElement('span');

      answerText.textContent = text;



      label.append(input, answerText);

      label.addEventListener('click', ()=>{

        answers[questionIndex] = idx;

        options.querySelectorAll('.option').forEach(option=>option.classList.remove('selected'));

        label.classList.add('selected');

        input.checked = true;

        updateProgress();

        document.getElementById('btn-next').disabled = answers

          .slice(currentQ, pageEnd)

          .some(answer=>answer===null);

      });

      options.appendChild(label);

    });



    block.appendChild(options);

    wrap.appendChild(block);

  }



  document.getElementById('btn-back').style.visibility = currentQ===0 ? 'hidden':'visible';

  const nextBtn = document.getElementById('btn-next');

  nextBtn.disabled = answers.slice(currentQ, pageEnd).some(answer=>answer===null);

  nextBtn.textContent = pageEnd===total ? 'Lihat Hasil →' : 'Lanjut →';



  wrap.classList.remove('fade-in');

  void wrap.offsetWidth;

  wrap.classList.add('fade-in');

}



function scrollToQuestion(){

  document.getElementById('view-quiz').scrollIntoView({behavior:'smooth',block:'start'});

}

function prevQuestion(){

  if(currentQ>0){ currentQ=Math.max(0,currentQ-QUESTIONS_PER_PAGE); renderQuestion(); scrollToQuestion(); }

}

function nextQuestion(){

  const pageEnd = Math.min(currentQ + QUESTIONS_PER_PAGE, QUESTIONS.length);

  if(answers.slice(currentQ, pageEnd).some(answer=>answer===null)) return;

  if(pageEnd < QUESTIONS.length){

    currentQ=pageEnd;

    renderQuestion();

    scrollToQuestion();

  } else {

    computeResult();

  }

}



async function computeResult() {
  const scores = {
    web: 0,
    data: 0,
    design: 0,
    marketing: 0,
    security: 0,
    scientist: 0
  };

  answers.forEach((idx, qi) => {
    if (idx === null) return;

    const cat = QUESTIONS[qi].opts[idx][1];

    if (Object.prototype.hasOwnProperty.call(scores, cat)) {
      scores[cat]++;
    }
  });

  let top = 'web';
  let max = -1;

  Object.keys(scores).forEach(key => {
    if (scores[key] > max) {
      max = scores[key];
      top = key;
    }
  });

  const sorted = Object.keys(scores).sort(
    (a, b) => scores[b] - scores[a]
  );

  try {
    await saveQuizResultToSupabase(top, scores);
  } catch (error) {
    console.error('Gagal menyimpan hasil quiz:', error);
    alert(
      'Hasil quiz belum tersimpan ke database. Cek Console (F12) untuk detail error.'
    );
  }

  renderResult(top, sorted, scores);
  showView('view-result');
  runAiAnalysis(top, scores);
}



/* ---------------- Analisis AI (Groq via Supabase Edge Function) ---------------- */

function fillList(id, items){

  const el = document.getElementById(id);

  el.innerHTML = '';

  (Array.isArray(items) ? items : []).forEach(text=>{

    const li = document.createElement('li');

    li.textContent = String(text);

    el.appendChild(li);

  });

}



async function runAiAnalysis(topKey, rawScores){

  const card = document.getElementById('ai-card');

  const loading = document.getElementById('ai-loading');

  const errorEl = document.getElementById('ai-error');

  const content = document.getElementById('ai-content');



  card.hidden = false;

  loading.hidden = false;

  errorEl.hidden = true;

  content.hidden = true;



  try {

    if(!currentAttemptId) throw new Error('currentAttemptId kosong.');



    const answerPayload = answers

      .map((selectedIndex, questionIndex) => {

        if(selectedIndex === null) return null;

        const question = QUESTIONS[questionIndex];

        const option = question?.opts?.[selectedIndex];

        if(!option) return null;

        return { question: question.q, answer: option[0], category: option[1] };

      })

      .filter(Boolean);



    const { data, error } = await supabaseClient.functions.invoke('analyze-career', {

      body: {

        attempt_id: currentAttemptId,

        name: userName,

        top_category: topKey,

        scores: rawScores,

        answers: answerPayload

      }

    });



    if(error) throw error;

    if(!data?.analysis) throw new Error(data?.error || 'Respons AI kosong.');



    const a = data.analysis;

    const careers = (Array.isArray(a.recommended_careers) ? a.recommended_careers : [])

      .map(c => typeof c === 'string' ? c : [c.career, c.reason].filter(Boolean).join(': '));

    document.getElementById('ai-summary').textContent = a.ringkasan || a.summary || '';

    fillList('ai-strengths', a.kekuatan || a.strengths);

    fillList('ai-growth', a.perlu_dikembangkan || a.development_areas);

    document.getElementById('ai-reason').textContent = a.alasan_rekomendasi || '';

    fillList('ai-careers', careers);

    document.getElementById('ai-alt').textContent = a.alternatif || '';

    fillList('ai-steps', a.langkah_awal || a.learning_recommendations);



    document.getElementById('ai-reason-block').hidden = !a.alasan_rekomendasi;

    document.getElementById('ai-careers-block').hidden = careers.length === 0;

    document.getElementById('ai-alt-block').hidden = !a.alternatif;

    document.getElementById('ai-steps-block').hidden = !document.getElementById('ai-steps').children.length;



    loading.hidden = true;

    content.hidden = false;

  } catch(error) {

    let detail = error;

    try { if(error?.context?.json) detail = await error.context.json(); } catch(e) {}

    console.error('Analisis AI gagal:', detail);

    loading.hidden = true;

    errorEl.hidden = false;

  }

}



function animateRoadmap(el){

  if(!el) return;

  el.classList.remove('is-animated');

  el.classList.add('anim-ready');

  Array.prototype.forEach.call(el.querySelectorAll('.road-step,.rr-item'),function(step,i){ step.style.setProperty('--i',i); });

  if(!('IntersectionObserver' in window)){ el.classList.add('is-animated'); return; }

  var obs = new IntersectionObserver(function(entries){

    entries.forEach(function(entry){

      if(entry.isIntersecting){ el.classList.add('is-animated'); obs.disconnect(); }

    });

  },{threshold:0.3});

  obs.observe(el);

}



function setupRoadDots(track){

  let dots = track.nextElementSibling;

  if(!dots || !dots.classList.contains('rr-dots')){

    dots = document.createElement('div');

    dots.className = 'rr-dots';

    track.after(dots);

  }

  const items = [...track.querySelectorAll('.rr-item')];

  dots.innerHTML = '';

  items.forEach((item,i)=>{

    const b = document.createElement('button');

    b.type = 'button';

    b.setAttribute('aria-label','Tahap '+(i+1));

    b.addEventListener('click',()=>track.scrollTo({left:item.offsetLeft - items[0].offsetLeft, behavior:'smooth'}));

    dots.appendChild(b);

  });

  const update = ()=>{

    const scrollable = track.scrollWidth - track.clientWidth > 4;

    dots.hidden = !scrollable;

    if(!scrollable) return;

    const step = items[1] ? items[1].offsetLeft - items[0].offsetLeft : track.clientWidth;

    const idx = Math.min(items.length-1, Math.round(track.scrollLeft / step));

    [...dots.children].forEach((d,i)=>d.classList.toggle('is-active', i===idx));

  };

  track.onscroll = update;

  new ResizeObserver(update).observe(track);

  update();

}



function setupCurrArrows(){

  const track = document.getElementById('curr-grid');

  const prev = document.getElementById('curr-prev');

  const next = document.getElementById('curr-next');

  if(!track || !prev || !next) return;

  const scrollByCard = (dir)=>{

    const card = track.querySelector('.curr-card');

    const step = card ? card.getBoundingClientRect().width + 16 : 200;

    track.scrollBy({left: dir*step, behavior:'smooth'});

  };

  const updateArrows = ()=>{

    prev.disabled = track.scrollLeft <= 4;

    next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 4;

  };

  prev.onclick = ()=>scrollByCard(-1);

  next.onclick = ()=>scrollByCard(1);

  track.onscroll = updateArrows;

  window.onresize = updateArrows;

  requestAnimationFrame(updateArrows);

}



const FI_ICONS = {

  '💻':'laptop-code','📊':'chart-histogram','🧬':'dna','📣':'megaphone','🛡️':'shield-check',

  '🌐':'globe','🟨':'code-simple','🎨':'palette','🗄️':'database','🚀':'rocket-lunch',

  '🧩':'puzzle-alt','🎓':'graduation-cap','💡':'bulb','🖥️':'computer','📂':'folder-open',

  '🧮':'calculator','📈':'chart-line-up','🔢':'chart-simple','🔍':'search','📌':'thumbtack',

  '💬':'comment-alt','📐':'ruler-triangle','🐍':'code-simple','🤖':'robot','🧠':'brain',

  '🧪':'flask','🔬':'microscope','🔭':'telescope','📱':'smartphone','✍️':'pencil',

  '📝':'edit','♟️':'chess-piece','🕵️':'user-ninja','🔐':'lock','⛰️':'mountains'

};

function fiIcon(emoji){

  const name = FI_ICONS[emoji];

  return name ? '<i class="fi fi-rr-'+name+'" aria-hidden="true"></i>' : emoji;

}





function renderResult(topKey, sortedKeys, rawScores){

  const c = CATS[topKey];

  const matchPct = Math.min(96, 62 + rawScores[topKey]*5);



  document.getElementById('user-name').textContent = userName || 'Kamu';

  document.getElementById('user-initial').textContent = (userName || 'Kamu').charAt(0).toUpperCase();

  document.getElementById('res-title').textContent = c.label;

  document.getElementById('res-title-inline').textContent = c.label.replace('Development','Developer');

  document.getElementById('res-desc').textContent = 'Berdasarkan jawabanmu, kamu memiliki potensi besar untuk berkembang sebagai '+c.label+'.';

  document.getElementById('fit-heading').textContent = 'Kenapa '+c.label+' Cocok Untukmu?';

  document.getElementById('about-title').textContent = 'Apa Itu '+c.label+'?';

  document.getElementById('about-desc').textContent = c.about;

  document.getElementById('about-emoji').innerHTML = fiIcon(c.emoji);

  const ABOUT_IMAGES = {

    web: 'assets/icon%20apa%20itu%20web%20develop.png',

    data: 'assets/Microsoft%20Office.png',

    scientist: 'assets/apa%20itiu%20data%20scientist.png',

    marketing: 'assets/Digital%20Marketing.png',

    security: 'assets/Cyber%20Security.png'

  };

  const aboutImg = ABOUT_IMAGES[topKey];

  if(aboutImg){

    document.getElementById('about-img').src = aboutImg;

    document.getElementById('about-img').alt = 'Ilustrasi '+c.label;

  }

  document.getElementById('about-visual').classList.toggle('has-img', Boolean(aboutImg));

  document.getElementById('curr-heading').textContent = 'Topik Utama dalam '+c.label;

  document.getElementById('curr-sub').textContent = 'Gambaran topik yang umumnya dipelajari secara bertahap untuk menekuni '+c.label+'.';



  const scoreRows = document.getElementById('score-rows');

  scoreRows.innerHTML='';

  [...c.scores].sort((a,b)=>b[1]-a[1]).forEach(([label,val,emoji],i)=>{

    const row = document.createElement('div');

    row.className='skill-row'+(i===0?' top':'');

    row.innerHTML = '<span class="skill-ic" style="color:'+c.color+';">'+fiIcon(emoji)+'</span>'+

      '<div class="skill-main"><div class="skill-top"><span class="skill-name">'+label+'</span>'+

      (i===0?'<span class="skill-badge">Tertinggi</span>':'')+

      '<span class="skill-pct">'+val+'%</span></div>'+

      '<div class="skill-bar"><span style="--w:'+val+'%"></span></div></div>';

    scoreRows.appendChild(row);

  });



  const quad = document.getElementById('match-quad');

  quad.querySelectorAll('.mq-part').forEach(el=>el.remove());

  const quadSkills = [...c.scores].sort((x,y)=>y[1]-x[1]).slice(0,4);

  ['tl','tr','bl','br'].forEach((pos,i)=>{

    const sk = quadSkills[i];

    if(!sk) return;

    const part = document.createElement('div');

    part.className = 'mq-part mq-'+pos;

    part.innerHTML = '<div class="mq-in"><b data-count="'+sk[1]+'">0%</b><span class="mq-name">'+sk[0]+'</span></div>';

    quad.appendChild(part);

  });

  const centerPct = document.getElementById('donut-pct');

  centerPct.dataset.count = matchPct;

  centerPct.textContent = '0%';

  const barFill = document.getElementById('mq-bar-fill');

  barFill.style.width = '0';

  quad.classList.remove('is-anim','is-live');

  if(quad._io) quad._io.disconnect();

  const playQuad = ()=>{

    void quad.offsetWidth; quad.classList.add('is-anim');

    setTimeout(()=>quad.classList.add('is-live'), 1400);

    barFill.style.width = matchPct+'%';

    countUp();

  };

  quad._io = new IntersectionObserver(entries=>{

    if(entries.some(e=>e.isIntersecting)){ quad._io.disconnect(); playQuad(); }

  }, {threshold:.35});

  quad._io.observe(quad);

  const countUp = ()=> quad.querySelectorAll('[data-count]').forEach((el,i)=>{

    const target = Number(el.dataset.count), delay = 250 + i*120, dur = 1100;

    const start = performance.now() + delay;

    const tick = now=>{

      const t = Math.min(1, Math.max(0, (now-start)/dur));

      el.textContent = Math.round(target*(1-Math.pow(1-t,3)))+'%';

      if(t<1) requestAnimationFrame(tick);

    };

    requestAnimationFrame(tick);

  });



  const fitGrid = document.getElementById('fit-grid');

  fitGrid.innerHTML='';

  c.fits.forEach(([title,desc,emoji])=>{

    const card = document.createElement('div');

    card.className='fit-card hi';

    card.innerHTML = '<div class="ic" style="background:'+c.bg+';color:'+c.color+';">'+fiIcon(emoji)+'</div><h4>'+title+'</h4><p>'+desc+'</p>';

    fitGrid.appendChild(card);

  });



  const otherWrap = document.getElementById('other-fields');

  otherWrap.innerHTML='';

  const OTHER_COLORS = ['#123E8C','#1A6FDF','#3FA4F2'];

  sortedKeys.filter(k=>k!==topKey).slice(0,3).forEach((k,i)=>{

    const f = CATS[k];

    const card = document.createElement('div');

    card.className = 'field-card';

    card.style.setProperty('--fc', OTHER_COLORS[i]);

    const shortDesc = f.about.split('. ')[0].replace(/\.$/, '') + '.';

    card.innerHTML = '<span class="field-tab">Pilihan #'+(i+1)+'</span>'+

      '<div class="field-body"><span class="field-ic">'+fiIcon(f.emoji)+'</span>'+

      '<div><h4>'+f.label+'</h4><p>'+shortDesc+'</p></div></div>';

    otherWrap.appendChild(card);

  });



  const roadmap = document.getElementById('roadmap');

  roadmap.innerHTML='';

  roadmap.classList.add('rr-list');

  const ROAD_ICONS = ['book-open-cover','code-simple','layers','settings','rocket-lunch'];

  c.roadmap.forEach(([title,desc],i)=>{

    const step = document.createElement('div');

    step.className='rr-item';

    step.innerHTML = '<div class="rr-num"><b>0'+(i+1)+'</b><span>Tahap</span></div>'+

      '<div class="rr-main"><div class="rr-text"><h5>'+title+'</h5><p>'+desc+'</p></div>'+

      '<span class="rr-ic"><i class="fi fi-rr-'+ROAD_ICONS[i % ROAD_ICONS.length]+'" aria-hidden="true"></i></span></div>';

    roadmap.appendChild(step);

  });

  animateRoadmap(roadmap);

  setupRoadDots(roadmap);



  const currGrid = document.getElementById('curr-grid');

  currGrid.innerHTML='';

  c.curriculum.forEach(([title,emoji],i)=>{

    const card = document.createElement('div');

    card.className='curr-card';

    const iconMarkup = fiIcon(emoji);

    card.innerHTML = '<span class="curr-index">0'+(i+1)+'</span><div class="ic" style="background:'+c.bg+';color:'+c.color+';">'+iconMarkup+'</div><h5>'+title+'</h5>';

    currGrid.appendChild(card);

  });

  setupCurrArrows();



  document.getElementById('alumni-role-1').textContent = c.label+' & Gojek';

}



testSupabaseConnection();



/* ---------------- Slider testimoni (geser manual) ---------------- */

function setupTestiSliders(){

  document.querySelectorAll('.testi-track').forEach(track=>{

    const section = track.closest('.container');

    const prev = section.querySelector('.testi-prev');

    const next = section.querySelector('.testi-next');

    const nav = section.querySelector('.testi-nav');

    if(!prev || !next) return;

    const step = ()=>{

      const card = track.querySelector('.testi-card');

      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;

      return card ? card.getBoundingClientRect().width + gap : track.clientWidth;

    };

    const update = ()=>{

      const max = track.scrollWidth - track.clientWidth;

      prev.disabled = track.scrollLeft <= 4;

      next.disabled = track.scrollLeft >= max - 4;

      nav.classList.toggle('is-hidden', max <= 4);

    };

    prev.addEventListener('click', ()=>track.scrollBy({left:-step(), behavior:'smooth'}));

    next.addEventListener('click', ()=>track.scrollBy({left:step(), behavior:'smooth'}));

    track.addEventListener('scroll', update, {passive:true});

    new ResizeObserver(update).observe(track);

    update();

  });

}

setupTestiSliders();



/* ---------------- Pratinjau halaman hasil ---------------- */

function previewResultFromHash(){

  const m = location.hash.match(/^#hasil(?:=(\w+))?$/);

  if(!m) return;

  const top = CATS[m[1]] ? m[1] : 'web';

  const sample = {web:3,data:3,scientist:3,marketing:3,security:3};

  sample[top] = 6;

  const sorted = Object.keys(sample).sort((a,b)=>sample[b]-sample[a]);

  if(!userName) userName = 'Kamu';

  renderResult(top, sorted, sample);

  showView('view-result');

  showSampleAiAnalysis(top);

}



function showSampleAiAnalysis(topKey){

  const label = CATS[topKey].label;

  document.getElementById('ai-card').hidden = false;

  document.getElementById('ai-loading').hidden = true;

  document.getElementById('ai-error').hidden = true;

  document.getElementById('ai-content').hidden = false;

  document.getElementById('ai-summary').textContent = 'Kamu menunjukkan kecenderungan kuat untuk berpikir logis dan senang membangun sesuatu dari nol. Kombinasi ini membuatmu sangat cocok untuk menekuni '+label+'.';

  fillList('ai-strengths', ['Pemecahan masalah yang sistematis','Rasa ingin tahu tinggi terhadap teknologi','Tekun saat belajar hal baru']);

  fillList('ai-growth', ['Kemampuan komunikasi ide ke tim','Manajemen waktu saat mengerjakan proyek']);

  document.getElementById('ai-reason').textContent = 'Jawabanmu banyak mengarah pada aktivitas membangun dan menganalisis, yang merupakan inti pekerjaan di bidang '+label+'.';

  fillList('ai-careers', ['Front-End Developer','Back-End Developer','Full-Stack Developer']);

  document.getElementById('ai-alt').textContent = 'Data Analyst juga bisa menjadi pilihan karena kamu teliti dan suka mengolah informasi.';

  fillList('ai-steps', ['Pelajari dasar HTML, CSS, dan JavaScript','Buat 2–3 proyek kecil untuk portofolio','Ikuti program belajar terstruktur di Haltev']);

  ['ai-reason-block','ai-careers-block','ai-alt-block','ai-steps-block'].forEach(id=>document.getElementById(id).hidden=false);

}

window.addEventListener('hashchange', previewResultFromHash);

previewResultFromHash();



/* ---------------- Program card reveal ---------------- */

(function(){

  var cards = document.querySelectorAll('.program-card');

  cards.forEach(function(card, i){

    var link = card.querySelector('a[href]');

    if(link){

      card.setAttribute('tabindex','0');

      card.setAttribute('role','link');

      card.addEventListener('click', function(e){

        if(e.target.closest('a')) return;

        if(link.getAttribute('target')==='_blank') window.open(link.href,'_blank','noopener');

        else window.location.href = link.href;

      });

      card.addEventListener('keydown', function(e){

        if(e.key==='Enter' || e.key===' '){ e.preventDefault(); link.click(); }

      });

    }

    card.classList.add('reveal-init');

    card.style.transitionDelay = ((i % 4) * 0.12) + 's';

  });

  if('IntersectionObserver' in window){

    var revealObserver = new IntersectionObserver(function(entries){

      entries.forEach(function(entry){

        if(entry.isIntersecting){

          entry.target.classList.add('is-visible');

          revealObserver.unobserve(entry.target);

        }

      });

    },{threshold:0.15});

    cards.forEach(function(card){ revealObserver.observe(card); });

  } else {

    cards.forEach(function(card){ card.classList.add('is-visible'); });

  }

})();
