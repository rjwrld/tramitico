/** Browser identity shared by official sources that reject bare HTTP clients. */
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
