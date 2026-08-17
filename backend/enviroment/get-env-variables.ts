import path from "path";

const getEnvVariables = () => {
  const configPath = path.join(__dirname, "..", "..", "backend", "config");

  const processType = process.env.NODE_ENV;

  if (processType === "production" || processType === undefined) {
    require("dotenv").config({ path: configPath + "/.env.production" });
  } else if (processType === "development") {
    require("dotenv").config({ path: configPath + "/.env.development" });
  } else if (processType === "test") {
    require("dotenv").config({ path: configPath + "/.env.test" });
  }

  // Auto-construct composite URLs from Render's fromService host/port values
  if (process.env.OLLAMA_HOST && !process.env.OLLAMA_URL) {
    const port = process.env.OLLAMA_PORT || "11434";
    process.env.OLLAMA_URL = `http://${process.env.OLLAMA_HOST}:${port}`;
  }

  if (process.env.MINIO_HOST && !process.env.S3_ENDPOINT) {
    const port = process.env.MINIO_PORT || "9000";
    process.env.S3_ENDPOINT = `http://${process.env.MINIO_HOST}:${port}`;
  }
};

export default getEnvVariables;
module.exports = getEnvVariables;
