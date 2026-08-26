import grammemesUrl from "az/dicts/grammemes.json?url";
import tagsExternalUrl from "az/dicts/gramtab-opencorpora-ext.json?url";
import tagsInternalUrl from "az/dicts/gramtab-opencorpora-int.json?url";
import probabilitiesUrl from "az/dicts/p_t_given_w.intdawg?url";
import paradigmsUrl from "az/dicts/paradigms.array?url";
import prediction0Url from "az/dicts/prediction-suffixes-0.dawg?url";
import prediction1Url from "az/dicts/prediction-suffixes-1.dawg?url";
import prediction2Url from "az/dicts/prediction-suffixes-2.dawg?url";
import suffixesUrl from "az/dicts/suffixes.json?url";
import wordsUrl from "az/dicts/words.dawg?url";

type AzParse = {
  word?: string;
  normalize?: () => AzParse | false;
};

type AzMorph = {
  (word: string): AzParse[];
  init: {
    (callback: (error?: Error | null) => void): void;
    (path: string, callback: (error?: Error | null) => void): void;
  };
};

type AzModule = {
  Morph: AzMorph;
  load: (url: string, responseType: "json" | "arraybuffer", callback: (error: Error | null, data?: unknown) => void) => void;
};

const dictionaryAssets: Record<string, string> = {
  "grammemes.json": grammemesUrl,
  "gramtab-opencorpora-ext.json": tagsExternalUrl,
  "gramtab-opencorpora-int.json": tagsInternalUrl,
  "p_t_given_w.intdawg": probabilitiesUrl,
  "paradigms.array": paradigmsUrl,
  "prediction-suffixes-0.dawg": prediction0Url,
  "prediction-suffixes-1.dawg": prediction1Url,
  "prediction-suffixes-2.dawg": prediction2Url,
  "suffixes.json": suffixesUrl,
  "words.dawg": wordsUrl,
};

let morphology: AzMorph | null = null;
let initialization: Promise<void> | null = null;

/**
 * Load the OpenCorpora-based Az.Morph dictionaries once per process. Analysis
 * awaits this promise before any Russian document is tokenized.
 */
export function initializeRussianMorphology(assetOrigin?: string) {
  if (morphology) return Promise.resolve();
  if (initialization) return initialization;
  initialization = Promise.all([
    import("az"),
    import("node:fs/promises"),
    import("node:path"),
    import("node:url"),
  ]).then(async ([module, nodeFs, nodePath, nodeUrl]) => {
    const az = ((module as { default?: AzModule }).default ?? module) as AzModule;
    const bundleDirectory = nodePath.dirname(nodeUrl.fileURLToPath(import.meta.url));
    const fileSystemCandidates = [
      nodePath.resolve(bundleDirectory, "../node_modules/az/dicts"),
      nodePath.resolve(bundleDirectory, "../../../node_modules/az/dicts"),
    ];
    let fileSystemPath = "";
    for (const candidate of fileSystemCandidates) {
      try {
        await nodeFs.access(nodePath.join(candidate, "words.dawg"));
        fileSystemPath = candidate;
        break;
      } catch { /* Cloudflare keeps application dependencies in a virtual bundle. */ }
    }

    const dictionaryPath = fileSystemPath || "/__bar_az_morphology__";
    if (!fileSystemPath) {
      if (!assetOrigin) throw new Error("Не задан адрес словарей русской морфологии");
      az.load = (url, responseType, callback) => {
        const name = url.slice(url.lastIndexOf("/") + 1);
        const asset = dictionaryAssets[name];
        if (!asset) {
          callback(new Error(`Неизвестный файл словаря: ${name}`));
          return;
        }
        fetch(new URL(asset, assetOrigin)).then(async (response) => {
          if (!response.ok) throw new Error(`Не удалось загрузить словарь ${name}: HTTP ${response.status}`);
          return responseType === "json" ? response.json() : response.arrayBuffer();
        }).then((data) => callback(null, data)).catch((error) => callback(error instanceof Error ? error : new Error(String(error))));
      };
    }

    await new Promise<void>((resolve, reject) => az.Morph.init(dictionaryPath, (error) => {
      if (error) reject(error);
      else resolve();
    }));
    morphology = az.Morph;
  }).catch((error) => {
    initialization = null;
    throw error;
  });
  return initialization;
}

export function russianLemma(word: string) {
  if (!morphology) throw new Error("Русская морфология не инициализирована");
  const normalized = morphology(word)[0]?.normalize?.();
  return normalized && normalized.word ? normalized.word : word;
}
