import type { ObjectStorage } from "@/shared/storage";

/** In-memory object storage: the real S3 path is covered by the docker compose job in CI */
export class FakeStorage implements ObjectStorage {
  readonly objects = new Map<string, Uint8Array>();
  /** Lets a test pretend an object is bigger than it is (no need to allocate 5 GiB) */
  readonly reportedSizes = new Map<string, number>();

  presignUpload(key: string, expiresInSeconds: number) {
    return `https://storage.test/${key}?X-Amz-Expires=${expiresInSeconds}&X-Amz-Signature=fake`;
  }

  presignDownload(key: string, expiresInSeconds: number) {
    return `https://storage.test/${key}?X-Amz-Expires=${expiresInSeconds}&X-Amz-Signature=fake-get`;
  }

  async stat(key: string) {
    const object = this.objects.get(key);
    return object ? { size: this.reportedSizes.get(key) ?? object.length } : null;
  }

  async readHead(key: string, bytes: number) {
    return (this.objects.get(key) ?? new Uint8Array()).slice(0, bytes);
  }

  async write(key: string, data: Blob | Uint8Array | string) {
    this.objects.set(
      key,
      typeof data === "string"
        ? new TextEncoder().encode(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(await data.arrayBuffer()),
    );
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async deletePrefix(prefix: string) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix));
    for (const key of keys) this.objects.delete(key);
    return keys.length;
  }

  async ping() {
    return true;
  }

  /** What a browser's PUT to the presigned URL does */
  upload(presignedUrl: string, data: Uint8Array) {
    this.objects.set(decodeURIComponent(new URL(presignedUrl).pathname.slice(1)), data);
  }

  keyOf(presignedUrl: string) {
    return decodeURIComponent(new URL(presignedUrl).pathname.slice(1));
  }
}
