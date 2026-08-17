/**
 * image-gen.ts
 * Image generation with auto-detection of Stable Diffusion AUTOMATIC1111 vs ComfyUI.
 * Falls back to AI-described image + gradient SVG placeholder if neither is running.
 *
 * Env vars:
 *   STABLE_DIFFUSION_URL  — AUTOMATIC1111 API (e.g. http://localhost:7860)
 *   COMFYUI_URL           — ComfyUI API      (e.g. http://localhost:8188)
 */

import axios from "axios";
import { v4 as uuidv4 } from "uuid";

const ollamaBaseUrl = (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
const textModel = process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct";
const SD_URL = (process.env.STABLE_DIFFUSION_URL || "").replace(/\/$/, "");
const COMFYUI_URL = (process.env.COMFYUI_URL || "").replace(/\/$/, "");

export type ImageBackend = "auto1111" | "comfyui" | "description";

export interface ImageGenResult {
  backend: ImageBackend;
  imageBase64?: string;
  description: string;
  prompt: string;
  enhancedPrompt: string;
  svgPlaceholder?: string;
  width: number;
  height: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Prompt enhancement
// ──────────────────────────────────────────────────────────────────────────────

async function enhancePrompt(userPrompt: string): Promise<string> {
  try {
    const response = await axios.post(
      `${ollamaBaseUrl}/api/generate`,
      {
        model: textModel,
        prompt: `You are a Stable Diffusion expert prompt engineer.
Transform this user request into an optimized, detailed SD prompt.
Include: subject details, art style (e.g. "digital art, photorealistic, oil painting"), lighting, mood, color palette, composition quality tags.
Quality tags to consider: masterpiece, best quality, ultra-detailed, 8k uhd, sharp focus, vibrant.
Negative prompt is handled separately — focus only on what to INCLUDE.
Return ONLY the enhanced prompt text, no explanation.

User request: "${userPrompt}"

Enhanced SD prompt:`,
        stream: false,
      },
      { timeout: 30_000 }
    );
    return (response.data?.response as string || userPrompt).trim().slice(0, 800);
  } catch {
    return userPrompt;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Auto-detect which backend is available
// ──────────────────────────────────────────────────────────────────────────────

async function detectAvailableBackend(): Promise<ImageBackend | null> {
  // Check AUTOMATIC1111
  if (SD_URL) {
    try {
      await axios.get(`${SD_URL}/sdapi/v1/options`, { timeout: 4_000 });
      return "auto1111";
    } catch { /* not available */ }
  }

  // Check ComfyUI
  if (COMFYUI_URL) {
    try {
      await axios.get(`${COMFYUI_URL}/system_stats`, { timeout: 4_000 });
      return "comfyui";
    } catch { /* not available */ }
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// AUTOMATIC1111 (A1111) backend
// ──────────────────────────────────────────────────────────────────────────────

async function generateWithA1111(
  prompt: string,
  width = 768,
  height = 512
): Promise<string> {
  const response = await axios.post(
    `${SD_URL}/sdapi/v1/txt2img`,
    {
      prompt,
      negative_prompt: "blurry, low quality, distorted, ugly, watermark, text, deformed, bad anatomy, bad hands, out of frame",
      steps: 28,
      width,
      height,
      cfg_scale: 7.5,
      sampler_name: "DPM++ 2M Karras",
      restore_faces: false,
      send_images: true,
      save_images: false,
    },
    { timeout: 300_000 }
  );

  const images = response.data?.images;
  if (!Array.isArray(images) || !images[0]) {
    throw new Error("A1111 returned no images");
  }
  return images[0] as string; // base64
}

// ──────────────────────────────────────────────────────────────────────────────
// ComfyUI backend
// ──────────────────────────────────────────────────────────────────────────────

function buildComfyWorkflow(prompt: string, width: number, height: number) {
  const clientId = uuidv4();
  return {
    client_id: clientId,
    prompt: {
      "3": { class_type: "KSampler", inputs: { seed: Math.floor(Math.random() * 9999999), steps: 28, cfg: 7.5, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
      "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "v1-5-pruned-emaonly.ckpt" } },
      "5": { class_type: "EmptyLatentImage", inputs: { batch_size: 1, height, width } },
      "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["4", 1] } },
      "7": { class_type: "CLIPTextEncode", inputs: { text: "blurry, ugly, watermark, low quality, deformed", clip: ["4", 1] } },
      "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
      "9": { class_type: "SaveImage", inputs: { filename_prefix: "cloud9_", images: ["8", 0] } },
    },
  };
}

async function generateWithComfyUI(
  prompt: string,
  width = 768,
  height = 512
): Promise<string> {
  const workflow = buildComfyWorkflow(prompt, width, height);

  // Queue the prompt
  const queueRes = await axios.post(`${COMFYUI_URL}/prompt`, workflow, { timeout: 15_000 });
  const promptId = queueRes.data?.prompt_id as string;
  if (!promptId) throw new Error("ComfyUI did not return prompt_id");

  // Poll until complete
  const startTime = Date.now();
  const timeout = 300_000;

  while (Date.now() - startTime < timeout) {
    await new Promise((r) => setTimeout(r, 2000));
    const historyRes = await axios.get(`${COMFYUI_URL}/history/${promptId}`, { timeout: 5_000 });
    const history = historyRes.data?.[promptId];

    if (history?.outputs) {
      // Get image from SaveImage node output
      const nodeOutput = Object.values(history.outputs as Record<string, any>)[0];
      const imageInfo = nodeOutput?.images?.[0];
      if (imageInfo) {
        const imgRes = await axios.get(
          `${COMFYUI_URL}/view?filename=${imageInfo.filename}&subfolder=${imageInfo.subfolder || ""}&type=output`,
          { timeout: 30_000, responseType: "arraybuffer" }
        );
        const base64 = Buffer.from(imgRes.data as ArrayBuffer).toString("base64");
        return base64;
      }
    }
  }

  throw new Error("ComfyUI generation timed out");
}

// ──────────────────────────────────────────────────────────────────────────────
// Fallback: AI description + SVG gradient placeholder
// ──────────────────────────────────────────────────────────────────────────────

const GRADIENT_SETS = [
  ["#6366f1", "#8b5cf6", "#ec4899"],
  ["#0ea5e9", "#6366f1", "#8b5cf6"],
  ["#10b981", "#0ea5e9", "#6366f1"],
  ["#f59e0b", "#ef4444", "#8b5cf6"],
  ["#ec4899", "#f59e0b", "#10b981"],
];

async function descriptionFallback(prompt: string, originalRequest: string): Promise<{ description: string; svg: string }> {
  let description = "";
  try {
    const response = await axios.post(
      `${ollamaBaseUrl}/api/generate`,
      {
        model: textModel,
        prompt: `You are a visionary artist describing an image you just painted.
The image depicts: "${prompt}"

Describe this image in rich, vivid, sensory detail — every color, texture, mood, light source, and compositional element.
Write as though describing a masterpiece to someone who cannot see. Be poetic and specific.`,
        stream: false,
      },
      { timeout: 60_000 }
    );
    description = (response.data?.response as string || "").trim();
  } catch {
    description = `A vivid, detailed image of: ${originalRequest}`;
  }

  const colors = GRADIENT_SETS[Math.floor(Math.random() * GRADIENT_SETS.length)];
  const shortPrompt = originalRequest.slice(0, 55) + (originalRequest.length > 55 ? "..." : "");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="512" viewBox="0 0 768 512">
  <defs>
    <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colors[0]}" stop-opacity="1"/>
      <stop offset="50%" stop-color="${colors[1]}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${colors[2]}" stop-opacity="1"/>
    </linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="40"/></filter>
  </defs>
  <rect width="768" height="512" fill="url(#g1)" rx="16"/>
  <ellipse cx="200" cy="150" rx="200" ry="150" fill="${colors[2]}" opacity="0.3" filter="url(#blur)"/>
  <ellipse cx="600" cy="380" rx="180" ry="130" fill="${colors[0]}" opacity="0.3" filter="url(#blur)"/>
  <text x="384" y="190" font-family="system-ui,sans-serif" font-size="22" fill="white" text-anchor="middle" opacity="0.95" font-weight="600">✨ Image Generation Preview</text>
  <text x="384" y="235" font-family="system-ui,sans-serif" font-size="15" fill="white" text-anchor="middle" opacity="0.8">"${shortPrompt}"</text>
  <rect x="154" y="290" width="460" height="1" fill="white" opacity="0.2"/>
  <text x="384" y="325" font-family="system-ui,sans-serif" font-size="12" fill="white" text-anchor="middle" opacity="0.55">Set STABLE_DIFFUSION_URL or COMFYUI_URL in .env for real generation</text>
  <text x="384" y="350" font-family="system-ui,sans-serif" font-size="11" fill="white" text-anchor="middle" opacity="0.4">AUTOMATIC1111 · ComfyUI · Auto-detected at runtime</text>
</svg>`;

  return { description, svg };
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export async function runImageGenTool(
  userPrompt: string,
  width = 768,
  height = 512
): Promise<ImageGenResult> {
  console.log(`[ImageGen] Request: "${userPrompt.slice(0, 80)}"`);

  const enhancedPrompt = await enhancePrompt(userPrompt);
  console.log(`[ImageGen] Enhanced: "${enhancedPrompt.slice(0, 80)}"`);

  const backend = await detectAvailableBackend();
  console.log(`[ImageGen] Backend detected: ${backend || "none (fallback)"}`);

  try {
    if (backend === "auto1111") {
      const imageBase64 = await generateWithA1111(enhancedPrompt, width, height);
      return {
        backend: "auto1111",
        imageBase64,
        description: `Generated via AUTOMATIC1111: "${userPrompt}"`,
        prompt: userPrompt,
        enhancedPrompt,
        width,
        height,
      };
    }

    if (backend === "comfyui") {
      const imageBase64 = await generateWithComfyUI(enhancedPrompt, width, height);
      return {
        backend: "comfyui",
        imageBase64,
        description: `Generated via ComfyUI: "${userPrompt}"`,
        prompt: userPrompt,
        enhancedPrompt,
        width,
        height,
      };
    }
  } catch (err: any) {
    console.warn(`[ImageGen] ${backend} generation failed: ${err?.message}. Using fallback.`);
  }

  // Description fallback
  const { description, svg } = await descriptionFallback(enhancedPrompt, userPrompt);
  return {
    backend: "description",
    description,
    prompt: userPrompt,
    enhancedPrompt,
    svgPlaceholder: svg,
    width,
    height,
  };
}
