import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
	type S3ClientConfig,
} from "@aws-sdk/client-s3";

export interface ArtifactBlobStore {
	put(ownerId: string, artifactId: string, bytes: Uint8Array): Promise<void>;
	get(ownerId: string, artifactId: string): Promise<Uint8Array | null>;
	delete(ownerId: string, artifactId: string): Promise<void>;
}

export class MemoryArtifactBlobStore implements ArtifactBlobStore {
	private readonly objects = new Map<string, Uint8Array>();

	async put(
		ownerId: string,
		artifactId: string,
		bytes: Uint8Array,
	): Promise<void> {
		this.objects.set(key(ownerId, artifactId), new Uint8Array(bytes));
	}

	async get(ownerId: string, artifactId: string): Promise<Uint8Array | null> {
		const value = this.objects.get(key(ownerId, artifactId));
		return value ? new Uint8Array(value) : null;
	}

	async delete(ownerId: string, artifactId: string): Promise<void> {
		this.objects.delete(key(ownerId, artifactId));
	}
}

/**
 * Single-node/self-host blob store. Owner ids are hashed into directory names
 * and artifact ids are restricted so neither value can escape the configured
 * root. Multi-replica deployments should provide an S3-compatible adapter.
 */
export class FileArtifactBlobStore implements ArtifactBlobStore {
	private readonly root: string;

	constructor(root: string) {
		this.root = resolve(root);
	}

	async put(
		ownerId: string,
		artifactId: string,
		bytes: Uint8Array,
	): Promise<void> {
		const path = this.path(ownerId, artifactId);
		const directory = join(this.root, ownerKey(ownerId));
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
		await writeFile(temp, bytes, { mode: 0o600 });
		await rename(temp, path);
	}

	async get(ownerId: string, artifactId: string): Promise<Uint8Array | null> {
		try {
			return new Uint8Array(await readFile(this.path(ownerId, artifactId)));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
	}

	async delete(ownerId: string, artifactId: string): Promise<void> {
		try {
			await unlink(this.path(ownerId, artifactId));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}

	private path(ownerId: string, artifactId: string): string {
		assertArtifactId(artifactId);
		return join(this.root, ownerKey(ownerId), artifactId);
	}
}

export interface S3ArtifactBlobStoreOptions {
	bucket: string;
	prefix?: string;
	client?: S3Client;
	clientConfig?: S3ClientConfig;
}

/** Multi-replica blob storage for AWS S3 and S3-compatible services. */
export class S3ArtifactBlobStore implements ArtifactBlobStore {
	private readonly bucket: string;
	private readonly prefix: string;
	private readonly client: S3Client;

	constructor(options: S3ArtifactBlobStoreOptions) {
		if (!options.bucket.trim()) {
			throw new Error("S3 artifact bucket is required");
		}
		this.bucket = options.bucket;
		this.prefix =
			options.prefix?.replace(/^\/+|\/+$/g, "") ?? "agntz-artifacts";
		this.client = options.client ?? new S3Client(options.clientConfig ?? {});
	}

	async put(
		ownerId: string,
		artifactId: string,
		bytes: Uint8Array,
	): Promise<void> {
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: this.objectKey(ownerId, artifactId),
				Body: bytes,
			}),
		);
	}

	async get(ownerId: string, artifactId: string): Promise<Uint8Array | null> {
		try {
			const result = await this.client.send(
				new GetObjectCommand({
					Bucket: this.bucket,
					Key: this.objectKey(ownerId, artifactId),
				}),
			);
			if (!result.Body) return null;
			return Uint8Array.from(await result.Body.transformToByteArray());
		} catch (error) {
			const status = (
				error as {
					$metadata?: { httpStatusCode?: number };
					name?: string;
				}
			).$metadata?.httpStatusCode;
			const name = (error as { name?: string }).name;
			if (status === 404 || name === "NoSuchKey" || name === "NotFound") {
				return null;
			}
			throw error;
		}
	}

	async delete(ownerId: string, artifactId: string): Promise<void> {
		await this.client.send(
			new DeleteObjectCommand({
				Bucket: this.bucket,
				Key: this.objectKey(ownerId, artifactId),
			}),
		);
	}

	private objectKey(ownerId: string, artifactId: string): string {
		assertArtifactId(artifactId);
		return `${this.prefix}/${ownerKey(ownerId)}/${artifactId}`;
	}
}

export function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function key(ownerId: string, artifactId: string): string {
	assertArtifactId(artifactId);
	return `${ownerId}:${artifactId}`;
}

function ownerKey(ownerId: string): string {
	return createHash("sha256").update(ownerId).digest("hex");
}

function assertArtifactId(artifactId: string): void {
	if (!/^[A-Za-z0-9_-]{8,128}$/.test(artifactId)) {
		throw new Error("Invalid artifact id");
	}
}
