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

try { localStorage.removeItem('nama'); } catch(err) {}



function showBioForm(){

  userName = '';

  userPhone = '';

  currentUserId = null;

  currentAttemptId = null;

  document.getElementById('bio-name').value = '';

  document.getElementById('bio-phone').value = '';

  showView('view-bio');

}
window.showBioForm = showBioForm;

async function submitBioForm(e){

  e.preventDefault();

  userName = document.getElementById('bio-name').value.trim();

  userPhone = document.getElementById('bio-phone').value.trim();

  if(!userName || !userPhone) return;



  const btn = e.target.querySelector('button[type="submit"]');

  const btnText = btn.innerHTML;

  btn.disabled = true;

  btn.classList.add('is-loading');

  btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span> Menyiapkan tes...';

  const slowTimer = setTimeout(()=>{ btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span> Koneksi lambat, mohon tunggu...'; }, 6000);



  const ok = await createUserAndAttempt();



  clearTimeout(slowTimer);

  btn.disabled = false;

  btn.classList.remove('is-loading');

  btn.innerHTML = btnText;

  if(!ok) return;



  startQuiz();

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
  // 1. Validasi data peserta
  if (!userName || !userPhone) {
    throw new Error('Nama dan nomor HP wajib diisi.');
  }

  // 2. Cari peserta berdasarkan nomor HP
  const { data: existingUser, error: findUserError } = await supabaseClient
    .from('users')
    .select('id')
    .eq('phone', userPhone)
    .maybeSingle();

  if (findUserError) {
    throw new Error(`Gagal mencari peserta: ${findUserError.message}`);
  }

  // 3. Gunakan peserta lama atau buat peserta baru
  if (existingUser) {
    currentUserId = existingUser.id;
  } else {
    const { data: newUser, error: userError } = await supabaseClient
      .from('users')
      .insert({ name: userName, phone: userPhone })
      .select('id')
      .single();

    if (userError) {
      throw new Error(`Gagal menyimpan peserta: ${userError.message}`);
    }

    if (!newUser || newUser.id == null) {
      throw new Error('ID peserta tidak berhasil diperoleh.');
    }

    currentUserId = newUser.id;
  }

  // 4. Buat percobaan kuis melalui RPC Supabase.
  // Pastikan fungsi create_quiz_attempt sudah dibuat di database.
  const { data: attemptId, error: attemptError } = await supabaseClient.rpc(
    'create_quiz_attempt',
    { p_user_id: currentUserId }
  );

  if (attemptError) {
    throw new Error(`Gagal membuat percobaan kuis: ${attemptError.message}`);
  }

  if (attemptId == null || attemptId === '') {
    throw new Error('Supabase tidak mengembalikan ID percobaan kuis.');
  }

  currentAttemptId = attemptId;
  console.log('Peserta tersimpan:', currentUserId);
  console.log('Percobaan kuis tersimpan:', currentAttemptId);
  return true;
}

async function saveQuizResultToSupabase(topKey, rawScores){

  if(!currentAttemptId){

    throw new Error('currentAttemptId kosong. Quiz attempt belum dibuat.');

  }



  const answerRows = answers

    .map((selectedIndex, questionIndex) => {

      if(selectedIndex === null) return null;



      const question = QUESTIONS[questionIndex];

      const option = question?.opts?.[selectedIndex];

      if(!option) return null;



      return {

        attempt_id: currentAttemptId,

        question_number: Number(question.question_number ?? questionIndex + 1),

        answer_text: String(option[0]),

        category: String(option[1])

      };

    })

    .filter(Boolean);



  if(answerRows.length){

    const { error: answerError } = await supabaseClient

      .from('quiz_answers')

      .insert(answerRows);



    if(answerError) throw answerError;

  }



  const { error: attemptError } = await supabaseClient

    .from('quiz_attempts')

    .update({

      completed_at: new Date().toISOString(),

      status: 'completed'

    })

    .eq('id', currentAttemptId);



  if(attemptError) throw attemptError;

}



/* ---------------- Quiz data ---------------- */

const CATS = {

  web:   {label:'Web Development', emoji:'💻', color:'#0B6FF2', bg:'#E9F0FF',

          about:'Web Development adalah proses membangun dan mengembangkan website atau aplikasi berbasis web, mulai dari tampilan, interaksi, hingga fungsi yang berjalan di dalamnya.',

          roadmap:[['HTML & CSS','Membuat struktur dan tampilan website.'],['JavaScript','Membuat website lebih interaktif.'],['Database','Menyimpan dan mengelola data.'],['Backend Development','Membangun sistem & logic.'],['Deployment','Membuat website dapat diakses.']],

          curriculum:[['Fundamental Web','🌐'],['JavaScript','🟨'],['Front-End Development','🎨'],['Back-End Development','🗄️'],['Project','🚀']],

          fits:[['Kamu Suka Memecahkan Masalah','Kamu menyukai tantangan analitis dan logika yang kuat.','🧩'],['Kamu Tertarik dengan Teknologi','Kamu memiliki ketertarikan tinggi terhadap teknologi baru.','🎓'],['Kamu Kreatif dan Inovatif','Kamu punya imajinasi dan merancang tampilan menarik.','🎨'],['Kamu Suka Membangun Sesuatu','Kamu senang melihat ide berubah jadi produk yang nyata.','🚀']],

          scores:[['Problem Solving',90,'🧩'],['Logical Thinking',85,'💡'],['Technology Interest',88,'🖥️'],['Creativity',70,'🎨']]},

  data:  {label:'Data Analyst', emoji:'📊', color:'#1E9E5A', bg:'#E9F7EE',

          about:'Data Analytics adalah proses mengumpulkan, membersihkan, dan mengolah data mentah menjadi insight yang membantu pengambilan keputusan bisnis.',

          roadmap:[['Excel & SQL','Mengolah dan menganalisis data dasar.'],['Statistik','Memahami pola dan tren data.'],['Visualisasi Data','Menyajikan data secara visual.'],['Python/R','Automasi analisis data.'],['Business Insight','Menerjemahkan data jadi keputusan.']],

          curriculum:[['Fundamental Data','📂'],['SQL & Excel','🧮'],['Statistika','📊'],['Visualisasi','📈'],['Project','🚀']],

          fits:[['Kamu Suka Angka dan Pola','Kamu senang menemukan pola tersembunyi di balik data.','🔢'],['Kamu Teliti dan Sistematis','Kamu memperhatikan detail kecil dengan cermat.','🔍'],['Kamu Suka Mengambil Keputusan','Kamu senang membantu tim mengambil keputusan tepat.','📌'],['Kamu Suka Bercerita Lewat Data','Kamu senang menyajikan angka jadi insight yang mudah dipahami.','📊']],

          scores:[['Analytical Thinking',92,'🔢'],['Attention to Detail',88,'🔍'],['Logical Thinking',84,'💡'],['Communication',68,'💬']]},

  scientist: {label:'Data Scientist', emoji:'🧬', color:'#7C5CE0', bg:'#F1ECFE',

          about:'Data Scientist merancang model dan algoritma untuk mengekstrak insight mendalam dari data, termasuk penerapan machine learning dan AI.',

          roadmap:[['Matematika & Statistik','Fondasi analisis data tingkat lanjut.'],['Python','Bahasa utama data science.'],['Machine Learning','Membangun model prediktif.'],['Data Engineering','Mengelola pipeline data besar.'],['Model Deployment','Menerapkan model ke produksi.']],

          curriculum:[['Statistika Lanjut','📐'],['Python for DS','🐍'],['Machine Learning','🤖'],['Deep Learning','🧠'],['Capstone Project','🚀']],

          fits:[['Kamu Suka Eksperimen','Kamu senang menguji berbagai pendekatan untuk hasil terbaik.','🧪'],['Kamu Berpikir Analitis Mendalam','Kamu menikmati masalah kompleks dan abstrak.','🧠'],['Kamu Tertarik pada AI','Kamu penasaran dengan teknologi kecerdasan buatan.','🤖'],['Kamu Suka Riset Mendalam','Kamu senang menggali data untuk menemukan jawaban baru.','🔬']],

          scores:[['Analytical Thinking',94,'🧠'],['Math & Statistics',89,'📐'],['Programming',82,'💻'],['Curiosity',91,'🔭']]},

  marketing: {label:'Digital Marketing', emoji:'📣', color:'#E07A1E', bg:'#FFF1E4',

          about:'Digital Marketing adalah strategi memasarkan produk atau jasa melalui platform digital seperti media sosial, SEO, dan iklan online.',

          roadmap:[['Dasar Pemasaran','Memahami target pasar dan brand.'],['SEO & Content','Meningkatkan visibilitas online.'],['Social Media Ads','Menjalankan kampanye berbayar.'],['Analytics','Mengukur performa kampanye.'],['Strategy & Growth','Merancang strategi pertumbuhan.']],

          curriculum:[['Fundamental Marketing','📣'],['SEO & SEM','🔍'],['Social Media Ads','📱'],['Content Strategy','✍️'],['Project','🚀']],

          fits:[['Kamu Suka Bercerita','Kamu pandai menyampaikan pesan yang menarik.','📝'],['Kamu Kreatif dalam Berkomunikasi','Kamu suka membuat konten yang engaging.','🎨'],['Kamu Peka Terhadap Tren','Kamu cepat menangkap tren yang sedang berkembang.','📈'],['Kamu Suka Membangun Brand','Kamu senang melihat sebuah brand tumbuh dan dikenal.','🚀']],

          scores:[['Communication',90,'💬'],['Creativity',86,'🎨'],['Trend Awareness',88,'📈'],['Strategic Thinking',72,'♟️']]},

  security: {label:'Cyber Security', emoji:'🛡️', color:'#2B6FE0', bg:'#E8F1FF',

          about:'Cyber Security adalah bidang yang berfokus pada melindungi sistem, jaringan, dan data dari ancaman dan serangan digital.',

          roadmap:[['Dasar Jaringan','Memahami cara kerja jaringan komputer.'],['Sistem Operasi & Linux','Mengelola sistem secara aman.'],['Keamanan Aplikasi','Mengidentifikasi celah keamanan.'],['Ethical Hacking','Menguji ketahanan sistem.'],['Incident Response','Menangani insiden keamanan.']],

          curriculum:[['Fundamental Security','🛡️'],['Jaringan Komputer','🌐'],['Ethical Hacking','🕵️'],['Keamanan Aplikasi','🔐'],['Project','🚀']],

          fits:[['Kamu Suka Memecahkan Masalah','Kamu menyukai tantangan menemukan celah sistem.','🧩'],['Kamu Teliti dan Waspada','Kamu memperhatikan detail dan potensi risiko.','🔍'],['Kamu Suka Tantangan Logika','Kamu senang berpikir seperti penyerang maupun pertahanan.','♟️'],['Kamu Suka Menjaga Sistem Tetap Aman','Kamu peduli melindungi data dan pengguna dari ancaman.','🛡️']],

          scores:[['Problem Solving',89,'🧩'],['Attention to Detail',91,'🔍'],['Logical Thinking',87,'💡'],['Persistence',80,'⛰️']]}

};



const QUESTIONS = [

  {q:'Apa yang paling menarik perhatian kamu?', opts:[

    ['Membuat website atau aplikasi','web','💻'],

    ['Mengolah angka dan data','data','📊'],

    ['Membuat desain visual','marketing','🎨'],

    ['Membuat strategi pemasaran','marketing','📣'],

    ['Mencari dan memecahkan masalah keamanan','security','🛡️'],

    ['Bereksperimen dengan teknologi AI','scientist','🧬']

  ]},

  {q:'Saat menghadapi masalah, kamu cenderung...', opts:[

    ['Mencari solusi logis langkah demi langkah','web','🧩'],

    ['Menganalisis data untuk menemukan pola','data','🔢'],

    ['Mencari sudut pandang kreatif','marketing','💡'],

    ['Menguji berbagai kemungkinan secara sistematis','security','🔍'],

    ['Membuat model atau eksperimen','scientist','🧪']

  ]},

  {q:'Aktivitas mana yang paling kamu nikmati di waktu luang?', opts:[

    ['Membuat sesuatu dari kode/coding kecil-kecilan','web','💻'],

    ['Membaca laporan atau statistik menarik','data','📈'],

    ['Membuat konten untuk media sosial','marketing','📱'],

    ['Menonton video tentang hacking/keamanan siber','security','🛡️'],

    ['Membaca riset tentang AI & teknologi baru','scientist','🧬']

  ]},

  {q:'Kekuatan utama kamu menurut orang lain adalah...', opts:[

    ['Logika dan pemecahan masalah','web','🧩'],

    ['Ketelitian dan kesabaran menganalisis','data','🔍'],

    ['Komunikasi dan kreativitas','marketing','🎨'],

    ['Kewaspadaan dan kehati-hatian','security','🕵️'],

    ['Rasa ingin tahu yang tinggi','scientist','🔭']

  ]},

  {q:'Jenis proyek seperti apa yang paling ingin kamu kerjakan?', opts:[

    ['Membangun aplikasi atau website dari nol','web','🖥️'],

    ['Menyusun dashboard analisis bisnis','data','📊'],

    ['Merancang kampanye iklan digital','marketing','📣'],

    ['Menguji celah keamanan sebuah sistem','security','🛡️'],

    ['Melatih model prediksi berbasis data','scientist','🧬']

  ]},

  {q:'Bagaimana kamu lebih suka bekerja?', opts:[

    ['Fokus mendalam menyusun sistem/kode','web','💻'],

    ['Mengeksplorasi data secara detail','data','🔎'],

    ['Kolaboratif dan penuh ide baru','marketing','🤝'],

    ['Waspada memantau potensi risiko','security','🚨'],

    ['Bereksperimen dan menguji hipotesis','scientist','🧪']

  ]},

  {q:'Topik apa yang paling ingin kamu pelajari lebih dalam?', opts:[

    ['Bahasa pemrograman & framework web','web','🧑‍💻'],

    ['Statistik dan visualisasi data','data','📐'],

    ['SEO, iklan, dan branding','marketing','🚀'],

    ['Jaringan dan sistem keamanan','security','🔐'],

    ['Machine learning dan kecerdasan buatan','scientist','🤖']

  ]},

  {q:'Kesuksesan karier bagi kamu artinya...', opts:[

    ['Bisa membangun produk digital yang dipakai banyak orang','web','🌐'],

    ['Bisa membantu bisnis mengambil keputusan lebih baik','data','📊'],

    ['Bisa membuat brand dikenal luas','marketing','📣'],

    ['Bisa menjaga sistem tetap aman dari ancaman','security','🛡️'],

    ['Bisa menciptakan teknologi yang inovatif','scientist','🧬']

  ]},

  {q:'Mata pelajaran atau bidang apa yang paling kamu sukai saat sekolah/kuliah?', opts:[

    ['Matematika & logika','web','🧮'],

    ['Statistik & ekonomi','data','📊'],

    ['Seni & bahasa','marketing','🎨'],

    ['Komputer & jaringan','security','🛡️'],

    ['Sains & riset','scientist','🧬']

  ]},

  {q:'Ketika belajar hal baru, kamu lebih suka...', opts:[

    ['Langsung praktik membuat sesuatu','web','🛠️'],

    ['Mempelajari data dan studi kasus nyata','data','📈'],

    ['Melihat contoh kreatif dari orang lain','marketing','🖼️'],

    ['Memahami sistem secara mendalam sebelum bertindak','security','🔐'],

    ['Bereksperimen sendiri sampai menemukan pola','scientist','🧪']

  ]},

  {q:'Dalam sebuah tim, peran apa yang biasa kamu ambil?', opts:[

    ['Yang membangun/menyusun solusi teknis','web','💻'],

    ['Yang menganalisis data untuk tim','data','🔢'],

    ['Yang menyampaikan ide ke audiens','marketing','📣'],

    ['Yang menjaga keamanan dan mengecek risiko','security','🕵️'],

    ['Yang mengusulkan pendekatan baru','scientist','🧬']

  ]},

  {q:'Hal apa yang membuatmu paling puas setelah menyelesaikan sesuatu?', opts:[

    ['Melihat aplikasi/website berjalan dengan baik','web','🖥️'],

    ['Menemukan insight penting dari data','data','📊'],

    ['Kampanye yang berhasil menjangkau banyak orang','marketing','📣'],

    ['Sistem yang berhasil diamankan dari ancaman','security','🛡️'],

    ['Model atau teknologi baru yang berhasil dibuat','scientist','🧬']

  ]},

  {q:'Media atau konten seperti apa yang paling sering kamu konsumsi?', opts:[

    ['Tutorial coding & tech review','web','💻'],

    ['Laporan riset & infografik data','data','📈'],

    ['Konten kreatif & tren media sosial','marketing','📱'],

    ['Berita seputar peretasan & keamanan siber','security','🛡️'],

    ['Artikel tentang AI & inovasi teknologi','scientist','🧬']

  ]},

  {q:'Jika diberi waktu luang 1 minggu, kamu ingin belajar tentang...', opts:[

    ['Membuat aplikasi sederhana','web','📱'],

    ['Mengolah data dengan spreadsheet/SQL','data','📊'],

    ['Membuat konten & strategi promosi','marketing','📣'],

    ['Dasar-dasar keamanan siber','security','🔐'],

    ['Dasar-dasar machine learning','scientist','🧬']

  ]},

  {q:'Kalimat mana yang paling menggambarkan dirimu?', opts:[

    ['"Aku suka membangun sesuatu dari nol."','web','🧩'],

    ['"Aku suka menemukan makna di balik angka."','data','🔢'],

    ['"Aku suka menyampaikan ide dengan menarik."','marketing','🎨'],

    ['"Aku suka menjaga sesuatu tetap aman."','security','🛡️'],

    ['"Aku suka mencoba hal baru yang belum banyak orang tahu."','scientist','🧬']

  ]}

];



const QUESTIONS_PER_PAGE = 5;

let currentQ = 0;

let answers = new Array(QUESTIONS.length).fill(null);



let quizLoadedFromSupabase = false;



function normalizeOption(row, fallbackCategory='web') {

  const text = row.option_text ?? row.text ?? row.answer_text ?? row.label ?? row.option ?? '';

  const cat = row.category ?? row.cat ?? row.result_category ?? fallbackCategory;

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



async function computeResult(){

  const scores = {web:0,data:0,scientist:0,marketing:0,security:0};

  answers.forEach((idx,qi)=>{

    if(idx===null) return;

    const cat = QUESTIONS[qi].opts[idx][1];

    scores[cat] = (scores[cat]||0) + 1;

  });



  let top = 'web', max = -1;

  Object.keys(scores).forEach(k=>{

    if(scores[k]>max){

      max=scores[k];

      top=k;

    }

  });



  const sorted = Object.keys(scores).sort((a,b)=>scores[b]-scores[a]);



  try {

    await saveQuizResultToSupabase(top, scores);

  } catch(error) {

    console.error('Gagal menyimpan hasil quiz:', error);

    alert('Hasil quiz belum tersimpan ke database. Cek Console (F12) untuk detail error.');

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
