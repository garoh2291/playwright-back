// import express, { Request, Response } from "express";
// import { chromium, Page } from "playwright";
// import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
// import dotenv from "dotenv";
// import cors from "cors";

// dotenv.config();

// const app = express();
// const PORT = 3002;

// const s3Client = new S3Client({ region: process.env.AWS_REGION });

// app.use(express.json());
// app.use(
//   cors({
//     origin: "*",
//     methods: ["GET", "POST"],
//     allowedHeaders: ["Content-Type", "Authorization"],
//   })
// );

// const ELEMENTS_TO_REMOVE = [
//   '[class*="cookie"]',
//   '[id*="cookie"]',
//   '[class*="consent"]',
//   '[class*="ad-"]',
//   '[id*="ad-"]',
//   '[class*="advertisement"]',
//   '[class*="popup"]',
//   '[class*="modal"]',
//   '[class*="overlay"]',
//   '[class*="newsletter"]',
//   '[class*="subscribe"]',
//   '[class*="social-"]',
//   ".share-buttons",
// ];

// const removeDistractions = async (page: Page): Promise<void> => {
//   for (const selector of ELEMENTS_TO_REMOVE) {
//     await page.evaluate((sel: string) => {
//       document.querySelectorAll(sel).forEach((el) => el.remove());
//     }, selector);
//   }
// };

// app.post("/screenshot", async (req: Request, res: Response): Promise<void> => {
//   const { url, stage, waitForSelector, customTimeout } = req.body;

//   const bucketName =
//     stage === "production"
//       ? process.env.AWS_BUCKET_NAME_PRODUCTION
//       : process.env.AWS_BUCKET_NAME;

//   if (!url || typeof url !== "string") {
//     res.status(400).json({ error: "URL is required and must be a string." });
//     return;
//   }

//   try {
//     const browser = await chromium.launch({
//       headless: true,
//       args: [
//         "--no-sandbox",
//         "--disable-setuid-sandbox",
//         "--disable-dev-shm-usage",
//         "--disable-gpu",
//         "--window-size=1280,720",
//         "--disable-web-security",
//         "--disable-features=IsolateOrigins,site-per-process",
//       ],
//     });

//     const context = await browser.newContext({
//       viewport: { width: 1280, height: 720 },
//       userAgent:
//         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
//       deviceScaleFactor: 1,
//       bypassCSP: true,
//       javaScriptEnabled: true,
//       hasTouch: false,
//       locale: "en-US",
//       timezoneId: "America/New_York",
//       permissions: ["geolocation"],
//       extraHTTPHeaders: {
//         "Accept-Language": "en-US,en;q=0.9",
//         Accept:
//           "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
//         "Accept-Encoding": "gzip, deflate, br",
//         Connection: "keep-alive",
//         "Cache-Control": "no-cache",
//       },
//     });

//     const page = await context.newPage();

//     await page.route("**/*", async (route) => {
//       const request = route.request();
//       const resourceType = request.resourceType();

//       if (
//         request
//           .url()
//           .match(/google-analytics|doubleclick|adsense|facebook|analytics/i)
//       ) {
//         await route.abort();
//         return;
//       }

//       if (["image", "stylesheet", "font"].includes(resourceType)) {
//         if (request.url().includes("ad") || request.url().includes("track")) {
//           await route.abort();
//         } else {
//           await route.continue();
//         }
//       } else if (resourceType === "script") {
//         if (
//           request.url().includes("ads") ||
//           request.url().includes("analytics")
//         ) {
//           await route.abort();
//         } else {
//           await route.continue();
//         }
//       } else {
//         await route.continue();
//       }
//     });

//     await page.addInitScript(() => {
//       Object.defineProperty(navigator, "webdriver", { get: () => undefined });
//       Object.defineProperty(navigator, "plugins", {
//         get: () => [1, 2, 3, 4, 5],
//       });
//       Object.defineProperty(navigator, "languages", {
//         get: () => ["en-US", "en"],
//       });

//       const originalFunction = HTMLCanvasElement.prototype.toDataURL;
//       HTMLCanvasElement.prototype.toDataURL = function (type?: string) {
//         if (type === "image/png" && this.width === 220 && this.height === 30) {
//           return originalFunction.call(this, type);
//         }
//         return originalFunction.call(this, type);
//       };
//     });

//     const timeout = customTimeout || 30000;

//     await page.goto(url, {
//       waitUntil: "commit",
//       timeout: timeout,
//     });

//     // More granular waiting strategy
//     try {
//       await Promise.all([
//         page.waitForLoadState("load", { timeout: timeout / 2 }),
//         page.waitForLoadState("domcontentloaded", { timeout: timeout / 2 }),
//       ]);
//     } catch (e) {
//       console.log("Initial load states timeout, continuing anyway");
//     }

//     // Wait for any dynamic content
//     try {
//       await page.waitForFunction(
//         () => {
//           const bodyLength = document.body.innerHTML.length;
//           return bodyLength > 100;
//         },
//         { timeout: timeout / 2 }
//       );
//     } catch (e) {
//       console.log("Content length check timeout, continuing anyway");
//     }

//     await removeDistractions(page);

//     // Wait for network to be idle
//     try {
//       await page.waitForLoadState("networkidle", { timeout: timeout / 2 });
//     } catch (e) {
//       console.log("Network idle timeout, continuing anyway");
//     }

//     // Final delay for any remaining dynamic content
//     await page.waitForTimeout(3000);

//     const screenshotBuffer = await page.screenshot({
//       fullPage: true,
//       type: "png",
//       timeout: timeout,
//       scale: "device",
//     });

//     await browser.close();

//     const fileName = `screenshot-${Date.now()}.png`;
//     const folder = "link-preview";
//     const filePath = `${folder}/${fileName}`;

//     await s3Client.send(
//       new PutObjectCommand({
//         Bucket: bucketName!,
//         Key: filePath,
//         Body: screenshotBuffer,
//         ContentType: "image/png",
//         CacheControl: "public, max-age=31536000",
//       })
//     );

//     const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${filePath}`;

//     res.json({
//       message: "Screenshot saved successfully",
//       fileUrl,
//     });
//   } catch (error) {
//     console.error("Screenshot error:", error);
//     res.status(500).json({
//       error: "Screenshot failed",
//       details: error instanceof Error ? error.message : "Unknown error",
//     });
//   }
// });

// app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
// });

import express, { Request, Response } from "express";
import { chromium, Page } from "playwright";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = 3002;
const MAX_WIDTH = 1200; // Safe maximum width

const s3Client = new S3Client({ region: process.env.AWS_REGION });

app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const handleCookieConsent = async (page: Page): Promise<void> => {
  const maxAttempts = 3;
  const waitBetweenAttempts = 1000;

  const selectors = [
    // Specific selectors
    "#onetrust-accept-btn-handler",
    "#onetrust-button-group",
    // Generic buttons
    'button[id*="accept"]',
    'button[class*="accept"]',
    'button[id*="cookie"]',
    'button[class*="cookie"]',
    // Text-based selectors
    'button:has-text("Accept")',
    'button:has-text("OK")',
    'button:has-text("Got it")',
    // Additional selectors for modals
    '[aria-label*="cookie"]',
    '[aria-label*="consent"]',
    '[role="dialog"] button:has-text(/Accept|OK|I agree/i)',
    // Fallback selectors
    'div[id*="cookie"] button',
    'div[class*="cookie"] button',
    'div[id*="consent"] button',
    'div[class*="consent"] button',
  ];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 2000 });
        await page.click(selector);
        await page.waitForTimeout(500);
      } catch (e) {
        continue;
      }
    }
    await page.waitForTimeout(waitBetweenAttempts);
  }

  // Force remove any remaining overlays
  await page.evaluate(() => {
    document
      .querySelectorAll(
        '[class*="overlay"], [class*="modal"], [class*="popup"]'
      )
      .forEach((el) => ((el as HTMLElement).style.display = "none"));
  });
};

const ELEMENTS_TO_REMOVE = [
  '[id*="banner"]', // Added to catch all banner IDs
  '[class*="banner"]',
  '[class*="cookie"]',
  '[id*="cookie"]',
  '[class*="consent"]',
  '[class*="ad-"]',
  '[id*="ad-"]',
  '[class*="advertisement"]',
  '[class*="popup"]',
  '[class*="modal"]',
  '[class*="overlay"]',
  '[class*="newsletter"]',
  '[class*="subscribe"]',
  '[class*="social-"]',
  ".share-buttons",
];

const removeDistractions = async (page: Page): Promise<void> => {
  for (const selector of ELEMENTS_TO_REMOVE) {
    await page.evaluate((sel: string) => {
      document.querySelectorAll(sel).forEach((el) => el.remove());
    }, selector);
  }
};

const handleImageErrors = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const images = document.getElementsByTagName("img");
    for (let img of images) {
      img.onerror = function () {
        this.style.display = "none";
      };
      if (!img.complete || !img.naturalWidth) {
        img.style.display = "none";
      }
    }
  });
};

const adjustLayout = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.documentElement.style.maxWidth = "1280px";
    document.documentElement.style.width = "1280px";
    document.body.style.maxWidth = "1280px";
    document.body.style.width = "1280px";

    // Handle broken images
    const images = document.getElementsByTagName("img");
    for (const img of images) {
      if (!img.complete || !img.naturalWidth || img.naturalWidth > 1280) {
        img.style.maxWidth = "1280px";
        img.style.width = "auto";
        img.style.height = "auto";
      }
    }

    // Fix oversized elements
    const elements = document.querySelectorAll("*");
    elements.forEach((el) => {
      const style = window.getComputedStyle(el);
      const width = parseFloat(style.width);
      if (width > 1280 || style.width.includes("%")) {
        (el as HTMLElement).style.maxWidth = "1280px";
        (el as HTMLElement).style.width = "100%";
      }
    });
  });
};

app.post("/screenshot", async (req: Request, res: Response): Promise<void> => {
  const { url, stage, waitForSelector, customTimeout } = req.body;

  const bucketName =
    stage === "production"
      ? process.env.AWS_BUCKET_NAME_PRODUCTION
      : process.env.AWS_BUCKET_NAME;

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "URL is required and must be a string." });
    return;
  }

  try {
    const browser = await chromium.launch({
      headless: false,
      args: [
        "--disable-dev-shm-usage",
        "--disable-setuid-sandbox",
        "--no-first-run",
        "--window-size=1280,720",
        "--disable-blink-features=AutomationControlled",
      ],
      ignoreDefaultArgs: ["--mute-audio"],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      deviceScaleFactor: 1,
      javaScriptEnabled: true,
      hasTouch: false,
      isMobile: false,
      permissions: ["geolocation"],
    });

    const page = await context.newPage();

    // Block only analytics and ads
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

    const timeout = customTimeout || 30000;

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeout,
    });

    try {
      await Promise.all([
        page.waitForLoadState("load", { timeout: 15000 }),
        page.waitForLoadState("domcontentloaded", { timeout: 15000 }),
      ]);
    } catch (e) {
      console.log("Initial load timeout, continuing");
    }

    // Handle images and layout
    await page.waitForTimeout(2000);
    await handleImageErrors(page);
    await adjustLayout(page);
    await handleCookieConsent(page);
    // await removeDistractions(page);

    await page.waitForTimeout(3000);

    const screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: "png",
      timeout: timeout,
      scale: "device",
    });

    await browser.close();

    const fileName = `screenshot-${Date.now()}.png`;
    const folder = "link-preview";
    const filePath = `${folder}/${fileName}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName!,
        Key: filePath,
        Body: screenshotBuffer,
        ContentType: "image/png",
        CacheControl: "public, max-age=31536000",
      })
    );

    const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${filePath}`;

    res.json({
      message: "Screenshot saved successfully",
      fileUrl,
    });
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
