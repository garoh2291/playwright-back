import express, { Request, Response } from "express";
import { chromium } from "playwright";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = 3002;

// AWS S3 Configuration
const s3Client = new S3Client({ region: process.env.AWS_REGION });

app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.post("/screenshot", async (req: Request, res: Response): Promise<void> => {
  const { url, stage } = req.body;

  const bucketName =
    stage === "production"
      ? process.env.AWS_BUCKET_NAME_PRODUCTION
      : process.env.AWS_BUCKET_NAME;

  if (!url || typeof url !== "string") {
    res.status(400).json({
      error: "URL is required in the request body and must be a string.",
    });
    return;
  }

  try {
    // Enhanced browser launch configuration
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--window-size=1920,1080",
      ],
    });

    // Create a context with specific device and user agent
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      locale: "en-US",
      timezoneId: "America/New_York",
      permissions: ["geolocation"],
      // Add common headers that regular browsers send
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
      },
    });

    const page = await context.newPage();

    // Intercept and handle specific types of requests
    await page.route("**/*", async (route) => {
      const request = route.request();
      // Skip unnecessary resources to improve performance
      if (["image", "stylesheet", "font"].includes(request.resourceType())) {
        await route.continue();
      } else if (
        request.url().includes("captcha") ||
        request.url().includes("challenge")
      ) {
        // Handle potential captcha/challenge pages
        await route.abort();
      } else {
        await route.continue();
      }
    });

    // Add common browser fingerprints
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
    });

    // Navigate with extended timeout and options
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Wait for the main content to load
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000); // Additional wait to ensure dynamic content loads

    // Take screenshot with specific options
    const screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: "png",
      quality: 100,
      timeout: 30000,
    });

    await browser.close();

    // Generate unique file name and path
    const fileName = `screenshot-${Date.now()}.png`;
    const folder = "link-preview";
    const filePath = `${folder}/${fileName}`;

    // Upload to S3
    const uploadParams = {
      Bucket: bucketName!,
      Key: filePath,
      Body: screenshotBuffer,
      ContentType: "image/png",
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${filePath}`;

    res.json({
      message: "Screenshot saved successfully to S3 in /link-preview folder",
      fileUrl,
    });
  } catch (error) {
    console.error("Error taking screenshot or uploading to S3:", error);
    res.status(500).json({
      error: "Failed to take screenshot or upload to S3",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
