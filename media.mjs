import {makeVocab, normalize, uid} from './core.mjs';
import {VOCAB} from './data.mjs';

export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 2_400_000;
export const OCR_SETTINGS_KEY = 'escard.photo-service.v1';

export function validateEntries(input) {
  if (!input || !Array.isArray(input.entries) || input.entries.length > 120) throw new Error('Fotoğraf okuma yanıtı beklenen biçimde değil. Yeniden deneyebilirsin.');
  return input.entries.map((entry, i) => {
    if (!entry || typeof entry !== 'object' || typeof entry.german !== 'string' || typeof entry.meaning !== 'string') throw new Error('Okunan kelimelerin biçimi eksik.');
    const text = (name, max) => {
      const value = entry[name] || '';
      if (typeof value !== 'string' || value.length > max) throw new Error('Okunan kelimelerden biri çok uzun.');
      return value.normalize('NFC').trim();
    };
    const german = text('german', 160);
    const meaning = text('meaning', 500);
    return {id: uid(), german, meaning,
      kind: entry.kind === 'preposition' ? 'preposition' : 'pair',
      preposition: text('preposition', 20), grammaticalCase: text('grammaticalCase', 20),
      example: text('example', 1000),
      language: ['tr','en','de'].includes(entry.language) ? entry.language : 'unknown',
      uncertain: entry.uncertain !== false || !german || (!meaning && entry.kind !== 'preposition'),
      selected: entry.uncertain === false && !!german && (!!meaning || entry.kind === 'preposition'),
      line: i + 1};
  });
}

export function cardFromEntry(entry) {
  const german = entry.german.trim();
  const meaning = entry.meaning.trim();
  if (!german) throw new Error('Almanca kelimeyi tamamla.');
  // Bilinen fiil-edat kalıpları hiçbir zaman çeviri kartına çevrilmez.
  const known = VOCAB.find(v => normalize(v.word) === normalize(german) && / ___/.test(v.front) && /\+ (Akkusativ|Dativ)/.test(v.back));
  let card;
  if (entry.kind === 'preposition' || known) {
    const prep = entry.preposition.trim().toLocaleLowerCase('de-DE');
    if (prep && !['auf','an','für','über','von','mit','um','bei','nach','zu','vor','aus','in'].includes(prep)) throw new Error('Edatı kontrol et.');
    const alreadyHasPrep = /\s(auf|an|für|über|von|mit|um|bei|nach|zu|vor|aus|in)$/i.test(german);
    const phrase = alreadyHasPrep || known ? german : `${german} ${prep}`.trim();
    if (!alreadyHasPrep && !known && !prep) throw new Error('Fiilin edatını tamamla.');
    card = makeVocab(phrase);
    const grammaticalCase = entry.grammaticalCase.trim();
    if (grammaticalCase && !['Akkusativ','Dativ'].includes(grammaticalCase)) throw new Error('Hâli Akkusativ veya Dativ olarak kontrol et; bilinmiyorsa boş bırak.');
    if (grammaticalCase && !card.back.includes('+')) card.back += ` + ${grammaticalCase}`;
    // Hazır kartın düzeni korunur; defterdeki anlam ek bilgi olarak saklanır.
    if (meaning) card.meaning = meaning;
    if (entry.example.trim()) card.example = entry.example.trim();
  } else {
    if (!meaning) throw new Error('Defterdeki karşılığı tamamla veya bu satırın seçimini kaldır.');
    card = makeVocab(german, german, meaning, entry.example.trim());
    card.meaning = meaning;
  }
  return {...card, source:'defter', language:entry.language};
}

export function prepareImport(entries, existingCards) {
  const seen = new Set(existingCards.map(c => normalize(c.word)));
  const cards = [];
  const duplicates = [];
  for (const entry of entries.filter(e => e.selected)) {
    const card = cardFromEntry(entry);
    const key = normalize(card.word);
    if (seen.has(key)) {duplicates.push(card.word);continue;}
    seen.add(key);cards.push(card);
  }
  if (existingCards.length + cards.length > 2000) throw new Error('Kart sınırına ulaşılıyor. Daha az satır seç.');
  return {cards, duplicates};
}

export function serviceURL(raw) {
  let url;
  try {url=new URL(raw.trim());} catch {throw new Error('Fotoğraf okuma hizmetinin tam adresini yaz.');}
  if (url.protocol !== 'https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('Hizmet adresi HTTPS ile başlamalı.');
  if (url.username || url.password || url.search || url.hash) throw new Error('Hizmet adresine parola veya ek parametre yazma.');
  url.pathname = '/extract';
  return url.href;
}

export async function extractPhoto(photo, endpoint, accessCode, {signal, fetcher=fetch}={}) {
  if (!accessCode.trim()) throw new Error('Fotoğraf okuma erişim kodunu yaz.');
  const url = serviceURL(endpoint);
  let response;
  try {
    response = await fetcher(url, {method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${accessCode.trim()}`},
      body:JSON.stringify({image:{mimeType:'image/jpeg',data:photo.data}}), signal});
  } catch (error) {
    if (error.name==='AbortError') throw error;
    throw new Error('Okuma hizmetine ulaşılamadı. İnternet bağlantısını ve hizmet adresini kontrol et.');
  }
  if (response.status===429) throw new Error('Ücretsiz okuma kotasına ulaşıldı. Bir süre sonra yeniden dene; ücretli modele geçilmedi.');
  if (response.status===401 || response.status===403) throw new Error('Okuma erişim kodunu ve izin verilen site adresini kontrol et.');
  let result;
  try {result=await response.json();} catch {throw new Error('Okuma hizmeti geçerli bir yanıt vermedi.');}
  if (!response.ok) throw new Error(typeof result.error==='string' ? result.error.slice(0,400) : 'Fotoğraf okunamadı. Yeniden deneyebilirsin.');
  return validateEntries(result);
}

export async function preparePhoto(file) {
  if (file.size>20_000_000) throw new Error('Fotoğraf 20 MB’den küçük olmalı.');
  if (file.type && !file.type.startsWith('image/')) throw new Error('Bir fotoğraf seç: JPEG, PNG, WebP veya iPad’in açabildiği bir görsel.');
  const url=URL.createObjectURL(file);
  try {
    const image=new Image();image.src=url;
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Bu görsel açılamadı. Fotoğrafı JPEG olarak seçmeyi dene.'));});
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Fotoğrafın boyutu okunamadı.');
    const scale=Math.min(1,2400/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
    const context=canvas.getContext('2d');if(!context)throw new Error('Fotoğraf bu tarayıcıda hazırlanamadı.');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    let encoded=canvas.toDataURL('image/jpeg',0.88);
    if (encoded.length>MAX_PHOTO_BYTES*4/3) encoded=canvas.toDataURL('image/jpeg',0.65);
    if (encoded.length>MAX_PHOTO_BYTES*4/3) throw new Error('Fotoğraf çok yoğun. Sayfayı iki ayrı fotoğrafta çekmeyi dene.');
    return {id:uid(), name:file.name || 'Defter fotoğrafı', data:encoded.split(',')[1], preview:encoded, status:'ready', error:'', entries:[]};
  } finally {URL.revokeObjectURL(url);}
}
