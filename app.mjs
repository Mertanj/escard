import {TOPICS, TOPIC_MAP, QUESTION_MAP, VOCAB, SOURCES} from './data.mjs';
import {STORAGE_KEY, freshState, validateState, makeQuiz, answerQuiz, nextQuiz, sessionScore,
  topicStatus, weakTopics, makeVocab, grammarCards, shuffle, normalize} from './core.mjs';
import {MAX_PHOTOS, OCR_SETTINGS_KEY, preparePhoto, extractPhoto, prepareImport, cardFromEntry, serviceURL} from './media.mjs';

const $ = selector => document.querySelector(selector);
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state = freshState();
let storageError = '';
let recoveryMessage = '';
let menuOpen = false;
let filter = 'all';
let quizWritten = false;
let cardFlipped = false;
let modal = null;
let toastTimer;
let importCandidate = null;
let editingCard = null;
let sketch = false;
let scaleIndex = 0;
let photoState = {photos:[],entries:[],busy:false,error:'',message:''};
let photoSettings = {endpoint:''};
let photoAccessCode = ''; // Yalnızca açık sayfanın belleği; yedek veya GitHub dosyasına yazılmaz.
let photoController;
try {const stored=JSON.parse(localStorage.getItem(OCR_SETTINGS_KEY)||'{}');if(typeof stored.endpoint==='string')photoSettings.endpoint=serviceURL(stored.endpoint);} catch {}

try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { state = validateState(JSON.parse(raw)); }
    catch {
      const backup = localStorage.getItem(`${STORAGE_KEY}.backup`);
      if (backup) {
        state = validateState(JSON.parse(backup));
        localStorage.setItem(`${STORAGE_KEY}.unreadable`, raw);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        recoveryMessage = 'Son kayıt okunamadı. Bir önceki otomatik kayıttan devam ediyorsun; okunamayan kayıt ayrıca korundu.';
      }
      else storageError = 'Önceki kayıt okunamadı. Özgün kayıt korunuyor; Kayıt ve yedek bölümünden indirip yeni bir kayıt başlatabilirsin.';
    }
  }
} catch { storageError = 'Tarayıcı kayıt alanına erişilemiyor. Çalışmanı bitirince yedeğini indir; sayfayı kapatırsan kayıt kaybolabilir.'; }

function save() {
  state.updatedAt = new Date().toISOString();
  try {
    // Bozuk özgün kaydın üstüne sessizce yazma.
    const old = localStorage.getItem(STORAGE_KEY);
    if (old) {
      try { validateState(JSON.parse(old)); }
      catch { throw new Error('Önceki kayıt okunamıyor. Kayıt ve yedek bölümünden özgün kaydı indir ve yeni kayıt başlat.'); }
      localStorage.setItem(`${STORAGE_KEY}.backup`, old);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageError = '';
  } catch (error) {
    storageError = error.message?.startsWith('Önceki') ? error.message : 'Kayıt yapılamadı. Çalışman şu an açık sayfada; Kayıt ve yedek bölümünden yedeğini indir.';
  }
}
function notify(message) {
  clearTimeout(toastTimer);
  $('#notice').textContent = message;
  $('#notice').classList.add('visible');
  toastTimer = setTimeout(() => $('#notice').classList.remove('visible'), 5000);
}
function go(path) { menuOpen = false; location.hash = path; if (route() === path) render(); }
function route() { return location.hash.slice(1) || 'home'; }
const date = time => new Date(time).toLocaleString('tr-TR', {day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
const label = status => ({unknown:'Henüz taranmadı',needs:'Tekrar çalış',clear:'Taramada doğru',passed:'Tekrar testi tam'}[status]);
function icon(name) {
  const paths = {
    home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    book:'<path d="M12 6c-3-2-6-3-10-2v15c4-1 7 0 10 2 3-2 6-3 10-2V4c-4-1-7 0-10 2Zm0 0v15"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    test:'<rect x="5" y="4" width="15" height="18" rx="2"/><path d="M9 2h7v4H9zM9 11h7M9 16h7"/>',
    cards:'<rect x="7" y="6" width="14" height="16" rx="2"/><path d="M4 18H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1M11 12h6M11 16h4"/>',
    chart:'<path d="M4 3v17h17M8 15v-4M13 15V6M18 15V9"/>',
    arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
    back:'<path d="M20 12H5m6-6-6 6 6 6"/>',
    chevron:'<path d="m9 5 7 7-7 7"/>',
    leaf:'<path d="M20 3C9 2 2 7 5 15c8 6 16 0 15-12ZM4 21 16 8"/>',
    save:'<path d="M20 8V4H4v16h16v-8M8 4v6h8V4M8 20v-6h8v6"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    plus:'<path d="M12 4v16M4 12h16"/>',
    trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
    edit:'<path d="m4 16-1 5 5-1L21 7l-4-4ZM14 6l4 4"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    camera:'<path d="m8 5 2-3h4l2 3h5v15H3V5z"/><circle cx="12" cy="12" r="4"/>',
    image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.book}</svg>`;
}
function button(text, action, extra = '', css = 'primary') { return `<button class="btn ${css}" data-action="${action}" ${extra}>${text}</button>`; }
function heading(title, subtitle, tag='NETZWERK NEU · A2.2') {
  return `<div class="page-heading"><div><div class="overline">${escape(tag)}</div><h1>${escape(title)}</h1>${subtitle ? `<p class="subheading">${escape(subtitle)}</p>` : ''}</div><span class="pill">${icon('leaf')} B1.1’e bir adım</span></div>`;
}
function topicRow(t, index) {
  const s = topicStatus(state, t.id);
  return `<a class="topic-row" href="#topic/${t.id}"><div class="left"><span class="topic-number">${String(index + 1).padStart(2,'0')}</span><div><h3>${escape(t.title)}</h3><div class="sub">${escape(t.de)} · Bölüm ${t.chapter}${s.studied ? ' · Çalışıldı ✓' : ''}</div></div></div><div class="right"><span class="status ${s.status}">${s.current.length ? `${s.current.filter(a=>a.correct).length}/${s.current.length} · ` : ''}${label(s.status)}</span>${icon('chevron')}</div></a>`;
}
function plan() { return '<div class="es-plan" aria-hidden="true"><span class="es-plan-label top">PLAN / A2.2</span><div class="es-plan-room"><span class="es-door"></span></div><span class="es-plan-word">a → b</span><span class="es-plan-mark">+</span><span class="es-plan-label bottom">DETAY 01</span></div>'; }
function footer() { return `<footer class="footer"><span>Türkçe / Deutsch</span><span class="es-bottom-note">${['Küçük adımlar, sağlam bir temel.','Önce temel, sonra bir kat daha.','Her detay, bütüne bir adım.'][scaleIndex]}</span><button class="es-scale" data-action="scale" aria-label="Ölçek, küçük bir sürpriz">${['1 : 1','1 : 20','1 : 50'][scaleIndex]}</button></footer>`; }
function render() {
  const path = route();
  const tab = path.split('/')[0];
  const weak = weakTopics(state);
  const nav = [['home','home','Çalışma masam'],['diagnostic','test','İlk tarama'],['topics','book','Gramer atölyesi'],['vocab','cards','Kelime kartlarım'],['progress','chart','Çalışma özeti']];
  const body = view(path);
  document.body.classList.toggle('menu-open', menuOpen);
  $('#app').innerHTML = `<div class="shell ${sketch?'es-sketched':''}"><button class="menu-shade" data-action="menu" aria-label="Menüyü kapat"></button>
    <aside class="sidebar" id="sidebar" aria-label="Ana menü"><button class="es-logo" data-action="sketch" aria-label="ESCARD, çizim ızgarasını aç veya kapat" aria-pressed="${sketch}"><span class="es-symbol" aria-hidden="true"><i></i><i></i><i></i></span><span class="es-wordmark">ESCARD</span></button><div class="edition">BİR SONRAKİ ADIM.</div>
    <nav class="nav">${nav.map(([id,glyph,name])=>`<a href="#${id}" class="${tab===id||id==='topics'&&tab==='topic'||id==='vocab'&&['cards','media'].includes(tab)?'active':''}" ${tab===id?'aria-current="page"':''}>${icon(glyph)}${name}${id==='topics'&&weak.length?`<span class="badge">${weak.length}</span>`:''}</a>`).join('')}</nav>
    ${['topics','topic'].includes(tab)?`<details class="side-topics" open><summary>Çalışma başlıklarım</summary><div class="topic-nav">${(weak.length?weak:TOPICS).map(t=>`<a href="#topic/${t.id}" class="${path===`topic/${t.id}`?'active':''}"><span class="dot ${topicStatus(state,t.id).status}"></span>${escape(t.title)}</a>`).join('')}</div></details>`:''}
    <div class="side-bottom"><nav class="nav"><a href="#settings" class="${tab==='settings'?'active':''}">${icon('save')}Kayıt ve yedek</a></nav><div class="side-note"><span class="es-tiny-plan" aria-hidden="true"></span><strong>Az az, sağlam sağlam.</strong><br>Bir hafta sonu.<br>Kendine ayırdığın bir alan.</div></div></aside>
    <div class="workspace"><header class="topbar"><div class="left"><button class="menu-button" data-action="menu" aria-label="Menüyü aç" aria-controls="sidebar" aria-expanded="${menuOpen}">${icon('menu')}</button><button class="es-mobile-logo" data-action="sketch" aria-label="ESCARD, çizim ızgarasını aç veya kapat" aria-pressed="${sketch}">ESCARD</button><span class="topbar-label">${({home:'ÇALIŞMA MASAM',diagnostic:state.active?.kind==='review'?'KONU TEKRARI':'İLK TARAMA',topics:'GRAMER ATÖLYESİ',topic:'KONU ÇALIŞMASI',vocab:'KELİME KARTLARIM',media:'DEFTERİMDEN KELİMELER',cards:'KART ÇALIŞMASI',progress:'ÇALIŞMA ÖZETİ',summary:'OTURUM ÖZETİ',settings:'KAYIT VE YEDEK'}[tab])||'ESCARD'}</span></div><div class="right"><span class="autosave ${storageError?'error':''}">${storageError?'Kayıt sorunu var':'Otomatik kayıt'}</span><span class="es-book-chip">Netzwerk neu / A2.2</span></div></header>
    <main class="main" id="main" tabindex="-1">${storageError?`<div class="savelimit" role="alert">${escape(storageError)} <a href="#settings"><u>Kayıt ve yedek</u></a></div>`:''}${body}${footer()}</main></div></div>${modal ? renderModal() : ''}`;
  document.title = `${({home:'Çalışma masam',diagnostic:state.active?.kind==='review'?'Konu tekrarı':'İlk tarama',topic:TOPIC_MAP[path.split('/')[1]]?.title,topics:'Gramer atölyesi',vocab:'Kelime kartlarım',media:'Defterimden kelimeler',cards:'Kart çalışması',progress:'Çalışma özeti',settings:'Kayıt ve yedek',summary:'Oturum özeti'}[tab])||'Almanca'} · ESCARD`;
  syncMenuAccessibility();
  if (modal) requestAnimationFrame(() => $('.modal button')?.focus());
}
function view(path) {
  const [tab, id] = path.split('/');
  if (tab === 'diagnostic') return state.active ? quizView() : diagnosticIntro();
  if (tab === 'topics') return topicsView();
  if (tab === 'topic') return TOPIC_MAP[id] ? topicView(TOPIC_MAP[id]) : homeView();
  if (tab === 'vocab') return vocabView();
  if (tab === 'media') return mediaView();
  if (tab === 'cards') return cardsView();
  if (tab === 'summary') return summaryView(state.sessions.find(s => s.id === id));
  if (tab === 'progress') return progressView();
  if (tab === 'settings') return settingsView();
  return homeView();
}
function homeView() {
  const baseline=[...state.sessions].reverse().find(s=>s.kind==='diagnostic');
  const weak=weakTopics(state);
  const passed=TOPICS.filter(t=>topicStatus(state,t.id).status==='passed').length;
  const next=weak[0];
  return `<section class="es-hero"><div><div class="overline">KENDİ HIZINDA, ADIM ADIM</div><h1>B1.1’e sağlam<br>bir başlangıç.</h1><p>Önce nerede olduğunu gör. Sonra ihtiyacın olan grameri çalış, tekrar et ve pekiştir.</p>
    ${state.active?button(`Kaldığım yerden devam ${icon('arrow')}`,'resume'):!baseline?button(`İlk taramaya başla ${icon('arrow')}`,'start-diagnostic'):next?`<a class="btn primary" href="#topic/${next.id}">Sıradaki konuma çalış ${icon('arrow')}</a>`:'<a class="btn primary" href="#topics">Gramer atölyeme git</a>'}
    <div class="es-hero-caption">${state.active?`${state.active.answers.length} / ${state.active.ids.length} cevap kaydedildi`:'42 soru · 14 konu · Türkçe / Almanca'}</div></div>${plan()}</section>
    <section class="es-journey" aria-label="Çalışma adımları">${[['01 / KEŞFET','Eksiklerini bul','Kısa açıklamalarla gramer taraması.'],['02 / PEKİŞTİR','Konuya odaklan','Anlatım, kartlar ve konuya özel testler.'],['03 / HATIRLA','Kendini tekrar dene','Hatalarına dön, gelişimini gör.']].map(([n,t,p])=>`<div class="es-step"><span class="es-step-index">${n}</span><h3>${t}</h3><p>${p}</p></div>`).join('')}</section>
    <div class="section-head"><h2>Çalışma masan</h2><span class="small muted">Bugün küçük bir adım yeter.</span></div>
    <div class="columns"><section class="panel"><div class="mini-label">GRAMER ATÖLYESİ</div><h3>${baseline?(weak.length?`${weak.length} konuya yeniden bakalım.`:'Taramadaki konuların yerinde.'): 'Önce sana ne gerektiğini bulalım.'}</h3><p class="small muted spaced">${baseline?`${passed} konuda son tekrar testi tam. Dilediğin başlığı açıp devam edebilirsin.`:'Tarama bittikten sonra çalışacağın konular burada belirir.'}</p><a class="text-button" href="#topics">Konu başlıklarına bak ${icon('arrow')}</a></section>
    <section class="panel tinted"><div class="mini-label">KELİME KARTLARIM</div><div class="es-word" lang="de">warten <span>___</span></div><p class="small muted">${state.cards.length?`${state.cards.length} kelime kartın çalışmanı bekliyor.`:'Defterindeki kelimeler, senin kartların.'}</p><div class="actions"><a class="text-button" href="#vocab">Kartlarıma git ${icon('arrow')}</a><a class="text-button" href="#media">${icon('camera')} Medya ekle</a></div></section></div>
    ${baseline&&weak.length?`<section class="section"><div class="section-head"><h2>Önce bunlara bakalım</h2><a href="#topics">Tüm konular</a></div><div class="topic-list">${weak.slice(0,3).map(topicRow).join('')}</div></section>`:''}`;
}
function diagnosticIntro() {
  return heading('Nereden başlayalım?', 'Önce gramerde hangi konuları tekrar etmen gerektiğini görelim.')+
    `<div class="quiz-wrap"><section class="panel"><span class="pill soft">42 soru · 14 konu</span><h2 class="spaced">Küçük bir tarama,<br>daha net bir çalışma planı.</h2><p class="subheading">Her konudan 3 soru var. Cevabından hemen sonra doğru biçimi ve Türkçe/Almanca açıklamayı göreceksin. İlk verdiğin cevap kaydolur.</p><div class="note">Bu bir gramer ihtiyaç taraması; resmî dil seviyesi sonucu vermez. Sonuçtaki 3 soruluk konu örneklerini çalışma önceliği olarak kullan.</div><p class="small muted">İstediğin yerde ara verebilirsin. Aynı iPad’de, aynı tarayıcıdan dönünce kaldığın soru açılır.</p>${button(`Taramaya başla ${icon('arrow')}`,'start-diagnostic')}
    ${state.sessions.some(s=>s.kind==='diagnostic')?'<p class="small muted spaced">Yeni tarama önceki sonuçlarını silmez. Konu önceliklerinde en son tamamlanan tarama kullanılır.</p>':''}</section></div>`;
}
function quizView() {
  const qz = state.active;
  const question = QUESTION_MAP[qz.ids[qz.index]];
  const topic = TOPIC_MAP[question.topicId];
  const answer = qz.answers[qz.index];
  const written = qz.kind==='review' ? !quizWritten : quizWritten;
  return heading(qz.kind==='diagnostic'?'Gramer taraması':`${TOPIC_MAP[qz.topicId].title} · Tekrar testi`, 'Düşün, cevapla ve açıklamaya göz at.')+
    `<div class="quiz-wrap"><div class="quiz-meta"><span>${qz.index+1} / ${qz.ids.length} soru</span><span>${escape(topic.de)}</span><span>${qz.answers.filter(a=>a.correct).length} doğru · ${qz.answers.filter(a=>!a.correct).length} yanlış</span></div><div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${qz.ids.length}" aria-valuenow="${qz.answers.length}" aria-label="Cevaplanan soru"><div class="progress-fill" style="width:${qz.answers.length/qz.ids.length*100}%"></div></div>
    <section class="quiz-card"><div class="overline">${qz.kind==='diagnostic'?'BOŞLUĞU TAMAMLA':'KONUYA ÖZEL · BOŞLUĞU TAMAMLA'}</div><h2 lang="de">${escape(question.prompt).replace('___','<span class="gap">_____</span>')}</h2>
    ${written ? `<form id="answer-form"><label class="screen-reader" for="answer">Cevabın</label><input class="answer-input" id="answer" name="answer" placeholder="Cevabını buraya yaz…" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="300" ${answer?'disabled':''} value="${escape(answer?.raw || '')}">${!answer?`<div class="characters">${['ä','ö','ü','ß'].map(c=>`<button type="button" data-action="char" data-value="${c}">${c}</button>`).join('')}</div><div class="actions spaced">${button('Cevabımı kontrol et','submit-answer','','primary')}</div>`:''}</form>` : `<div class="options">${qz.choices[qz.index].map((option,i)=>`<button class="option ${answer && option===question.answer?'correct':''} ${answer && option===answer.raw && !answer.correct?'wrong':''}" data-action="answer" data-option="${i}" ${answer?'disabled':''}><span class="letter">${String.fromCharCode(65+i)}</span><span lang="de">${escape(option)}</span>${answer&&option===question.answer?icon('check'):''}</button>`).join('')}</div>`}
    ${answer?`<div class="feedback ${answer.correct?'':'wrong'}" role="status"><strong>${answer.correct?'Doğru, güzel bir adım.':`Doğru cevap: ${escape(question.answer)}`}</strong>${!answer.correct?`<p>Senin cevabın: ${escape(answer.raw)}</p>`:''}<p>${escape(question.why)}</p></div>`:''}
    <div class="quiz-bottom"><span class="small muted">${answer?'İlk cevabın kaydedildi.':'Acele etmene gerek yok.'}</span>${answer?button(qz.index+1===qz.ids.length?`Özetimi gör ${icon('arrow')}`:`Sonraki soru ${icon('arrow')}`,'next-question'):button(written?'Şıkları göster':'Cevabı yazarak ver','toggle-quiz-mode','','ghost small')}</div></section>
    <p class="small muted spaced">${written?'Yalnızca boşluğa gelecek kısmı yaz. Büyük/küçük harf ayrımı yapılmaz; ä, ö, ü ve ß harflerini koru.':'Bir seçenek seçtiğinde yanıtın hemen kontrol edilir.'}</p><a class="backlink spaced" href="#home">${icon('back')} Ara ver · Cevaplarım kayıtta</a></div>`;
}
function topicsView() {
  const list = filter==='needs' ? weakTopics(state) : filter==='studied' ? TOPICS.filter(t=>state.studied[t.id]) : TOPICS;
  return heading('Gramer konularım','Yanlış yaptığın konuyu aç, çalış ve alttaki tekrar testiyle kendini kontrol et.')+
    `<div class="filters">${[['all','Tüm konular · 14'],['needs',`Tekrar çalış · ${weakTopics(state).length}`],['studied',`Çalıştıklarım · ${Object.keys(state.studied).length}`]].map(([id,text])=>`<button class="filter ${filter===id?'active':''}" data-action="filter" data-filter="${id}" aria-pressed="${filter===id}">${text}</button>`).join('')}</div>
    <div class="topic-list">${list.map(topicRow).join('') || '<div class="empty"><h3>Burada henüz bir konu yok.</h3><p>Taramayı tamamladığında çalışma önceliklerin burada görünecek.</p><a class="btn primary" href="#diagnostic">Gramer taramasına git</a></div>'}</div>`;
}
function topicView(t) {
  const status = topicStatus(state,t.id);
  const mistakes = status.current.filter(a=>!a.correct);
  return `<a class="backlink" href="#topics">${icon('back')} Gramer konularım</a>`+heading(t.title,t.intro,`BÖLÜM ${t.chapter} · ${t.de}`)+
    `<div class="actions"><span class="status ${status.status}">${label(status.status)}</span>${button(`${icon('cards')} Gramer kartlarıyla çalış`,'grammar-cards',`data-topic="${t.id}"`,'ghost small')}</div>
    ${mistakes.length?`<section class="section"><div class="section-head"><h2>Önce kendi yanlışlarına bak</h2></div>${mistakes.map(errorItem).join('')}</section>`:''}
    <section class="section"><div class="section-head"><h2>Konuyu birlikte toparlayalım</h2><span class="overline">TÜRKÇE + DEUTSCH</span></div><div class="rule-list">${t.rules.map(([title,example,why],i)=>`<article class="rule"><h3>${i+1}. ${escape(title)}</h3><div class="german" lang="de">${escape(example)}</div><p>${escape(why)}</p></article>`).join('')}</div><div class="examples">${t.examples.map(([de,tr])=>`<div class="example"><p lang="de">${escape(de)}</p><small>${escape(tr)}</small></div>`).join('')}</div></section>
    <div class="action-bar"><div><p><strong>${status.studied?'Konuyu çalıştığını işaretledin.':'Anlatımı ve örnekleri bitirdin mi?'}</strong></p><span class="small muted">Çalışma işareti ve test sonucu ayrı kaydedilir.</span></div>${button(status.studied?'✓ Çalışmam bitti':'Evet, bu konuyu çalıştım','studied',`data-topic="${t.id}"`,status.studied?'ghost':'primary')}</div>
    <section class="panel section"><div class="overline">ŞİMDİ KENDİNİ KONTROL ET</div><h2 class="spaced">Konu tekrar testi</h2><p class="subheading">4 soru, yalnızca bu konu. Önce cevabı yazmayı dene; istersen şıkları açabilirsin. Yanlış olursa açıklamaya dönüp yeniden test yap.</p>${button(`Tekrar testine başla ${icon('arrow')}`,'start-review',`data-topic="${t.id}"`)}<p class="small muted spaced">6 ayrı tekrar sorusu dönüşümlü kullanılır. Öncelik daha az gördüğün sorularda; sonraki turlarda aynı sorular yeniden gelebilir.</p></section>`;
}
function errorItem(a) {
  const q = QUESTION_MAP[a.questionId];
  return `<article class="error-item"><p lang="de">${escape(q.prompt)}</p><div class="comparison"><span>Senin cevabın: ${escape(a.raw)}</span><span class="good">Doğru cevap: ${escape(q.answer)}</span></div><p class="why">${escape(q.why)}</p><a class="text-button" href="#topic/${q.topicId}">${escape(TOPIC_MAP[q.topicId].title)} konusuna dön</a></article>`;
}
function summaryView(s) {
  if (!s) return heading('Çalışma özeti','Henüz tamamlanmış bir test seçmedin.')+'<a class="btn primary" href="#progress">Gelişimime git</a>';
  const score = sessionScore(s);
  const errors = s.answers.filter(a=>!a.correct);
  const groups = TOPICS.filter(t=>s.answers.some(a=>QUESTION_MAP[a.questionId].topicId===t.id));
  return heading('Bir adım daha attın.',s.kind==='diagnostic'?'Şimdi neye çalışacağını birlikte görelim.':`${TOPIC_MAP[s.topicId].title} · Konu tekrar özeti`)+
    `<section class="score-banner"><div class="score-circle"><strong>${score.right}/${score.total}</strong><small>ilk cevapta doğru</small></div><div><h2>${errors.length?`${errors.length} soruda bir öğrenme fırsatı.`:'Bu turdaki tüm sorular doğru.'}</h2><p>${s.kind==='review'?(errors.length?'Aşağıdaki yanlışlara bak, sonra konunun tamamından yeni bir tekrar testi dene.':'Konu tekrarında 4/4 yaptın. Bu bir çalışma sonucu; istersen daha sonra yeniden pekiştirebilirsin.'):'Her konudaki 3 soruluk örnek, hangi başlıklara öncelik vereceğini gösteriyor.'}</p></div></section>
    <div class="actions">${s.kind==='review'?`<a class="btn ghost" href="#topic/${s.topicId}">Konuya dön</a>${button('Yeni tekrar testi','start-review',`data-topic="${s.topicId}"`)}`:'<a class="btn primary" href="#topics">Konularıma çalış</a>'}<a class="btn ghost" href="#progress">Gelişimimi gör</a></div>
    <section class="section"><div class="section-head"><h2>Konu konu sonuç</h2><span class="small muted">${date(s.endedAt)}</span></div><div class="topic-list">${groups.map(t=>{const answers=s.answers.filter(a=>QUESTION_MAP[a.questionId].topicId===t.id);const wrong=answers.filter(a=>!a.correct).length;return `<a class="topic-row" href="#topic/${t.id}"><div><h3>${escape(t.title)}</h3><span class="sub">${escape(t.de)}</span></div><span class="status ${wrong?'needs':'passed'}">${answers.length-wrong}/${answers.length} doğru · ${wrong?'Tekrar çalış':'Bu tur doğru'}</span></a>`;}).join('')}</div></section>
    ${errors.length?`<section class="section"><div class="section-head"><h2>Yanlışlarımın özeti</h2></div><div class="error-list">${errors.map(errorItem).join('')}</div></section>`:''}`;
}
function vocabView() {
  const c = editingCard ? state.cards.find(c=>c.id===editingCard) : null;
  return heading('Kendi kelimelerin, kendi kartların.','Defterinden fotoğraf ekle veya kelimeni yaz. Kartın iki yüzü, senin seçtiğin karşılık.')+
    `<div class="media-banner"><div><h3>Defterini de buraya getirebilirsin.</h3><p>Almanca ve yanına yazdığın Türkçe ya da İngilizce karşılığı birlikte okuyalım.</p></div><a class="btn primary" href="#media">${icon('camera')} Medya ekle</a></div>`+
    `<div class="columns"><section class="panel"><h2>${c?'Kartımı düzenle':'Bir kelime ekle'}</h2><p class="small muted spaced">“warten auf”, “dürfen” veya öğrendiğin bir kelime.</p><form id="vocab-form"><label class="field">Kelime veya kalıp<input name="word" id="vocab-word" maxlength="160" required placeholder="Örn. warten auf" list="vocab-suggestions" value="${escape(c?.word || '')}" autocomplete="off" autocapitalize="off"></label><datalist id="vocab-suggestions">${VOCAB.map(v=>`<option value="${escape(v.word)}"></option>`).join('')}</datalist>
    <details ${c?'open':''} id="custom-card"><summary>Ön / arka yüzü kendim yazacağım</summary><label class="field">Ön yüz · Kelime veya boşluklu cümle<textarea name="front" maxlength="2000" placeholder="Ich warte ___ den Bus.">${escape(c?.front || '')}</textarea></label><label class="field">Arka yüz · Cevap veya Türkçe anlam<textarea name="back" maxlength="2000" placeholder="auf + Akkusativ">${escape(c?.back || '')}</textarea></label><label class="field">Örnek cümle · İsteğe bağlı<textarea name="example" maxlength="2000" placeholder="Ich warte auf den Bus. / Otobüsü bekliyorum.">${escape(c?.example || '')}</textarea></label></details><p id="vocab-error" class="form-error" role="alert"></p><div class="actions"><button class="btn primary" type="submit">${icon(c?'check':'plus')} ${c?'Değişiklikleri kaydet':'Kartımı oluştur'}</button>${c?button('Vazgeç','cancel-edit','','ghost'):''}</div></form><p class="small muted spaced">${VOCAB.length} hazır kelime ve kalıp otomatik karta dönüşür. Diğer kelimeler için ön ve arka yüzü sen belirlersin; anlam veya cümle tahmin edilmez.</p></section>
    <section class="panel tinted"><div class="overline">BİR KALIP, İKİ YÜZ</div><h2 class="spaced">Önce hatırla,<br>sonra çevir.</h2><div class="tiny-card"><div><div class="mini-label">ÖN YÜZ</div><div class="serif">warten ___</div></div></div><div class="tiny-card"><div><div class="mini-label">ARKA YÜZ</div><div class="serif">auf + Akkusativ</div><p>Ich warte auf den Bus.</p></div></div><p class="small muted">Modal fiillerde boşluklu örnek: Hier ___ man nicht rauchen. → darf</p></section></div>
    <section class="section"><div class="section-head"><h2>Kartlarım <span class="muted">· ${state.cards.length}</span></h2>${state.cards.length?button(`Kartları çalış ${icon('arrow')}`,'vocab-cards','','primary small'):''}</div>${state.cards.length?`<div class="word-list">${[...state.cards].reverse().map(c=>`<div class="word-row"><div class="wrap"><strong lang="de">${escape(c.word)}</strong><p>${escape(c.front)} → ${escape(c.back)}</p></div><div class="word-actions"><button data-action="edit-card" data-id="${escape(c.id)}" aria-label="${escape(c.word)} kartını düzenle">${icon('edit')}</button><button data-action="delete-card" data-id="${escape(c.id)}" aria-label="${escape(c.word)} kartını sil">${icon('trash')}</button></div></div>`).join('')}</div>`:'<div class="empty"><h3>İlk kelimenle başlayalım.</h3><p>Buradaki kartlar yalnızca senin eklediğin kelimelerden oluşacak.</p></div>'}</section>`;
}
function entryPreview(entry) {
  try {const c=cardFromEntry(entry);return `<span><small>ÖN YÜZ</small>${escape(c.front)}</span><span><small>ARKA YÜZ</small>${escape(c.back)}</span>`;}
  catch {return '<span class="muted small">Kart önizlemesi için kelimeyi ve karşılığını tamamla.</span>';}
}
function mediaView() {
  const selected=photoState.entries.filter(e=>e.selected).length;
  return `<a class="backlink" href="#vocab">${icon('back')} Kelime kartlarıma dön</a>`+
    heading('Defterinden, kartlarına.','El yazınla tuttuğun kelimeleri fotoğraftan okuyalım. Önce birlikte kontrol edelim, sonra kaydedelim.','KELİME KARTLARIM / MEDYA EKLE')+
    `<section class="media-workflow"><span>01 / FOTOĞRAF EKLE</span><span>02 / OKUNANLARI KONTROL ET</span><span>03 / KARTLARINA KAYDET</span></section>
    <section class="panel"><div class="section-head"><h2>Defter sayfanı ekle</h2><span class="small muted">${photoState.photos.length} / ${MAX_PHOTOS} fotoğraf</span></div><p class="small muted">Sayfa düz, yazı net ve Almanca–karşılık çiftleri aynı karede olsun. Türkçe yazdıysan Türkçe, İngilizce yazdıysan İngilizce kalacak.</p>
    <div class="actions spaced"><label class="btn primary file-button">${icon('camera')} Fotoğraf çek<input id="camera-photo" type="file" accept="image/*" capture="environment" ${photoState.busy?'disabled':''} aria-label="Defter sayfasının fotoğrafını çek"></label><label class="btn ghost file-button">${icon('image')} Fotoğraflardan seç<input id="notebook-photos" type="file" accept="image/*" multiple ${photoState.busy?'disabled':''} aria-label="Defter fotoğraflarını seç"></label></div>
    ${photoState.photos.length?`<div class="photo-grid">${photoState.photos.map((p,i)=>`<figure class="photo-tile"><img src="${p.preview}" alt="Defter sayfası ${i+1}"/><figcaption><span>${i+1}. sayfa · ${p.status==='done'?'Okundu':p.status==='reading'?'Okunuyor…':p.status==='error'?'Yeniden denenebilir':'Hazır'}</span>${!photoState.busy?`<button data-action="remove-photo" data-id="${p.id}" aria-label="${i+1}. fotoğrafı kaldır">${icon('trash')}</button>`:''}</figcaption>${p.error?`<p class="form-error">${escape(p.error)}</p>`:''}</figure>`).join('')}</div>`:''}
    <p class="small muted spaced">“Fotoğrafları oku” dediğinde seçtiğin fotoğraflar kelimeleri çıkarmak için Google Gemini’ye, kişisel okuma hizmetin üzerinden gönderilir. Fotoğraflar ESCARD’da kalıcı saklanmaz; kaydedilen kartlar iPad’inde kalır.</p>
    ${photoState.photos.length?`<div class="actions">${button(photoState.busy?'Fotoğraflar okunuyor…':'Fotoğrafları oku','read-photos',photoState.busy?'disabled':'')}${photoState.busy?button('Okumayı durdur','cancel-photos','','ghost'):''}</div>`:''}
    ${photoState.error?`<p class="form-error spaced" role="alert">${escape(photoState.error)}</p>`:''}${photoState.message?`<p class="note" role="status">${escape(photoState.message)}</p>`:''}</section>
    ${photoState.entries.length?`<section class="section"><div class="section-head"><div><div class="overline">KAYDETMEDEN ÖNCE</div><h2 class="spaced">Okunan kelimeleri kontrol et.</h2></div><span class="small muted">${photoState.entries.length} satır</span></div><p class="small muted">Şüpheli satırlar seçilmedi. Yazıyı düzelt, kartın iki yüzüne bak ve eklemek istediğin satırları işaretle. Aynı kelime zaten varsa yeniden eklenmez.</p><div class="entry-list">${photoState.entries.map((e,i)=>`<article class="entry-row ${e.uncertain?'uncertain':''}" data-entry="${e.id}"><div class="entry-top"><label class="checkbox"><input type="checkbox" data-entry-field="selected" data-entry-id="${e.id}" ${e.selected?'checked':''}><span>${i+1}. kelime ${e.uncertain?'· El yazısını kontrol et':''}${e.saved?'· Kaydedildi':''}</span></label><span class="small muted">${escape(e.sourceName||'Defterim')}</span></div><div class="entry-fields"><label class="field">Almanca<input value="${escape(e.german)}" data-entry-field="german" data-entry-id="${e.id}" maxlength="160" lang="de" autocomplete="off"></label><label class="field">Defterdeki karşılığı<input value="${escape(e.meaning)}" data-entry-field="meaning" data-entry-id="${e.id}" maxlength="500" autocomplete="off"></label><label class="field">Kart türü<select data-entry-field="kind" data-entry-id="${e.id}"><option value="pair" ${e.kind==='pair'?'selected':''}>Kelime → karşılığı</option><option value="preposition" ${e.kind==='preposition'?'selected':''}>Fiil → edatı</option></select></label><label class="field">Karşılığın dili<select data-entry-field="language" data-entry-id="${e.id}">${[['tr','Türkçe'],['en','İngilizce'],['de','Almanca'],['unknown','Belirsiz']].map(([v,t])=>`<option value="${v}" ${e.language===v?'selected':''}>${t}</option>`).join('')}</select></label>${e.kind==='preposition'?`<label class="field">Edat<input value="${escape(e.preposition)}" data-entry-field="preposition" data-entry-id="${e.id}" maxlength="20" placeholder="auf"></label><label class="field">Hâli · Defterde varsa<select data-entry-field="grammaticalCase" data-entry-id="${e.id}"><option value="">Belirtilmedi</option><option ${e.grammaticalCase==='Akkusativ'?'selected':''}>Akkusativ</option><option ${e.grammaticalCase==='Dativ'?'selected':''}>Dativ</option></select></label>`:''}</div><div class="card-preview">${entryPreview(e)}</div></article>`).join('')}</div><div class="action-bar"><p>${selected} satır seçili · Fiil-edat kartlarının düzeni korunur.</p>${button('Seçilenleri kartlarıma ekle','save-entries',selected&&!photoState.busy?'':'disabled')}</div></section>`:''}
    <details class="panel section" id="photo-setup" ${!photoSettings.endpoint?'open':''}><summary>Fotoğraf okuma bağlantısı · Bir kez kurulur</summary><p class="small muted spaced">Kişisel ücretsiz okuma hizmetinin adresini yaz. Erişim kodu yalnızca bu açık sayfada tutulur; Google API anahtarı uygulamaya girilmez.</p><form id="photo-service-form"><div class="entry-fields"><label class="field">Hizmet adresi<input name="endpoint" type="url" value="${escape(photoSettings.endpoint)}" placeholder="https://escard-photo-reader.hesabin.workers.dev" required autocomplete="off"></label><label class="field">Okuma erişim kodu<input name="accessCode" type="password" value="${escape(photoAccessCode)}" autocomplete="off" required></label></div><button class="btn ghost" type="submit">Bağlantı ayarlarını kaydet</button></form><p class="small muted spaced">Google AI Studio’da faturalandırması açılmamış ücretsiz proje ve Cloudflare Workers Free kullanılır. Kota biterse okuma durur; ücretli modele otomatik geçiş yapılmaz. Kurulum adımları kaynak paketin README dosyasında.</p></details>`;
}
async function readPhotos() {
  if(photoState.busy)return;
  if(!photoSettings.endpoint||!photoAccessCode){photoState.error='Önce aşağıdaki fotoğraf okuma bağlantısını tamamla.';render();$('#photo-setup').open=true;$('#photo-service-form input')?.focus();return;}
  const pending=photoState.photos.filter(p=>p.status!=='done');
  if(!pending.length){notify('Bu fotoğraflar okundu. Aşağıdaki kelimeleri kontrol edebilirsin.');return;}
  photoState.busy=true;photoState.error='';photoState.message='';photoController=new AbortController();render();
  try {
    for(const photo of pending){
      photo.status='reading';if(route()==='media')render();
      try {
        const entries=await extractPhoto(photo,photoSettings.endpoint,photoAccessCode,{signal:photoController.signal});
        for(const entry of entries)photoState.entries.push({...entry,photoId:photo.id,sourceName:photo.name});
        photo.status='done';photo.error='';
      }catch(error){photo.status='error';photo.error=error.name==='AbortError'?'Okuma durduruldu.':error.message;throw error;}
    }
    photoState.message=photoState.entries.length?`${photoState.entries.length} satır okundu. Kaydetmeden önce karşılıkları ve kart düzenini kontrol et.`:'Bu fotoğrafta kelime çifti okunamadı. Daha net veya daha yakın bir fotoğraf deneyebilirsin.';
  }catch(error){photoState.error=error.name==='AbortError'?'Okuma durduruldu. Daha önce okunan satırlar korunuyor.':error.message;}
  finally{photoState.busy=false;if(route()==='media')render();else notify('Defter fotoğrafı işlemi tamamlandı. Medya ekle bölümünden devam edebilirsin.');}
}
function allCards() { return [...state.cards, ...TOPICS.flatMap(grammarCards)]; }
function cardsView() {
  const d = state.deck;
  if (!d) return heading('Kart çalışması','Kelimelerimden veya bir gramer konusundan kart çalışması başlat.')+'<div class="actions"><a class="btn primary" href="#vocab">Kelimelerime git</a><a class="btn ghost" href="#topics">Gramer konularım</a></div>';
  const c = allCards().find(c=>c.id===d.ids[d.index]);
  if (!c) { state.deck = null; save(); return cardsView(); }
  return heading(d.topicId?TOPIC_MAP[d.topicId].title:'Kelimelerimi hatırlıyorum', 'Cevabı kendin düşün. Hazır olduğunda kartı çevir.',d.topicId?'GRAMER KARTLARI':'A2.2 · KELİME KARTLARIM')+
    `<div class="quiz-wrap"><div class="quiz-meta"><span>Kart ${d.index+1} / ${d.ids.length}</span><span>${d.known} kartı biliyorum</span></div><div class="progress-track"><div class="progress-fill" style="width:${d.index/d.ids.length*100}%"></div></div><button class="flashcard ${cardFlipped?'revealed':''}" data-action="flip" aria-label="${cardFlipped?'Kartın ön yüzünü göster':'Kartı çevir, cevabı gör'}"><span class="card-tag">${cardFlipped?'ARKA YÜZ · CEVAP':'ÖN YÜZ · BİR DÜŞÜN'}</span><span class="front" lang="${cardFlipped&&!c.back.includes(' + ')?(c.language||'tr'):'de'}">${escape(cardFlipped?c.back:c.front)}</span>${cardFlipped&&c.example?`<span class="example-line">${escape(c.example)}</span>`:''}${cardFlipped&&c.meaning&&!c.back.includes(c.meaning)?`<span class="example-line">${escape(c.meaning)}</span>`:''}<span class="hint">${cardFlipped?'Ön yüze dönmek için dokun':'Cevabı görmek için dokun'}</span></button>
    <div class="flash-actions">${cardFlipped?`${button('Tekrar çalışacağım','rate-card','data-rating="again"','ghost')}${button('Biliyorum ✓','rate-card','data-rating="known"','primary')}`:button('Kartı çevir','flip','','primary')}</div><div class="note">Kart değerlendirmesi senin seçimin. Gramer testindeki doğru/yanlış sonucunu değiştirmez.</div><a class="backlink" href="${d.topicId?`#topic/${d.topicId}`:'#vocab'}">${icon('back')} Ara ver · Kart sıram kayıtta</a></div>`;
}
function progressView() {
  const reviews = state.sessions.filter(s=>s.kind==='review');
  const wrong = state.sessions.reduce((n,s)=>n+s.answers.filter(a=>!a.correct).length,0);
  return heading('Küçük adımların birikiyor.','Başlangıç taramanı, son konu testini ve tekrar eden yanlışlarını birlikte gör.')+
    `<div class="stats"><div class="stat"><div class="stat-top">TAMAMLANAN TEST</div><div class="stat-value">${state.sessions.length}</div><p>${reviews.length} konu tekrar testi</p></div><div class="stat"><div class="stat-top">KAYDEDİLEN YANLIŞ</div><div class="stat-value">${wrong}</div><p>Tüm turlar; tekrarlar dâhil</p></div><div class="stat"><div class="stat-top">KART DEĞERLENDİRMESİ</div><div class="stat-value">${state.cardLog.length}</div><p>Kendi değerlendirmelerin</p></div></div>
    <section class="panel section"><h2>Konu konu gelişimim</h2><table class="result-table spaced"><thead><tr><th>Konu</th><th>Son tarama</th><th>Son tekrar</th><th>Çalışıldı</th></tr></thead><tbody>${TOPICS.map(t=>{const s=topicStatus(state,t.id);return `<tr><td><a href="#topic/${t.id}">${escape(t.title)}</a></td><td>${s.initial.length?`${s.initial.filter(a=>a.correct).length}/${s.initial.length}`:'—'}</td><td>${s.review?`${sessionScore(s.review).right}/4`:'—'}</td><td>${s.studied?'✓':'—'}</td></tr>`;}).join('')}</tbody></table><p class="small muted spaced">Tarama 3, tekrar testi 4 sorudur; sonuçlar doğrudan aynı ölçüm değildir. “Çalışıldı” işareti senin beyanındır.</p></section>
    <section class="section"><div class="section-head"><h2>Test oturumlarım</h2></div><div class="history">${[...state.sessions].reverse().map(s=>`<a href="#summary/${s.id}"><div><h3>${s.kind==='diagnostic'?'42 soruluk gramer taraması':escape(TOPIC_MAP[s.topicId].title)}</h3><small>${date(s.endedAt)} · ${s.kind==='diagnostic'?'Tarama':'Konu tekrarı'}</small></div><span class="score">${sessionScore(s).right}/${s.ids.length} ${icon('chevron')}</span></a>`).join('') || '<div class="empty"><p>İlk testini tamamladığında özeti burada göreceksin.</p></div>'}</div></section>
    ${state.cardLog.length?`<section class="section"><div class="section-head"><h2>Son kart çalışmalarım</h2></div><div class="word-list">${state.cardLog.slice(-20).reverse().map(c=>`<div class="word-row"><div class="wrap"><strong>${escape(c.front)}</strong><p>${date(c.at)} · ${escape(c.back)}</p></div><span class="status ${c.rating==='known'?'passed':'needs'}">${c.rating==='known'?'Biliyorum':'Tekrar çalışacağım'}</span></div>`).join('')}</div></section>`:''}`;
}
function settingsView() {
  return heading('Defterin kaybolmasın.','İlerleme, yanlışlar ve kelimeler aynı iPad’de bu tarayıcının içinde saklanır.')+
    `<div class="columns"><section class="panel"><h2>Çalışma yedeğim</h2><p class="small muted spaced">Cevapların her sorudan sonra otomatik kaydedilir. Ek güvence için gün sonunda yedeğini Dosyalar’a indir.</p><div class="actions">${button(`${icon('save')} Yedeğimi indir`,'export')}<label class="btn ghost file-button">Yedekten geri yükle<input type="file" id="import-file" accept="application/json,.json" aria-label="Yedek dosyası seç"></label></div><div class="note">Safari’nin normal sekmesini kullan. Özel dolaşımda, site verileri temizlenince veya farklı bir adresten açınca bu kayıt görünmeyebilir. Otomatik bulut eşitlemesi yoktur.</div><p class="small muted">Uygulamayı ana ekrana eklersen kayıt tutarlılığı için hafta sonu boyunca oradan aç. Safari ve ana ekran uygulamasındaki depolama ortamları farklı olabilir.</p>${storageError?`<div class="actions">${button('Okunamayan özgün kaydı indir','export-raw','','ghost')}${button('Bu açık oturumu yeni kayıt olarak kaydet','repair-storage','','ghost')}</div>`:''}</section>
    <section class="panel tinted"><h2>iPad’de kullanım</h2><p class="small muted spaced">Safari’de aç → Paylaş → Ana Ekrana Ekle. Sayfanın tamamı ilk kez yüklendikten sonra, desteklenen HTTPS yayında çevrimdışı çalışma dosyaları da hazırlanır.</p><p class="small muted" id="offline-status">${navigator.serviceWorker?.controller?'Çevrimdışı dosyalar bu tarayıcıda hazır.':'Çevrimdışı hazırlığı için ilk açılışta bağlantı gerekir. Yerel önizlemede bu özellik sınırlı olabilir.'}</p><p class="small muted">Testler ve kart çalışmaları çevrimdışı kullanılabilir. Fotoğraf okuma internet ve bir kez kurulacak ücretsiz okuma bağlantısı gerektirir. Test ve ilerleme kayıtları iPad’de kalır. Defterindeki İngilizce anlamlar kartın arkasında aynen korunabilir.</p><a class="text-button" href="#media">Fotoğraf okuma bağlantısı ${icon('arrow')}</a></section></div>
    <section class="panel section"><h2>Kapsam ve kaynaklar</h2><p class="small muted spaced">Netzwerk neu A2.2, 7–12. bölümlerin gramer başlıkları temel alınmıştır. Konjunktiv II ve ilgi cümleleri, eksikleri daha net görmek için ayrı çalışma başlıklarına ayrılır. Sorular ve açıklamalar bu uygulama için özgün hazırlanmıştır.</p><ul>${SOURCES.map(s=>`<li class="small spaced"><a href="${s.url}" target="_blank" rel="noopener noreferrer"><u>${escape(s.title)}</u></a></li>`).join('')}</ul><p class="small muted">Hazır kelime kalıpları sınırlıdır. Tanınmayan bir kelimenin anlamını uygulama kendiliğinden üretmez; kendi kartını yazabilirsin.</p></section>`;
}
function renderModal() {
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><h2 id="modal-title">${modal.title}</h2><p>${modal.body}</p><div class="actions">${button(modal.accept,'modal-accept')}${button('Vazgeç','modal-cancel','','ghost')}</div></section></div>`;
}
function confirmAction(title, body, accept, run) { modal={title:escape(title),body:escape(body),accept,run}; render(); }
function startQuiz(kind, topicId=null) {
  if (state.active) {
    if (state.active.kind===kind && state.active.topicId===topicId) return go('diagnostic');
    notify('Önce yarım kalan testini tamamla. Cevaplarını kaybetmeden ardından yeni test açabilirsin.');
    return go('diagnostic');
  }
  state.active = makeQuiz(kind,topicId,state.sessions); quizWritten=false; save(); go('diagnostic');
}
function startDeck(topicId=null, onlyAgain=false) {
  let cards = topicId ? grammarCards(TOPIC_MAP[topicId]) : state.cards;
  if (onlyAgain) {
    const latest = new Map();
    for(const l of state.cardLog) latest.set(l.cardId,l.rating);
    cards = cards.filter(c=>latest.get(c.id)==='again');
  }
  if (!cards.length) { notify('Önce çalışmak istediğin kartları ekle.'); return; }
  if (state.deck && !onlyAgain && state.deck.topicId===topicId) {cardFlipped=false;return go('cards');}
  state.deck={ids:shuffle(cards).map(c=>c.id),index:0,known:0,topicId,startedAt:new Date().toISOString()};
  cardFlipped=false;save();go('cards');
}
function downloadJSON(data,name='almanca-calisma-yedegi') {
  const blob = new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${name}-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
document.addEventListener('click',event=>{
  if(event.target.closest('.skip')){event.preventDefault();$('#main')?.focus();return;}
  const target=event.target.closest('[data-action]');if(!target)return;
  const action=target.dataset.action;
  if(action==='sketch'){sketch=!sketch;document.querySelector('.shell')?.classList.toggle('es-sketched',sketch);target.setAttribute('aria-pressed',String(sketch));notify(sketch?'Bir çizgi, bir başlangıç.':'Küçük adımlar, sağlam bir temel.');return;}
  if(action==='scale'){scaleIndex=(scaleIndex+1)%3;target.textContent=['1 : 1','1 : 20','1 : 50'][scaleIndex];$('.es-bottom-note').textContent=['Küçük adımlar, sağlam bir temel.','Önce temel, sonra bir kat daha.','Her detay, bütüne bir adım.'][scaleIndex];return;}
  if(action==='read-photos'){readPhotos();return;}
  if(action==='cancel-photos'){photoController?.abort();return;}
  if(action==='remove-photo'){
    photoState.photos=photoState.photos.filter(p=>p.id!==target.dataset.id);
    photoState.entries=photoState.entries.filter(e=>e.photoId!==target.dataset.id);
    render();return;
  }
  if(action==='save-entries'){
    try{
      const result=prepareImport(photoState.entries,state.cards);
      if(!result.cards.length){notify(result.duplicates.length?'Seçtiğin kelimeler zaten kartlarında.':'Eklemek istediğin satırları seç.');return;}
      state.cards.push(...result.cards);save();
      for(const e of photoState.entries)if(e.selected){e.selected=false;e.saved=true;}
      photoState.message=`${result.cards.length} kelime kartı eklendi.${result.duplicates.length?` ${result.duplicates.length} kelime zaten vardı; önceki kartı korundu.`:''}`;
      render();notify(storageError?'Kartlar açık sayfada hazır; kalıcı kayıt için yedeğini indir.':photoState.message);
    }catch(error){photoState.error=error.message;render();}
    return;
  }
  if(action==='menu'){menuOpen=!menuOpen;render();return;}
  if(action==='start-diagnostic')return startQuiz('diagnostic');
  if(action==='resume')return go('diagnostic');
  if(action==='start-review')return startQuiz('review',target.dataset.topic);
  if(action==='filter'){filter=target.dataset.filter;render();return;}
  if(action==='toggle-quiz-mode'){quizWritten=!quizWritten;render();return;}
  if(action==='answer'){
    const active=state.active;if(!active)return;
    const raw=active.choices[active.index][Number(target.dataset.option)];
    if(answerQuiz(active,raw)){save();render();$('.feedback')?.scrollIntoView({block:'nearest'});}return;
  }
  if(action==='submit-answer'){event.preventDefault();submitWritten();return;}
  if(action==='next-question'){
    if(!state.active)return;
    if(nextQuiz(state.active)){const s=state.active;state.sessions.push(s);state.active=null;save();go(`summary/${s.id}`);}
    else {save();render();$('#answer')?.focus();}return;
  }
  if(action==='char'){
    const input=$('#answer');if(!input)return;const start=input.selectionStart??input.value.length;const end=input.selectionEnd??start;
    input.value=input.value.slice(0,start)+target.dataset.value+input.value.slice(end);input.focus();input.setSelectionRange(start+1,start+1);return;
  }
  if(action==='studied'){state.studied[target.dataset.topic]=new Date().toISOString();save();render();notify('Konuyu çalıştığın kaydedildi. Şimdi tekrar testini deneyebilirsin.');return;}
  if(action==='grammar-cards')return startDeck(target.dataset.topic);
  if(action==='vocab-cards')return startDeck();
  if(action==='flip'){cardFlipped=!cardFlipped;render();return;}
  if(action==='rate-card'){
    if(!state.deck||!cardFlipped)return;
    const d=state.deck;const c=allCards().find(c=>c.id===d.ids[d.index]);
    state.cardLog.push({cardId:c.id,front:c.front,back:c.back,rating:target.dataset.rating,at:new Date().toISOString()});
    if(target.dataset.rating==='known')d.known++;
    if(d.index+1<d.ids.length){d.index++;cardFlipped=false;save();render();}
    else {
      const known=d.known;const total=d.ids.length;const topic=d.topicId;state.deck=null;save();
      modal={title:'Kart turunu tamamladın.',body:`${total} kartın ${known} tanesi için “Biliyorum” dedin. Diğer ${total-known} kart tekrar listende. Değerlendirmelerin Gelişimim bölümüne kaydedildi.`,accept:total>known?'Tekrar gereken kartları çalış':'Tamam',run:()=>{if(total>known)startDeck(topic,true);else go(topic?`topic/${topic}`:'vocab');}};render();
    }return;
  }
  if(action==='edit-card'){editingCard=target.dataset.id;render();$('#vocab-word')?.focus();window.scrollTo(0,0);return;}
  if(action==='cancel-edit'){editingCard=null;render();return;}
  if(action==='delete-card'){
    const c=state.cards.find(c=>c.id===target.dataset.id);if(!c)return;
    confirmAction('Bu kartı silelim mi?',`“${c.word}” kartı silinecek. Önceki çalışma kayıtları korunacak.`,'Kartı sil',()=>{state.cards=state.cards.filter(x=>x.id!==c.id);if(state.deck?.ids.includes(c.id))state.deck=null;save();render();});return;
  }
  if(action==='export'){downloadJSON(state);notify('Yedeğin hazır. iPad’de Dosyalar’a kaydedebilirsin.');return;}
  if(action==='export-raw'){try{downloadJSON(localStorage.getItem(STORAGE_KEY)||'{}','almanca-ozgun-kayit');}catch{notify('Özgün kayda erişilemiyor.');}return;}
  if(action==='repair-storage'){
    confirmAction('Açık çalışmayı kaydedelim mi?','Mevcut okunamayan kaydı önce indireceğiz. Ardından bu sayfada görünen çalışmayı yeni kayıt olarak kaydedeceğiz.','Özgün kaydı indir ve kaydet',()=>{try{const raw=localStorage.getItem(STORAGE_KEY);if(raw)downloadJSON(raw,'almanca-ozgun-kayit');localStorage.removeItem(STORAGE_KEY);save();render();}catch{notify('Kayıt alanına erişilemiyor. Açık çalışmanın yedeğini indir.');}});return;
  }
  if(action==='modal-accept'){const run=modal?.run;modal=null;run?.();if(!modal)render();return;}
  if(action==='modal-cancel'){modal=null;importCandidate=null;render();return;}
});
function submitWritten(){const input=$('#answer');if(!input||!state.active)return;if(!input.value.trim()){input.focus();notify('Boşluğa gelecek cevabı yaz.');return;}if(answerQuiz(state.active,input.value)){save();render();$('.feedback')?.scrollIntoView({block:'nearest'});}}
document.addEventListener('submit',event=>{
  if(event.target.id==='photo-service-form'){
    event.preventDefault();const form=new FormData(event.target);
    try{
      photoSettings.endpoint=serviceURL(form.get('endpoint')||'');
      photoAccessCode=String(form.get('accessCode')||'').trim();
      if(!photoAccessCode)throw new Error('Okuma erişim kodunu yaz.');
      try{localStorage.setItem(OCR_SETTINGS_KEY,JSON.stringify({endpoint:photoSettings.endpoint}));}catch{notify('Adres kalıcı kaydedilemedi; bu açık sayfada kullanılabilir.');}
      photoState.error='';photoState.message='Bağlantı bilgileri alındı. Fotoğraf ekleyip okumayı başlatabilirsin.';render();
    }catch(error){notify(error.message);}
    return;
  }
  if(event.target.id==='answer-form'){event.preventDefault();submitWritten();}
  if(event.target.id==='vocab-form'){
    event.preventDefault();const form=new FormData(event.target);
    try{
      if(state.cards.length>=2000&&!editingCard)throw new Error('Kart sınırına ulaştın. Önce yedeğini alıp eski kartları silebilirsin.');
      const card=makeVocab(form.get('word')||'',form.get('front')||'',form.get('back')||'',form.get('example')||'');
      const duplicate=state.cards.find(c=>normalize(c.word)===normalize(card.word)&&c.id!==editingCard);
      if(duplicate)throw new Error('Bu kelime zaten kartlarında var. Listeden düzenleyebilirsin.');
      if(editingCard){const old=state.cards.find(c=>c.id===editingCard);Object.assign(old,{...card,id:old.id,addedAt:old.addedAt});}
      else state.cards.push(card);
      editingCard=null;save();render();notify('Kelime kartın kaydedildi.');
    }catch(error){$('#vocab-error').textContent=error.message;$('#custom-card').open=true;$('#custom-card textarea')?.focus();}
  }
});
document.addEventListener('input',event=>{
  const field=event.target.dataset.entryField;
  if(!field)return;
  const entry=photoState.entries.find(e=>e.id===event.target.dataset.entryId);if(!entry)return;
  entry[field]=field==='selected'?event.target.checked:event.target.value;
  if(field==='kind'){render();return;}
  const row=event.target.closest('.entry-row');if(row)row.querySelector('.card-preview').innerHTML=entryPreview(entry);
  const saveButton=$('[data-action="save-entries"]');if(saveButton)saveButton.disabled=photoState.busy||!photoState.entries.some(e=>e.selected);
  const status=$('.action-bar p');if(route()==='media'&&status)status.textContent=`${photoState.entries.filter(e=>e.selected).length} satır seçili · Fiil-edat kartlarının düzeni korunur.`;
});
document.addEventListener('change',async event=>{
  if(!['notebook-photos','camera-photo'].includes(event.target.id)||photoState.busy)return;
  const files=[...(event.target.files||[])];if(!files.length)return;
  const available=MAX_PHOTOS-photoState.photos.length;
  if(files.length>available){notify(`Bir turda en fazla ${MAX_PHOTOS} fotoğraf ekleyebilirsin.`);event.target.value='';return;}
  photoState.busy=true;photoState.error='';render();
  try{for(const file of files)photoState.photos.push(await preparePhoto(file));}
  catch(error){photoState.error=error.message;}
  finally{photoState.busy=false;if(route()==='media')render();}
});
document.addEventListener('change',async event=>{
  if(event.target.id!=='import-file')return;
  const file=event.target.files?.[0];if(!file)return;
  try{
    if(file.size>8_000_000)throw new Error('Yedek dosyası 8 MB’den küçük olmalı.');
    importCandidate=validateState(JSON.parse(await file.text()));
    confirmAction('Bu yedeği geri yükleyelim mi?',`Dosyada ${importCandidate.sessions.length} test oturumu ve ${importCandidate.cards.length} kelime kartı var. Önce mevcut kaydı indireceğiz, sonra yerine bu yedeği yükleyeceğiz.`,'Mevcut kaydı yedekle ve yükle',()=>{downloadJSON(state,'almanca-aktarma-oncesi');state=importCandidate;importCandidate=null;save();go('home');notify('Yedeğin geri yüklendi.');});
  }catch(error){notify(error instanceof SyntaxError?'Dosya okunamadı. Uygulamadan indirdiğin JSON yedeğini seç.':error.message);event.target.value='';}
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&(modal||menuOpen)){modal=null;menuOpen=false;render();}});
window.addEventListener('hashchange',()=>{menuOpen=false;render();window.scrollTo({top:0,behavior:'instant'});$('#main')?.focus({preventScroll:true});});
function syncMenuAccessibility(){
  const aside=$('#sidebar');if(!aside)return;
  const hidden=window.matchMedia('(max-width: 690px)').matches&&!menuOpen;
  aside.inert=hidden;
  if(hidden)aside.setAttribute('aria-hidden','true');else aside.removeAttribute('aria-hidden');
}
window.matchMedia('(max-width: 690px)').addEventListener('change',syncMenuAccessibility);
window.addEventListener('storage',event=>{
  if(event.key!==STORAGE_KEY||!event.newValue)return;
  try{state=validateState(JSON.parse(event.newValue));cardFlipped=false;render();notify('Diğer sekmedeki çalışma kaydı bu sayfaya alındı.');}catch{notify('Diğer sekmedeki kayıt okunamadı. Bu sayfadaki çalışman korunuyor.');}
});
render();
if(recoveryMessage)notify(recoveryMessage);
if('serviceWorker' in navigator && window.isSecureContext){
  navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(reg=>{
    const ready=()=>{const n=$('#offline-status');if(n)n.textContent='Çevrimdışı dosyalar bu tarayıcıda hazır.';};
    navigator.serviceWorker.ready.then(ready);
    if(reg.waiting)notify('Yeni çalışma dosyaları hazır. Açık çalışmanı kaydettikten sonra sayfayı yeniden açabilirsin.');
  }).catch(()=>{/* Çevrimdışı durum bölümünde başarı iddia edilmez. */});
}
