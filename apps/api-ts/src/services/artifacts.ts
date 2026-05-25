import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const bucket = process.env.MINIO_BUCKET ?? 'agentlens-artifacts';
const endpoint = process.env.MINIO_ENDPOINT ?? 'http://localhost:9000';
const accessKeyId = process.env.MINIO_ACCESS_KEY ?? 'agentlens';
const secretAccessKey = process.env.MINIO_SECRET_KEY ?? 'agentlens-secret';
const region = process.env.MINIO_REGION ?? 'us-east-1';

const s3Client = new S3Client({
  region,
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

export interface ArtifactObjectConfig {
  bucket: string;
  key: string;
  contentType?: string;
}

export function artifactBucket(): string {
  return bucket;
}

export async function presignArtifactUpload(config: ArtifactObjectConfig, expiresInSeconds = 900): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: config.key,
    ContentType: config.contentType,
  });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

export async function presignArtifactDownload(config: ArtifactObjectConfig, expiresInSeconds = 900): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: config.key,
  });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}
