import { Buffer } from "node:buffer";
import { gunzipSync } from "node:zlib";

import {
  XMLRIVER_GENERATED_CATALOG_METADATA,
  XMLRIVER_GENERATED_CATALOG_VERSION,
  XMLRIVER_GOOGLE_REGIONS_GZIP_BASE64,
  XMLRIVER_YANDEX_REGIONS_GZIP_BASE64,
} from "./xmlriver-regions.generated.ts";

export type XmlRiverSearchEngine = "google" | "yandex";

export type XmlRiverRegion = {
  code: string;
  label: string;
  canonicalName: string;
  displayLabel: string;
  countryCode: string;
  kind: "country" | "region" | "city";
};

type RegionTuple = readonly [
  code: string,
  label: string,
  canonicalName: string,
  countryCode: string,
  kind: XmlRiverRegion["kind"],
  aliases?: string,
];

export const XMLRIVER_REGION_CATALOG_VERSION = XMLRIVER_GENERATED_CATALOG_VERSION;

export const XMLRIVER_REGION_SOURCES = Object.freeze({
  google: {
    documentation: "https://xmlriver.com/apidoc/api-about/",
    catalog: "https://xmlriver.com/files/geo.csv",
    retrievedAt: XMLRIVER_GENERATED_CATALOG_VERSION,
    coverage: `Полный официальный CSV XMLRiver: ${XMLRIVER_GENERATED_CATALOG_METADATA.google.rows} местоположений (${XMLRIVER_GENERATED_CATALOG_METADATA.google.activeRows} активных)`,
    sha256: XMLRIVER_GENERATED_CATALOG_METADATA.google.sha256,
  },
  yandex: {
    documentation: "https://xmlriver.com/apiydoc/apiy-about/",
    catalog: "https://xmlriver.com/blog/spisok-kodov-regionov-yandex-poiska-s-ierarhiej.html",
    sourceModifiedAt: "2024-07-26",
    retrievedAt: XMLRIVER_GENERATED_CATALOG_VERSION,
    coverage: `Полный опубликованный XMLRiver иерархический список: ${XMLRIVER_GENERATED_CATALOG_METADATA.yandex.rows} уникальных кодов`,
    sha256: XMLRIVER_GENERATED_CATALOG_METADATA.yandex.sha256,
  },
});

const curatedYandexTuples: readonly RegionTuple[] = [
  ["225", "Россия", "Россия", "RU", "country", "ru russia"],
  ["1", "Москва и Московская область", "Москва и Московская область, Россия", "RU", "region", "москва и область московская область"],
  ["213", "Москва", "Москва, Россия", "RU", "city", "moscow"],
  ["10174", "Санкт-Петербург и Ленинградская область", "Санкт-Петербург и Ленинградская область, Россия", "RU", "region", "ленинградская область спб и область"],
  ["2", "Санкт-Петербург", "Санкт-Петербург, Россия", "RU", "city", "санкт петербург спб saint petersburg"],
  ["65", "Новосибирск", "Новосибирск, Россия", "RU", "city"],
  ["54", "Екатеринбург", "Екатеринбург, Россия", "RU", "city", "yekaterinburg"],
  ["43", "Казань", "Казань, Россия", "RU", "city", "kazan"],
  ["47", "Нижний Новгород", "Нижний Новгород, Россия", "RU", "city"],
  ["56", "Челябинск", "Челябинск, Россия", "RU", "city"],
  ["62", "Красноярск", "Красноярск, Россия", "RU", "city"],
  ["51", "Самара", "Самара, Россия", "RU", "city"],
  ["172", "Уфа", "Уфа, Россия", "RU", "city"],
  ["39", "Ростов-на-Дону", "Ростов-на-Дону, Россия", "RU", "city", "ростов на дону"],
  ["66", "Омск", "Омск, Россия", "RU", "city"],
  ["35", "Краснодар", "Краснодар, Россия", "RU", "city"],
  ["193", "Воронеж", "Воронеж, Россия", "RU", "city"],
  ["50", "Пермь", "Пермь, Россия", "RU", "city"],
  ["38", "Волгоград", "Волгоград, Россия", "RU", "city"],
  ["194", "Саратов", "Саратов, Россия", "RU", "city"],
  ["55", "Тюмень", "Тюмень, Россия", "RU", "city"],
  ["240", "Тольятти", "Тольятти, Россия", "RU", "city", "togliatti"],
  ["44", "Ижевск", "Ижевск, Россия", "RU", "city"],
  ["197", "Барнаул", "Барнаул, Россия", "RU", "city"],
  ["195", "Ульяновск", "Ульяновск, Россия", "RU", "city"],
  ["63", "Иркутск", "Иркутск, Россия", "RU", "city"],
  ["76", "Хабаровск", "Хабаровск, Россия", "RU", "city"],
  ["75", "Владивосток", "Владивосток, Россия", "RU", "city"],
  ["16", "Ярославль", "Ярославль, Россия", "RU", "city"],
  ["28", "Махачкала", "Махачкала, Россия", "RU", "city"],
  ["67", "Томск", "Томск, Россия", "RU", "city"],
  ["48", "Оренбург", "Оренбург, Россия", "RU", "city"],
  ["64", "Кемерово", "Кемерово, Россия", "RU", "city"],
  ["237", "Новокузнецк", "Новокузнецк, Россия", "RU", "city"],
  ["11", "Рязань", "Рязань, Россия", "RU", "city"],
  ["236", "Набережные Челны", "Набережные Челны, Россия", "RU", "city"],
  ["37", "Астрахань", "Астрахань, Россия", "RU", "city"],
  ["49", "Пенза", "Пенза, Россия", "RU", "city"],
  ["9", "Липецк", "Липецк, Россия", "RU", "city"],
  ["46", "Киров", "Киров, Россия", "RU", "city"],
  ["45", "Чебоксары", "Чебоксары, Россия", "RU", "city"],
  ["22", "Калининград", "Калининград, Россия", "RU", "city"],
  ["15", "Тула", "Тула, Россия", "RU", "city"],
  ["8", "Курск", "Курск, Россия", "RU", "city"],
  ["36", "Ставрополь", "Ставрополь, Россия", "RU", "city"],
  ["239", "Сочи", "Сочи, Россия", "RU", "city"],
  ["14", "Тверь", "Тверь, Россия", "RU", "city"],
  ["235", "Магнитогорск", "Магнитогорск, Россия", "RU", "city"],
  ["5", "Иваново", "Иваново, Россия", "RU", "city"],
  ["191", "Брянск", "Брянск, Россия", "RU", "city"],
  ["4", "Белгород", "Белгород, Россия", "RU", "city"],
  ["20", "Архангельск", "Архангельск, Россия", "RU", "city"],
  ["192", "Владимир", "Владимир, Россия", "RU", "city"],
  ["959", "Севастополь", "Севастополь", "", "city"],
  ["146", "Симферополь", "Симферополь", "", "city"],
  ["84", "США", "США", "US", "country", "us usa united states"],
  ["102", "Великобритания", "Великобритания", "GB", "country", "gb uk united kingdom"],
  ["96", "Германия", "Германия", "DE", "country", "de germany"],
  ["124", "Франция", "Франция", "FR", "country", "fr france"],
  ["204", "Испания", "Испания", "ES", "country", "es spain"],
  ["205", "Италия", "Италия", "IT", "country", "it italy"],
  ["983", "Турция", "Турция", "TR", "country", "tr turkey"],
  ["159", "Казахстан", "Казахстан", "KZ", "country", "kz kazakhstan"],
  ["149", "Беларусь", "Беларусь", "BY", "country", "by belarus белоруссия"],
  ["210", "ОАЭ", "Объединённые Арабские Эмираты", "AE", "country", "ae uae united arab emirates"],
  ["187", "Украина", "Украина", "UA", "country", "ua ukraine"],
  ["143", "Киев", "Киев, Украина", "UA", "city", "kyiv kiev"],
  ["167", "Азербайджан", "Азербайджан", "AZ", "country", "az azerbaijan"],
  ["168", "Армения", "Армения", "AM", "country", "am armenia"],
  ["169", "Грузия", "Грузия", "GE", "country", "ge georgia"],
  ["207", "Киргизия", "Киргизия", "KG", "country", "kg kyrgyzstan кыргызстан"],
  ["171", "Узбекистан", "Узбекистан", "UZ", "country", "uz uzbekistan"],
  ["208", "Молдова", "Молдова", "MD", "country", "md moldova"],
  ["211", "Австралия", "Австралия", "AU", "country", "au australia"],
  ["94", "Бразилия", "Бразилия", "BR", "country", "br brazil"],
  ["95", "Канада", "Канада", "CA", "country", "ca canada"],
  ["134", "Китай", "Китай", "CN", "country", "cn china"],
  ["994", "Индия", "Индия", "IN", "country", "in india"],
  ["118", "Нидерланды", "Нидерланды", "NL", "country", "nl netherlands"],
  ["120", "Польша", "Польша", "PL", "country", "pl poland"],
];

const curatedGoogleTuples: readonly RegionTuple[] = [
  ["2643", "Россия", "Russia", "RU", "country", "ru russia"],
  ["1011969", "Москва", "Moscow,Moscow,Russia", "RU", "city", "moscow"],
  ["20949", "Московская область", "Moscow Oblast,Russia", "RU", "region", "moscow oblast подмосковье"],
  ["1012040", "Санкт-Петербург", "Saint Petersburg,Saint Petersburg,Russia", "RU", "city", "санкт петербург спб saint petersburg"],
  ["20945", "Ленинградская область", "Leningrad Oblast,Russia", "RU", "region", "leningrad oblast"],
  ["1011984", "Новосибирск", "Novosibirsk,Novosibirsk Oblast,Russia", "RU", "city"],
  ["1012052", "Екатеринбург", "Yekaterinburg,Sverdlovsk Oblast,Russia", "RU", "city", "yekaterinburg"],
  ["1012054", "Казань", "Kazan,Tatarstan,Russia", "RU", "city", "kazan"],
  ["1011981", "Нижний Новгород", "Nizhny Novgorod,Nizhny Novgorod Oblast,Russia", "RU", "city"],
  ["1011874", "Челябинск", "Chelyabinsk,Chelyabinsk Oblast,Russia", "RU", "city"],
  ["1011941", "Красноярск", "Krasnoyarsk,Krasnoyarsk Krai,Russia", "RU", "city"],
  ["1012029", "Самара", "Samara,Samara Oblast,Russia", "RU", "city"],
  ["1011867", "Уфа", "Ufa,Republic of Bashkortostan,Russia", "RU", "city"],
  ["1012013", "Ростов-на-Дону", "Rostov-on-Don,Rostov Oblast,Russia", "RU", "city", "ростов на дону"],
  ["1011985", "Омск", "Omsk,Omsk Oblast,Russia", "RU", "city"],
  ["1011905", "Краснодар", "Krasnodar,Krasnodar Krai,Russia", "RU", "city"],
  ["1012077", "Воронеж", "Voronezh,Voronezh Oblast,Russia", "RU", "city"],
  ["1011993", "Пермь", "Perm,Perm Krai,Russia", "RU", "city"],
  ["1012068", "Волгоград", "Volgograd,Volgograd Oblast,Russia", "RU", "city"],
  ["1012036", "Саратов", "Saratov,Saratov Oblast,Russia", "RU", "city"],
  ["1012062", "Тюмень", "Tyumen,Tyumen Oblast,Russia", "RU", "city"],
  ["1012032", "Тольятти", "Tolyatti,Samara Oblast,Russia", "RU", "city", "togliatti"],
  ["1012064", "Ижевск", "Izhevsk,Udmurt Republic,Russia", "RU", "city"],
  ["1011853", "Барнаул", "Barnaul,Altai Krai,Russia", "RU", "city"],
  ["1012067", "Ульяновск", "Ulyanovsk,Ulyanovsk Oblast,Russia", "RU", "city"],
  ["1011896", "Иркутск", "Irkutsk,Irkutsk Oblast,Russia", "RU", "city"],
  ["1011918", "Хабаровск", "Khabarovsk,Khabarovsk Krai,Russia", "RU", "city"],
  ["1012008", "Владивосток", "Vladivostok,Primorsky Krai,Russia", "RU", "city"],
  ["1012084", "Ярославль", "Yaroslavl,Yaroslavl Oblast,Russia", "RU", "city"],
  ["1011892", "Махачкала", "Makhachkala,Dagestan Republic,Russia", "RU", "city"],
  ["1012059", "Томск", "Tomsk,Tomsk Oblast,Russia", "RU", "city"],
  ["1011987", "Оренбург", "Orenburg,Orenburg Oblast,Russia", "RU", "city"],
  ["1011909", "Кемерово", "Kemerovo,Kemerovo Oblast,Russia", "RU", "city"],
  ["1011912", "Новокузнецк", "Novokuznetsk,Kemerovo Oblast,Russia", "RU", "city"],
  ["1012017", "Рязань", "Ryazan,Ryazan Oblast,Russia", "RU", "city"],
  ["1012055", "Набережные Челны", "Naberezhnye Chelny,Tatarstan,Russia", "RU", "city"],
  ["1011862", "Астрахань", "Astrakhan,Astrakhan Oblast,Russia", "RU", "city"],
  ["1011996", "Пенза", "Penza,Penza Oblast,Russia", "RU", "city"],
  ["1011947", "Липецк", "Lipetsk,Lipetsk Oblast,Russia", "RU", "city"],
  ["1011925", "Киров", "Kirov,Kirov Oblast,Russia", "RU", "city"],
  ["9040951", "Чебоксары", "Cheboksary,Chuvashia Republic,Russia", "RU", "city"],
  ["1011914", "Калининград", "Kaliningrad,Kaliningrad Oblast,Russia", "RU", "city"],
  ["1012060", "Тула", "Tula,Tula Oblast,Russia", "RU", "city"],
  ["1011937", "Курск", "Kursk,Kursk Oblast,Russia", "RU", "city"],
  ["1012043", "Ставрополь", "Stavropol,Stavropol Krai,Russia", "RU", "city"],
  ["1011907", "Сочи", "Sochi,Krasnodar Krai,Russia", "RU", "city"],
  ["1012061", "Тверь", "Tver,Tver Oblast,Russia", "RU", "city"],
  ["1011881", "Магнитогорск", "Magnitogorsk,Chelyabinsk Oblast,Russia", "RU", "city"],
  ["1011898", "Иваново", "Ivanovo,Ivanovo Oblast,Russia", "RU", "city"],
  ["1011869", "Брянск", "Bryansk,Bryansk Oblast,Russia", "RU", "city"],
  ["1011868", "Белгород", "Belgorod,Belgorod Oblast,Russia", "RU", "city"],
  ["1011859", "Архангельск", "Arkhangelsk,Arkhangelsk Oblast,Russia", "RU", "city"],
  ["1012073", "Владимир", "Vladimir,Vladimir Oblast,Russia", "RU", "city"],
  ["2840", "США", "United States", "US", "country", "us usa united states"],
  ["1023191", "Нью-Йорк", "New York,New York,United States", "US", "city", "new york нью йорк"],
  ["1013962", "Лос-Анджелес", "Los Angeles,California,United States", "US", "city", "los angeles лос анджелес"],
  ["2826", "Великобритания", "United Kingdom", "GB", "country", "gb uk united kingdom"],
  ["1006886", "Лондон", "London,England,United Kingdom", "GB", "city", "london"],
  ["2276", "Германия", "Germany", "DE", "country", "de germany"],
  ["1003854", "Берлин", "Berlin,Berlin,Germany", "DE", "city", "berlin"],
  ["2250", "Франция", "France", "FR", "country", "fr france"],
  ["1006094", "Париж", "Paris,Paris,Ile-de-France,France", "FR", "city", "paris"],
  ["2724", "Испания", "Spain", "ES", "country", "es spain"],
  ["1005493", "Мадрид", "Madrid,Community of Madrid,Spain", "ES", "city", "madrid"],
  ["2380", "Италия", "Italy", "IT", "country", "it italy"],
  ["1008736", "Рим", "Rome,Lazio,Italy", "IT", "city", "rome"],
  ["2792", "Турция", "Turkey", "TR", "country", "tr turkey"],
  ["1012782", "Стамбул", "Istanbul,Istanbul,Turkey", "TR", "city", "istanbul"],
  ["2398", "Казахстан", "Kazakhstan", "KZ", "country", "kz kazakhstan"],
  ["9063099", "Алматы", "Almaty,Almaty Province,Kazakhstan", "KZ", "city", "almaty"],
  ["1009806", "Астана", "Astana,Kazakhstan", "KZ", "city", "astana"],
  ["2112", "Беларусь", "Belarus", "BY", "country", "by belarus белоруссия"],
  ["1001493", "Минск", "Minsk,Minsk Region,Belarus", "BY", "city", "minsk"],
  ["2784", "ОАЭ", "United Arab Emirates", "AE", "country", "ae uae united arab emirates"],
  ["1000013", "Дубай", "Dubai,Dubai,United Arab Emirates", "AE", "city", "dubai"],
  ["2036", "Австралия", "Australia", "AU", "country", "au australia"],
  ["1000286", "Сидней", "Sydney,New South Wales,Australia", "AU", "city", "sydney"],
  ["2076", "Бразилия", "Brazil", "BR", "country", "br brazil"],
  ["2124", "Канада", "Canada", "CA", "country", "ca canada"],
  ["1002451", "Торонто", "Toronto,Ontario,Canada", "CA", "city", "toronto"],
  ["2156", "Китай", "China", "CN", "country", "cn china"],
  ["1003334", "Пекин", "Beijing,Beijing,China", "CN", "city", "beijing"],
  ["2356", "Индия", "India", "IN", "country", "in india"],
  ["2528", "Нидерланды", "Netherlands", "NL", "country", "nl netherlands"],
  ["1010543", "Амстердам", "Amsterdam,North Holland,Netherlands", "NL", "city", "amsterdam"],
  ["2616", "Польша", "Poland", "PL", "country", "pl poland"],
  ["1011419", "Варшава", "Warsaw,Masovian Voivodeship,Poland", "PL", "city", "warsaw"],
  ["2804", "Украина", "Ukraine", "UA", "country", "ua ukraine"],
  ["1012852", "Киев", "Kyiv,Kyiv city,Ukraine", "UA", "city", "kyiv kiev"],
];

// XMLRiver publishes the Yandex catalog as a hierarchy, but the compact
// snapshot intentionally stores only the stable region id and label. Keep the
// country nodes explicit so a country selector does not depend on heuristics
// such as suffixes in translated names. Most foreign Yandex countries have no
// child locations in the published catalog; the country node itself remains a
// valid "whole country" region in that case. AB is a stable local code for
// Abkhazia, which has no ISO 3166-1 alpha-2 code.
const YANDEX_COUNTRY_CODES_BY_REGION_ID: Readonly<Record<string, string>> = Object.freeze({
  "211": "AU",
  "139": "NZ",
  "169": "GE",
  "181": "IL",
  "994": "IN",
  "20975": "KH",
  "134": "CN",
  "210": "AE",
  "995": "TH",
  "135": "KR",
  "137": "JP",
  "113": "AT",
  "114": "BE",
  "115": "BG",
  "102": "GB",
  "116": "HU",
  "96": "DE",
  "246": "GR",
  "203": "DK",
  "204": "ES",
  "205": "IT",
  "20574": "CY",
  "206": "LV",
  "117": "LT",
  "118": "NL",
  "119": "NO",
  "120": "PL",
  "10074": "PT",
  "10077": "RO",
  "180": "RS",
  "121": "SK",
  "122": "SI",
  "983": "TR",
  "123": "FI",
  "124": "FR",
  "10083": "HR",
  "21610": "ME",
  "125": "CZ",
  "126": "CH",
  "127": "SE",
  "179": "EE",
  "225": "RU",
  "95": "CA",
  "84": "US",
  "29386": "AB",
  "167": "AZ",
  "168": "AM",
  "149": "BY",
  "159": "KZ",
  "207": "KG",
  "208": "MD",
  "209": "TJ",
  "170": "TM",
  "171": "UZ",
  "187": "UA",
  "93": "AR",
  "94": "BR",
});

type GeneratedGoogleRow = readonly [
  code: string,
  label: string,
  canonicalName: string,
  countryCode: string,
  targetType: string,
  status: string,
];

type GeneratedYandexRow = readonly [code: string, label: string];

function decodeSnapshot<T>(base64: string): T {
  return JSON.parse(gunzipSync(Buffer.from(base64, "base64")).toString("utf8")) as T;
}

function googleKind(targetType: string): XmlRiverRegion["kind"] {
  if (targetType === "Country") return "country";
  return targetType === "City" || targetType === "City Region" || targetType === "Borough"
    || targetType === "Municipality" || targetType === "Neighborhood" ? "city" : "region";
}

function yandexKind(label: string): XmlRiverRegion["kind"] {
  return /(?:область|край|республика|округ|район|регион|африка|америка|азия|европа|океания|кавказ|поволжье|сибирь|урал|центр|восток)$/iu.test(label)
    ? "region" : "city";
}

function mergeCurated(full: readonly RegionTuple[], curated: readonly RegionTuple[]) {
  const curatedByCode = new Map(curated.map((tuple) => [tuple[0], tuple]));
  const merged = full.map((tuple) => curatedByCode.get(tuple[0]) ?? tuple);
  const fullCodes = new Set(full.map((tuple) => tuple[0]));
  return Object.freeze([...merged, ...curated.filter((tuple) => !fullCodes.has(tuple[0]))]);
}

const generatedGoogleTuples = decodeSnapshot<GeneratedGoogleRow[]>(XMLRIVER_GOOGLE_REGIONS_GZIP_BASE64)
  .map(([code, label, canonicalName, countryCode, targetType]) => (
    [code, label, canonicalName, countryCode, googleKind(targetType)] as const
  ));
function generatedYandexTuple(
  [code, label]: GeneratedYandexRow,
  index: number,
  boundaries: { russiaStart: number; russiaEnd: number; ukraineStart: number; ukraineEnd: number },
): RegionTuple {
  // The published XMLRiver list is hierarchical but the compact snapshot keeps
  // only code and label. Its Russian and Ukrainian descendants are contiguous,
  // so restore the country that is visible in the source hierarchy. This makes
  // duplicate city names unambiguous without changing the numeric API value.
  const countryCode = YANDEX_COUNTRY_CODES_BY_REGION_ID[code];
  if (countryCode) {
    return [code, label, label, countryCode, "country"];
  }
  if (index > boundaries.russiaStart && index < boundaries.russiaEnd) {
    return [code, label, `${label}, Россия`, "RU", yandexKind(label)];
  }
  if (index > boundaries.ukraineStart && index < boundaries.ukraineEnd) {
    return [code, label, `${label}, Украина`, "UA", yandexKind(label)];
  }
  return [code, label, label, "", yandexKind(label)];
}

const generatedYandexRows = decodeSnapshot<GeneratedYandexRow[]>(XMLRIVER_YANDEX_REGIONS_GZIP_BASE64);
const generatedYandexBoundaries = Object.freeze({
  russiaStart: generatedYandexRows.findIndex(([code]) => code === "225"),
  russiaEnd: generatedYandexRows.findIndex(([code]) => code === "10002"),
  ukraineStart: generatedYandexRows.findIndex(([code]) => code === "187"),
  ukraineEnd: generatedYandexRows.findIndex(([code]) => code === "10003"),
});
const generatedYandexTuples = generatedYandexRows
  .map((row, index) => generatedYandexTuple(row, index, generatedYandexBoundaries));

const googleTuples = mergeCurated(generatedGoogleTuples, curatedGoogleTuples);
const yandexTuples = mergeCurated(generatedYandexTuples, curatedYandexTuples);

function displayName(canonicalName: string, label: string) {
  return (canonicalName || label).split(",").map((part) => part.trim()).filter(Boolean).join(", ");
}

function toRegion([code, label, canonicalName, countryCode, kind]: RegionTuple): XmlRiverRegion {
  return Object.freeze({
    code,
    label,
    canonicalName,
    displayLabel: `${displayName(canonicalName, label)} — ${code}`,
    countryCode,
    kind,
  });
}

const catalogs = Object.freeze({
  google: Object.freeze(googleTuples.map(toRegion)),
  yandex: Object.freeze(yandexTuples.map(toRegion)),
});

const countries = Object.freeze({
  google: Object.freeze(catalogs.google.filter((region) => region.kind === "country" && region.countryCode)
    .sort((left, right) => left.label.localeCompare(right.label, "ru") || left.code.localeCompare(right.code))),
  yandex: Object.freeze(catalogs.yandex.filter((region) => region.kind === "country" && region.countryCode)
    .sort((left, right) => left.label.localeCompare(right.label, "ru") || left.code.localeCompare(right.code))),
});

const codeIndexes = Object.freeze({
  google: new Map(googleTuples.map((tuple, index) => [tuple[0], index])),
  yandex: new Map(yandexTuples.map((tuple, index) => [tuple[0], index])),
});

function normalizedText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/g, "е")
    .replace(/[‐‑‒–—―]/g, "-").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function searchIndex(tuple: RegionTuple) {
  return [
    normalizedText(tuple[1]),
    normalizedText(tuple[2]),
    tuple[4] === "country" ? normalizedText(tuple[3]) : "",
    normalizedText(tuple[5] ?? ""),
  ] as const;
}

const searchIndexes = Object.freeze({
  google: googleTuples.map(searchIndex),
  yandex: yandexTuples.map(searchIndex),
});

function inputCode(value: string) {
  const trimmed = value.trim();
  if (/^[1-9]\d{0,11}$/.test(trimmed)) return trimmed;
  const decorated = trimmed.match(/(?:^|[\s([—–-])([1-9]\d{0,11})\s*[)\]]?$/u);
  return decorated?.[1] ?? "";
}

export function xmlRiverRegions(engine: XmlRiverSearchEngine): readonly XmlRiverRegion[] {
  return catalogs[engine];
}

export function xmlRiverCountries(engine: XmlRiverSearchEngine): readonly XmlRiverRegion[] {
  return countries[engine];
}

function normalizedCountryCode(rawCountryCode: string) {
  return rawCountryCode.trim().toLocaleUpperCase("en-US");
}

export function xmlRiverRegionsForCountry(engine: XmlRiverSearchEngine, rawCountryCode: string): readonly XmlRiverRegion[] {
  const countryCode = normalizedCountryCode(rawCountryCode);
  if (!countryCode) return catalogs[engine];
  return catalogs[engine].filter((region) => region.countryCode === countryCode);
}

export function resolveXmlRiverRegion(engine: XmlRiverSearchEngine, raw: string): (XmlRiverRegion & { known: boolean }) | null {
  const value = raw.trim();
  if (!value || value.length > 160) return null;
  const code = inputCode(value);
  if (code) {
    const index = codeIndexes[engine].get(code) ?? -1;
    return index >= 0 ? { ...catalogs[engine][index], known: true } : {
      code,
      label: `Регион ${code}`,
      canonicalName: "",
      displayLabel: `Регион XMLRiver — ${code}`,
      countryCode: "",
      kind: "region",
      known: false,
    };
  }
  const query = normalizedText(value);
  // A human-readable canonical label must win over a broader alias. For example,
  // "Москва" resolves to city 213, not to "Москва и Московская область" (1).
  const primaryIndex = searchIndexes[engine]
    .findIndex(([label, canonicalName, countryCode]) => label === query || canonicalName === query || countryCode === query);
  const index = primaryIndex >= 0 ? primaryIndex : searchIndexes[engine]
    .findIndex(([, , , aliases]) => ` ${aliases} `.includes(` ${query} `));
  return index >= 0 ? { ...catalogs[engine][index], known: true } : null;
}

export function searchXmlRiverRegions(
  engine: XmlRiverSearchEngine,
  rawQuery = "",
  requestedLimit = 100,
  rawCountryCode = "",
) {
  const limit = Math.max(1, Math.min(200, Math.trunc(requestedLimit) || 100));
  const countryCode = normalizedCountryCode(rawCountryCode);
  const isAllowed = (region: XmlRiverRegion) => !countryCode || region.countryCode === countryCode;
  const code = inputCode(rawQuery);
  if (code) {
    const index = codeIndexes[engine].get(code);
    if (index === undefined || !isAllowed(catalogs[engine][index])) return [];
    return [catalogs[engine][index]];
  }
  const query = normalizedText(rawQuery).slice(0, 100);
  if (!query) return catalogs[engine].filter(isAllowed).slice(0, limit);
  const matches: Array<{ region: XmlRiverRegion; score: number; index: number }> = [];
  searchIndexes[engine].forEach((haystacks, index) => {
    if (!isAllowed(catalogs[engine][index])) return;
    const score = haystacks.some((value) => value === query) ? 1
      : haystacks.some((value) => value.startsWith(query)) ? 2
        : haystacks.some((value) => value.includes(query)) ? 3
          : Number.POSITIVE_INFINITY;
    if (Number.isFinite(score)) matches.push({ region: catalogs[engine][index], score, index });
  });
  return matches.sort((left, right) => left.score - right.score
      || left.region.label.localeCompare(right.region.label, "ru") || left.index - right.index)
    .slice(0, limit).map(({ region }) => region);
}
