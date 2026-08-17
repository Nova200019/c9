import fs from "fs";
import path from "path";

/**
 * Dynamically updates the .env file and optionally restarts the server.
 */
export class ConfigManager {
  private static get envPath(): string {
    return path.join(__dirname, "..", "config", ".env.production");
  }

  /**
   * Reads the current environment file and returns it as a Record of key-value pairs.
   */
  static readConfig(): Record<string, string> {
    const config: Record<string, string> = {};
    if (!fs.existsSync(this.envPath)) return config;

    const fileContent = fs.readFileSync(this.envPath, "utf-8");
    const lines = fileContent.split("\n");

    for (const line of lines) {
      if (!line || line.startsWith("#")) continue;
      const [key, ...rest] = line.split("=");
      if (key && rest.length >= 0) {
        config[key.trim()] = rest.join("=").replace(/^"|"$/g, "").trim();
      }
    }
    return config;
  }

  /**
   * Updates or adds keys in the .env file.
   */
  static updateConfig(updates: Record<string, string>): void {
    const currentConfig = this.readConfig();
    const newConfig = { ...currentConfig, ...updates };

    let envString = "# Dynamic Environment Config\n";
    for (const [key, value] of Object.entries(newConfig)) {
      envString += `${key}="${value}"\n`;
    }

    fs.writeFileSync(this.envPath, envString, "utf-8");
    console.log("[ConfigManager] Environment configuration updated successfully.");
  }

  /**
   * Force a graceful server restart so new env vars take effect.
   * Relies on pm2, nodemon, or Docker restart policies.
   */
  static restartServer(): void {
    console.log("[ConfigManager] Restarting server to apply new configuration...");
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  }
}
