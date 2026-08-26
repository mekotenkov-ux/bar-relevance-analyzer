declare module "snowball-stemmers" {
  type Stemmer = { stem(word: string): string };
  type Factory = { newStemmer(language: string): Stemmer; algorithms(): string[] };
  const factory: Factory;
  export default factory;
}
