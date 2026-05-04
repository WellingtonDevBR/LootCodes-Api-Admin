export interface IStorage {
  createSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string | null>;
}
