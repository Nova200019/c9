import axios from "axios";

/**
 * CloudflareActions - Handles integration with Cloudflare Edge CDN.
 * Purges cache for distributed files when they are updated or deleted.
 */
export class CloudflareActions {
  private static readonly CF_API_BASE = "https://api.cloudflare.com/client/v4";
  
  private static get headers() {
    return {
      "Authorization": `Bearer ${process.env.CLOUDFLARE_API_TOKEN || ""}`,
      "Content-Type": "application/json"
    };
  }

  /**
   * Generates the public CDN URL for a file, if CDN is enabled.
   */
  static getCdnUrl(fileID: string, filename: string): string | null {
    const cdnBase = process.env.CLOUDFLARE_CDN_URL;
    const useCdn = process.env.USE_CDN_FOR_PUBLIC_FILES === "true";
    
    if (!cdnBase || !useCdn) return null;
    
    // Assuming the CDN is configured to proxy a bucket matching the fileID structure
    return `${cdnBase.replace(/\/$/, "")}/public/${fileID}/${encodeURIComponent(filename)}`;
  }

  /**
   * Purge a specific file URL from the Cloudflare Edge Cache.
   * Useful when a public file is deleted or updated.
   */
  static async purgeCache(urls: string[]): Promise<boolean> {
    const zoneId = process.env.CLOUDFLARE_ZONE_ID;
    if (!zoneId || !process.env.CLOUDFLARE_API_TOKEN) {
      console.warn("[Cloudflare] Cannot purge cache: Missing API Token or Zone ID in .env");
      return false;
    }

    try {
      const response = await axios.post(
        `${this.CF_API_BASE}/zones/${zoneId}/purge_cache`,
        { files: urls },
        { headers: this.headers, timeout: 5000 }
      );
      
      return response.data.success === true;
    } catch (error: any) {
      console.error("[Cloudflare] Purge cache failed:", error.response?.data || error.message);
      return false;
    }
  }
}
