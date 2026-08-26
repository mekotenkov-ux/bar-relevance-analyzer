declare module "stopword" {
  export type StopwordList = readonly string[];

  export function removeStopwords(
    tokens: readonly string[],
    stopwords?: StopwordList,
  ): string[];

  export const _123: StopwordList;
  export const afr: StopwordList;
  export const ara: StopwordList;
  export const ben: StopwordList;
  export const bre: StopwordList;
  export const bul: StopwordList;
  export const cat: StopwordList;
  export const ces: StopwordList;
  export const dan: StopwordList;
  export const deu: StopwordList;
  export const ell: StopwordList;
  export const eng: StopwordList;
  export const epo: StopwordList;
  export const est: StopwordList;
  export const eus: StopwordList;
  export const fas: StopwordList;
  export const fin: StopwordList;
  export const fra: StopwordList;
  export const gle: StopwordList;
  export const glg: StopwordList;
  export const guj: StopwordList;
  export const hau: StopwordList;
  export const heb: StopwordList;
  export const hin: StopwordList;
  export const hrv: StopwordList;
  export const hun: StopwordList;
  export const hye: StopwordList;
  export const ind: StopwordList;
  export const ita: StopwordList;
  export const jpn: StopwordList;
  export const kor: StopwordList;
  export const kur: StopwordList;
  export const lat: StopwordList;
  export const lav: StopwordList;
  export const lgg: StopwordList;
  export const lggNd: StopwordList;
  export const lit: StopwordList;
  export const mar: StopwordList;
  export const msa: StopwordList;
  export const mya: StopwordList;
  export const nld: StopwordList;
  export const nob: StopwordList;
  export const panGu: StopwordList;
  export const pol: StopwordList;
  export const por: StopwordList;
  export const porBr: StopwordList;
  export const ron: StopwordList;
  export const rus: StopwordList;
  export const slk: StopwordList;
  export const slv: StopwordList;
  export const som: StopwordList;
  export const sot: StopwordList;
  export const spa: StopwordList;
  export const swa: StopwordList;
  export const swe: StopwordList;
  export const tgl: StopwordList;
  export const tha: StopwordList;
  export const tur: StopwordList;
  export const ukr: StopwordList;
  export const urd: StopwordList;
  export const vie: StopwordList;
  export const yor: StopwordList;
  export const zho: StopwordList;
  export const zul: StopwordList;
}
