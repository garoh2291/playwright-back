import express, { Request, Response } from "express";
import { chromium, Page } from "playwright";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import cors from "cors";
import axios from "axios";

dotenv.config();

const app = express();
const PORT = 3002;
const MAX_WIDTH = 1200;

const s3Client = new S3Client({ region: process.env.AWS_REGION });

app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Keep all existing helper functions the same...
const handleCookieConsent = async (page: Page): Promise<void> => {
  const selectors = [
    "#onetrust-accept-btn-handler",
    'button:has-text("Accept")',
    'button:has-text("OK")',
    'button:has-text("Got it")',
    '[role="dialog"] button:has-text(/Accept|OK|I agree/i)',
  ];

  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: 1000 });
      await page.click(selector);
      break;
    } catch (e) {
      continue;
    }
  }

  await page.evaluate(() => {
    document
      .querySelectorAll(
        '[class*="overlay"], [class*="modal"], [class*="popup"]'
      )
      .forEach((el) => ((el as HTMLElement).style.display = "none"));
  });
};

const ELEMENTS_TO_REMOVE = [
  '[class*="cookie"]',
  '[class*="ad-"]',
  '[class*="popup"]',
  '[class*="modal"]',
  '[class*="overlay"]',
  '[class*="newsletter"]',
];

const removeDistractions = async (page: Page): Promise<void> => {
  await page.evaluate((selectors: string[]) => {
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => el.remove());
    });
  }, ELEMENTS_TO_REMOVE);
};

const optimizeLayout = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.documentElement.style.maxWidth = "1280px";
    document.body.style.maxWidth = "1280px";

    document.querySelectorAll("img").forEach((img) => {
      if (!img.complete || !img.naturalWidth || img.naturalWidth > 1280) {
        img.style.maxWidth = "1280px";
        img.style.height = "auto";
      }
      img.onerror = () => (img.style.display = "none");
    });

    document.querySelectorAll("*").forEach((el) => {
      const width = el.getBoundingClientRect().width;
      if (width > 1280) {
        (el as HTMLElement).style.maxWidth = "1280px";
        (el as HTMLElement).style.width = "100%";
      }
    });
  });
};

app.post("/screenshot", async (req: Request, res: Response): Promise<void> => {
  const { url, stage, sourceId, callbackUrl, customTimeout = 2000 } = req.body;

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "URL is required and must be a string." });
    return;
  }

  if (!sourceId) {
    res.status(400).json({ error: "sourceId is required." });
    return;
  }

  const bucketName =
    stage === "production"
      ? process.env.AWS_BUCKET_NAME_PRODUCTION
      : process.env.AWS_BUCKET_NAME;

  try {
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-dev-shm-usage",
        "--disable-setuid-sandbox",
        "--window-size=1280,720",
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      deviceScaleFactor: 1,
    });

    const page = await context.newPage();

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        request
          .url()
          .match(/google-analytics|doubleclick|adsense|facebook|analytics/i)
      ) {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: customTimeout,
    });

    await Promise.all([
      optimizeLayout(page),
      handleCookieConsent(page),
      removeDistractions(page),
    ]);

    await page.waitForTimeout(1000);

    const screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: "png",
      timeout: customTimeout,
    });

    await browser.close();

    const fileName = `screenshot-${Date.now()}.png`;
    const filePath = `link-preview/${fileName}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName!,
        Key: filePath,
        Body: screenshotBuffer,
        ContentType: "image/png",
        CacheControl: "public, max-age=31536000",
      })
    );

    const previewUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${filePath}`;

    await axios.post(`${callbackUrl}/api/sources/updateSourcePreview`, {
      sourceId,
      previewUrl,
    });

    res.status(200).send();
  } catch (error) {
    console.error("Screenshot error:", error);
    res.status(500).json({
      error: "Screenshot failed",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
