import { test, expect } from "@playwright/test";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";

const s3Client = new S3Client({ region: process.env.AWS_REGION });

test("capture screenshot and upload", async ({ page }) => {
  const url = "https://alternativeto.net/software/teamviewer/";

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // Wait for content load
  await Promise.all([
    page.waitForLoadState("load", { timeout: 15000 }),
    page.waitForLoadState("domcontentloaded", { timeout: 15000 }),
  ]);

  // Remove distracting elements
  const distractingSelectors = [
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
  ];

  for (const selector of distractingSelectors) {
    await page.evaluate((sel) => {
      document.querySelectorAll(sel).forEach((el) => el.remove());
    }, selector);
  }

  // Fix layout width
  await page.evaluate(() => {
    document.documentElement.style.maxWidth = "1280px";
    document.documentElement.style.width = "1280px";
    document.body.style.maxWidth = "1280px";
    document.body.style.width = "1280px";

    document.querySelectorAll("*").forEach((el) => {
      const style = window.getComputedStyle(el);
      const width = parseFloat(style.width);
      if (width > 1280 || style.width.includes("%")) {
        (el as HTMLElement).style.maxWidth = "1280px";
        (el as HTMLElement).style.width = "100%";
      }
    });
  });

  await page.waitForTimeout(2000);

  // Take screenshot
  const screenshotBuffer = await page.screenshot({
    fullPage: true,
    type: "png",
  });

  // Save to public folder
  const publicDir = path.join(process.cwd(), "public");
  await fs.mkdir(publicDir, { recursive: true });
  const localPath = path.join(publicDir, `screenshot-${Date.now()}.png`);
  await fs.writeFile(localPath, screenshotBuffer);

  // Upload to S3
  const fileName = `screenshot-${Date.now()}.png`;
  const folder = "link-preview";
  const s3Path = `${folder}/${fileName}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME!,
      Key: s3Path,
      Body: screenshotBuffer,
      ContentType: "image/png",
      CacheControl: "public, max-age=31536000",
    })
  );

  // Verify screenshot was taken
  expect(await fs.stat(localPath)).toBeTruthy();
});
