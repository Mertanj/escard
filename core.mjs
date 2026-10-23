import {CONTENT_VERSION, TOPICS, TOPIC_MAP, QUESTIONS, QUESTION_MAP, VOCAB} from './data.mjs';

export const STORAGE_KEY = 'bir-adim-daha.a22.v1';
export const normalize = value => String(value).normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
export const correct = (question, answer) => normalize(question.answer) === normalize(answer);
export const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function freshState() {
  return {version: 1, contentVersion: CONTENT_VERSION, updatedAt: new Date().toISOString(),
    studied: {}, sessions: [], active: null, cards: [], cardLog: [], deck: null};
}
export function makeQuiz(kind, topicId, sessions = []) {
  let questions;
  if (kind === 'diagnostic') {
    // Her konu eşit ağırlıklı; bir konunun soruları arka arkaya gösterilmez.
    const topicOrder = shuffle(TOPICS);
    questions = [0, 1, 2].flatMap(index => topicOrder.map(t => t.questions[index]));
  } else {
    if (!TOPIC_MAP[topicId]) throw new Error('Konu bulunamadı.');
    const pool = TOPIC_MAP[topicId].questions.filter(q => q.phase === 'review');
    const count = Object.fromEntries(pool.map(q => [q.id, 0]));
    for (const s of sessions) for (const a of s.answers) if (a.questionId in count) count[a.questionId]++;
    // Önce daha az görülen sorular; eşitliklerde rastgele seçim.
    questions = shuffle(pool).sort((a, b) => count[a.id] - count[b.id]).slice(0, 4);
  }
  return {id: uid(), kind, topicId: topicId || null, ids: questions.map(q => q.id),
    choices: questions.map(q => shuffle(q.options)), index: 0, answers: [],
    startedAt: new Date().toISOString(), endedAt: null};
}
export function answerQuiz(quiz, raw) {
  if (quiz.endedAt || quiz.answers.length !== quiz.index) return false;
  const question = QUESTION_MAP[quiz.ids[quiz.index]];
  if (!question || !String(raw).trim()) return false;
  quiz.answers.push({questionId: question.id, raw: String(raw).trim(), correct: correct(question, raw), at: new Date().toISOString()});
  return true;
}
export function nextQuiz(quiz) {
  if (quiz.answers.length <= quiz.index) return false;
  if (quiz.index + 1 < quiz.ids.length) { quiz.index++; return false; }
  quiz.endedAt = new Date().toISOString();
  return true;
}
export function sessionScore(s) { return {right: s.answers.filter(a => a.correct).length, total: s.ids.length}; }
export function topicStatus(state, topicId) {
  const baseline = [...state.sessions].reverse().find(s => s.kind === 'diagnostic');
  const initial = baseline?.answers.filter(a => QUESTION_MAP[a.questionId]?.topicId === topicId) || [];
  const review = [...state.sessions].reverse().find(s => s.kind === 'review' && s.topicId === topicId);
  const reviewIsLatest = review && (!baseline || Date.parse(review.endedAt) >= Date.parse(baseline.endedAt));
  const current = reviewIsLatest ? review.answers : initial;
  const errors = current.filter(a => !a.correct).length;
  return {initial, review, current, errors, studied: !!state.studied[topicId],
    status: !current.length ? 'unknown' : errors ? 'needs' : reviewIsLatest ? 'passed' : 'clear'};
}
export function weakTopics(state) {
  return TOPICS.map(t => ({...t, result: topicStatus(state, t.id)}))
    .filter(t => t.result.status === 'needs').sort((a, b) => b.result.errors - a.result.errors);
}
export function makeVocab(word, front = '', back = '', example = '') {
  const trimmed = word.trim();
  if (!trimmed || trimmed.length > 160) throw new Error('Kelimeyi 1–160 karakter arasında yaz.');
  const found = VOCAB.find(v => normalize(v.word) === normalize(trimmed));
  if (front.trim() && back.trim()) return {id: uid(), word: trimmed, front: front.trim(), back: back.trim(), example: example.trim(), addedAt: new Date().toISOString()};
  if (front.trim() || back.trim()) throw new Error('Özel kart için hem ön hem arka yüzü doldur.');
  if (found) return {...found, id: uid(), addedAt: new Date().toISOString()};
  // Kalıp açıkça verilmişse yalnızca edat ayrılır; hâl veya örnek tahmin edilmez.
  const match = trimmed.match(/^(.+?)\s+(auf|an|für|über|von|mit|um|bei|nach|zu|vor|aus|in)$/i);
  if (match) return {id: uid(), word: trimmed, front: `${match[1]} ___`, back: match[2].toLocaleLowerCase('de-DE'), example: example.trim(), addedAt: new Date().toISOString()};
  throw new Error('Bu kelime için ön ve arka yüzü aşağıya yaz. Örnek cümle ekleyebilirsin.');
}
export function grammarCards(topic) {
  return topic.rules.map(([title, example, why], i) => ({id: `rule-${topic.id}-${i}`, word: title, front: title, back: example, example: why}));
}

const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x, max = 4000) => typeof x === 'string' && x.length <= max;
const date = x => str(x, 50) && Number.isFinite(Date.parse(x));
function safeSession(s, active = false) {
  if (!object(s) || !str(s.id, 100) || !['review', 'diagnostic'].includes(s.kind) ||
      !Array.isArray(s.ids) || !Array.isArray(s.answers) || !date(s.startedAt) ||
      s.ids.length < 1 || s.ids.length > QUESTIONS.length || new Set(s.ids).size !== s.ids.length ||
      s.ids.some(id => !QUESTION_MAP[id]) || s.answers.length > s.ids.length) throw new Error('Oturum kaydı geçersiz.');
  const expected = s.kind === 'diagnostic' ? QUESTIONS.filter(q => q.phase === 'diagnostic').map(q => q.id) : null;
  if (s.kind === 'diagnostic' && (s.ids.length !== expected.length || expected.some(id => !s.ids.includes(id)))) throw new Error('Tarama kapsamı geçersiz.');
  if (s.kind === 'review' && (!TOPIC_MAP[s.topicId] || s.ids.length !== 4 || s.ids.some(id => QUESTION_MAP[id].topicId !== s.topicId || QUESTION_MAP[id].phase !== 'review'))) throw new Error('Tekrar testi kapsamı geçersiz.');
  const answers = s.answers.map((a, i) => {
    if (!object(a) || a.questionId !== s.ids[i] || !str(a.raw, 2000) || !date(a.at)) throw new Error('Cevap kaydı geçersiz.');
    return {questionId: a.questionId, raw: a.raw, correct: correct(QUESTION_MAP[a.questionId], a.raw), at: a.at};
  });
  if (active && (!Number.isInteger(s.index) || s.index < 0 || s.index >= s.ids.length || ![s.index, s.index + 1].includes(answers.length) || s.endedAt !== null)) throw new Error('Yarım kalan test geçersiz.');
  if (!active && (answers.length !== s.ids.length || !date(s.endedAt))) throw new Error('Tamamlanan test geçersiz.');
  const choices = s.ids.map((id, i) => {
    const input = s.choices?.[i];
    const options = QUESTION_MAP[id].options;
    return Array.isArray(input) && input.length === options.length && new Set(input).size === options.length && input.every(c => options.includes(c)) ? [...input] : [...options];
  });
  return {id: s.id, kind: s.kind, topicId: s.kind === 'review' ? s.topicId : null,
    ids: [...s.ids], choices, index: active ? s.index : s.ids.length - 1, answers,
    startedAt: s.startedAt, endedAt: active ? null : s.endedAt};
}
export function validateState(input) {
  if (!object(input) || input.version !== 1 || input.contentVersion !== CONTENT_VERSION ||
    !Array.isArray(input.sessions) || input.sessions.length > 2000 || !Array.isArray(input.cards) || input.cards.length > 2000 ||
    !Array.isArray(input.cardLog) || input.cardLog.length > 50000 || !object(input.studied)) throw new Error('Bu uygulamaya ait geçerli bir yedek seç.');
  const state = freshState();
  state.sessions = input.sessions.map(s => safeSession(s));
  state.active = input.active ? safeSession(input.active, true) : null;
  for (const [id, at] of Object.entries(input.studied)) if (TOPIC_MAP[id] && date(at)) state.studied[id] = at;
  state.cards = input.cards.map(c => {
    if (!object(c) || !str(c.id, 100) || !str(c.word, 160) || !str(c.front) || !str(c.back) || !c.front.trim() || !c.back.trim() || !str(c.example || '') || !date(c.addedAt)) throw new Error('Kelime kartı geçersiz.');
    return {id: c.id, word: c.word, front: c.front, back: c.back, example: c.example || '',
      ...(str(c.meaning) ? {meaning:c.meaning} : {}),
      ...(['tr','en','de','unknown'].includes(c.language) ? {language:c.language} : {}),
      ...(c.source==='defter' ? {source:'defter'} : {}), addedAt: c.addedAt};
  });
  if (new Set(state.cards.map(c => c.id)).size !== state.cards.length) throw new Error('Tekrarlayan kart kaydı var.');
  const validCardIds = new Set([...state.cards.map(c => c.id), ...TOPICS.flatMap(grammarCards).map(c => c.id)]);
  state.cardLog = input.cardLog.map(c => {
    if (!object(c) || !str(c.cardId, 100) || !str(c.front) || !str(c.back) || !date(c.at) || !['again', 'known'].includes(c.rating)) throw new Error('Kart çalışma kaydı geçersiz.');
    return {cardId: c.cardId, front: c.front, back: c.back, rating: c.rating, at: c.at};
  });
  if (input.deck) {
    const d = input.deck;
    if (!object(d) || !Array.isArray(d.ids) || !d.ids.length || d.ids.length > 2000 || new Set(d.ids).size !== d.ids.length || d.ids.some(id => !validCardIds.has(id)) ||
      !Number.isInteger(d.index) || d.index < 0 || d.index >= d.ids.length || !Number.isInteger(d.known) || d.known < 0 || d.known > d.index || !date(d.startedAt)) throw new Error('Kart oturumu geçersiz.');
    state.deck = {ids: [...d.ids], index: d.index, known: d.known, startedAt: d.startedAt, topicId: TOPIC_MAP[d.topicId] ? d.topicId : null};
  }
  return state;
}
