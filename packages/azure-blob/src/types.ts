import type { TokenCredential } from '@azure/core-auth';

/**
 * Configuration for AzureBlobDriver.
 *
 * Azure exposes two common auth shapes: a full connection string, or a
 * separate account name + credential (account key or a TokenCredential
 * from `@azure/identity` for managed identity / AAD auth). Both are
 * supported here as alternative auth strategies rather than forcing one.
 */
export interface AzureBlobDriverConfig {
  /** The Azure Blob container to read/write objects from. */
  containerName: string;
  /** Optional key prefix automatically applied to every key passed into the driver. */
  keyPrefix?: string;
  /** Authentication strategy — exactly one of these shapes should be provided. */
  auth: AzureBlobAuth;
  /**
   * Buffer size in bytes for each block in a streaming (multipart) upload.
   * Defaults to 4 MB. Increase for very large files to reduce round-trips.
   */
  uploadBufferSize?: number;
  /**
   * Number of blocks uploaded concurrently during a streaming upload.
   * Defaults to 5. Higher values improve throughput on fast connections.
   */
  uploadConcurrency?: number;
}

export type AzureBlobAuth =
  | { mode: 'connection-string'; connectionString: string }
  | { mode: 'shared-key'; accountName: string; accountKey: string; endpoint?: string }
  | { mode: 'token-credential'; accountName: string; credential: TokenCredential; endpoint?: string };
