/**
 * Configuration for LocalDriver — stores objects as files on local disk.
 * Useful for local development and for self-hosted deployments that don't
 * need cloud storage.
 */
export interface LocalDriverConfig {
  /** Absolute path to the directory objects are stored under. Created if it doesn't exist. */
  rootDir: string;
  /**
   * Base URL used to construct "signed" URLs for this driver, e.g.
   * "http://localhost:3000/files". Since local disk has no native concept
   * of a signed URL, this is a best-effort emulation intended for dev use —
   * see LocalDriver's getSignedUrl documentation for caveats.
   */
  publicBaseUrl?: string;
}
