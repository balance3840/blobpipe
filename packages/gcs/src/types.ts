/**
 * Authentication configuration for GcsDriver.
 *
 * Three modes are supported:
 *
 * `adc` — Application Default Credentials. The SDK picks up credentials from
 *   the environment: GOOGLE_APPLICATION_CREDENTIALS env var, gcloud CLI,
 *   Workload Identity (GKE), metadata server (Cloud Run / Compute Engine), etc.
 *   This is the recommended mode for production workloads running on GCP.
 *   Note: ADC via a user account (gcloud auth login) cannot generate signed
 *   URLs. Use `key-file` or `credentials` if you need getSignedUrl().
 *
 * `key-file` — Path to a service account JSON key file. Good for local dev
 *   or CI when running outside GCP.
 *
 * `credentials` — Inline service account credentials. Useful when secrets
 *   come from a secret manager rather than a file on disk.
 */
export type GcsAuth =
  | { mode: 'adc'; projectId: string }
  | { mode: 'key-file'; projectId: string; keyFilename: string }
  | {
      mode: 'credentials';
      projectId: string;
      /** Service account email, e.g. "my-sa@my-project.iam.gserviceaccount.com" */
      clientEmail: string;
      /** PEM-encoded RSA private key from the service account JSON. */
      privateKey: string;
    };

export interface GcsDriverConfig {
  /** The GCS bucket name to read/write objects from. */
  bucket: string;
  /** Authentication configuration — see GcsAuth for the three supported modes. */
  auth: GcsAuth;
  /**
   * Custom API endpoint, primarily used to target the GCS emulator (Fake GCS Server):
   *   docker run -p 4443:4443 fsouza/fake-gcs-server -scheme http -public-host localhost:4443
   * Set to "http://localhost:4443" when using the emulator.
   */
  apiEndpoint?: string;
  /** Optional key prefix automatically applied to every key, for namespacing within a shared bucket. */
  keyPrefix?: string;
  /**
   * Customer-managed encryption key resource name.
   * E.g. projects/my-project/locations/us/keyRings/my-ring/cryptoKeys/my-key
   * Applied by setting kmsKeyName on the File object at creation time.
   */
  kmsKeyName?: string;
}
