import {
  XMLRIVER_REGION_CATALOG_VERSION,
  XMLRIVER_REGION_SOURCES,
  resolveXmlRiverRegion,
  searchXmlRiverRegions,
  type XmlRiverSearchEngine,
  xmlRiverCountries,
  xmlRiverRegions,
  xmlRiverRegionsForCountry,
} from "@/lib/xmlriver-regions";

function searchEngine(value: string | null): XmlRiverSearchEngine {
  return value === "google" ? "google" : "yandex";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const engine = searchEngine(url.searchParams.get("engine"));
  const resolve = url.searchParams.get("resolve")?.trim();
  if (resolve) {
    const region = resolveXmlRiverRegion(engine, resolve);
    if (!region) return Response.json({ error: "Регион не найден в справочнике XMLRiver" }, { status: 404 });
    return Response.json({ engine, version: XMLRIVER_REGION_CATALOG_VERSION, region, source: XMLRIVER_REGION_SOURCES[engine] });
  }

  const listCountries = url.searchParams.get("countries") === "1"
    || url.searchParams.get("mode") === "countries";
  if (listCountries) {
    const countries = xmlRiverCountries(engine);
    return Response.json({
      engine,
      version: XMLRIVER_REGION_CATALOG_VERSION,
      total: countries.length,
      countries,
      source: XMLRIVER_REGION_SOURCES[engine],
    });
  }

  const query = url.searchParams.get("q") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const rawCountryCode = url.searchParams.get("countryCode")?.trim() ?? "";
  if (rawCountryCode && !/^[a-z]{2}$/iu.test(rawCountryCode)) {
    return Response.json({ error: "Код страны должен состоять из двух латинских букв" }, { status: 400 });
  }
  const countryCode = rawCountryCode.toLocaleUpperCase("en-US");
  const regions = searchXmlRiverRegions(engine, query, Number.isFinite(limit) ? limit : 100, countryCode);
  return Response.json({
    engine,
    version: XMLRIVER_REGION_CATALOG_VERSION,
    total: countryCode ? xmlRiverRegionsForCountry(engine, countryCode).length : xmlRiverRegions(engine).length,
    countryCode: countryCode || null,
    regions,
    source: XMLRIVER_REGION_SOURCES[engine],
  });
}
