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
const bucketName = process.env.AWS_BUCKET_NAME;

// Middleware to parse JSON request bodies
app.use(express.json());
app.use(
  cors({
    origin: "*", // Allow all origins; restrict this to specific origins in production
    methods: ["GET", "POST"], // Allowed HTTP methods
    allowedHeaders: ["Content-Type", "Authorization"], // Allowed headers
  })
);

// POST route to take a screenshot
app.post("/screenshot", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body;

  if (!url || typeof url !== "string") {
    res.status(400).json({
      error: "URL is required in the request body and must be a string.",
    });
    return;
  }

  try {
    // Launch Playwright browser
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to the given URL
    await page.goto(url);

    // Take a screenshot
    const screenshotBuffer = await page.screenshot({ fullPage: true });

    // Close the browser
    await browser.close();

    // Generate a unique file name for S3
    const fileName = `screenshot-${Date.now()}.png`;
    const folder = "link-preview";
    const filePath = `${folder}/${fileName}`; // Save in folder "link-preview"

    // Upload the screenshot to S3
    const uploadParams = {
      Bucket: bucketName!,
      Key: filePath, // Include folder name in the Key
      Body: screenshotBuffer,
      ContentType: "image/png",
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    // Generate the public URL of the uploaded file (if the bucket allows public access)
    const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${filePath}`;

    // Respond with the file URL
    res.json({
      message: "Screenshot saved successfully to S3 in /link-preview folder",
      fileUrl,
    });
  } catch (error) {
    console.error("Error taking screenshot or uploading to S3:", error);
    res
      .status(500)
      .json({ error: "Failed to take screenshot or upload to S3" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
