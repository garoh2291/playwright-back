"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const playwright_1 = require("playwright");
const client_s3_1 = require("@aws-sdk/client-s3");
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = 3002;
// AWS S3 Configuration
const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
app.use(express_1.default.json());
app.use((0, cors_1.default)({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.post("/screenshot", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { url, stage } = req.body;
    const bucketName = stage === "production"
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
        const browser = yield playwright_1.chromium.launch({
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
        const context = yield browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
            locale: "en-US",
            timezoneId: "America/New_York",
            permissions: ["geolocation"],
            // Add common headers that regular browsers send
            extraHTTPHeaders: {
                "Accept-Language": "en-US,en;q=0.9",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
                Connection: "keep-alive",
            },
        });
        const page = yield context.newPage();
        // Intercept and handle specific types of requests
        yield page.route("**/*", (route) => __awaiter(void 0, void 0, void 0, function* () {
            const request = route.request();
            // Skip unnecessary resources to improve performance
            if (["image", "stylesheet", "font"].includes(request.resourceType())) {
                yield route.continue();
            }
            else if (request.url().includes("captcha") ||
                request.url().includes("challenge")) {
                // Handle potential captcha/challenge pages
                yield route.abort();
            }
            else {
                yield route.continue();
            }
        }));
        // Add common browser fingerprints
        yield page.addInitScript(() => {
            Object.defineProperty(navigator, "webdriver", { get: () => undefined });
            Object.defineProperty(navigator, "plugins", {
                get: () => [1, 2, 3, 4, 5],
            });
            Object.defineProperty(navigator, "languages", {
                get: () => ["en-US", "en"],
            });
        });
        // Navigate with extended timeout and options
        yield page.goto(url, {
            waitUntil: "networkidle",
            timeout: 30000,
        });
        // Wait for the main content to load
        yield page.waitForLoadState("domcontentloaded");
        yield page.waitForTimeout(2000); // Additional wait to ensure dynamic content loads
        // Take screenshot with specific options
        const screenshotBuffer = yield page.screenshot({
            fullPage: true,
            type: "png",
            quality: 100,
            timeout: 30000,
        });
        yield browser.close();
        // Generate unique file name and path
        const fileName = `screenshot-${Date.now()}.png`;
        const folder = "link-preview";
        const filePath = `${folder}/${fileName}`;
        // Upload to S3
        const uploadParams = {
            Bucket: bucketName,
            Key: filePath,
            Body: screenshotBuffer,
            ContentType: "image/png",
        };
        yield s3Client.send(new client_s3_1.PutObjectCommand(uploadParams));
        const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${filePath}`;
        res.json({
            message: "Screenshot saved successfully to S3 in /link-preview folder",
            fileUrl,
        });
    }
    catch (error) {
        console.error("Error taking screenshot or uploading to S3:", error);
        res.status(500).json({
            error: "Failed to take screenshot or upload to S3",
            details: error instanceof Error ? error.message : "Unknown error",
        });
    }
}));
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
