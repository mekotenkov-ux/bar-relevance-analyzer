declare module "az" {
  type Parse = {
    word?: string;
    normalize?: () => Parse | false;
  };

  type Morph = {
    (word: string): Parse[];
    init(callback: (error?: Error | null) => void): void;
    init(path: string, callback: (error?: Error | null) => void): void;
  };

  const Az: { Morph: Morph };
  export default Az;
}

declare module "az/dicts/*?url" {
  const url: string;
  export default url;
}
