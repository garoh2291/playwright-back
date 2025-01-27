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
const axios_1 = __importDefault(require("axios"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = 3002;
const MAX_WIDTH = 1200;
const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
app.use(express_1.default.json());
app.use((0, cors_1.default)({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
// Keep all existing helper functions the same...
const handleCookieConsent = (page) => __awaiter(void 0, void 0, void 0, function* () {
    const selectors = [
        "#onetrust-accept-btn-handler",
        'button:has-text("Accept")',
        'button:has-text("OK")',
        'button:has-text("Got it")',
        '[role="dialog"] button:has-text(/Accept|OK|I agree/i)',
    ];
    for (const selector of selectors) {
        try {
            yield page.waitForSelector(selector, { timeout: 1000 });
            yield page.click(selector);
            break;
        }
        catch (e) {
            continue;
        }
    }
    yield page.evaluate(() => {
        document
            .querySelectorAll('[class*="overlay"], [class*="modal"], [class*="popup"]')
            .forEach((el) => (el.style.display = "none"));
    });
});
const ELEMENTS_TO_REMOVE = [
    '[class*="cookie"]',
    '[class*="ad-"]',
    '[class*="popup"]',
    '[class*="modal"]',
    '[class*="overlay"]',
    '[class*="newsletter"]',
];
const removeDistractions = (page) => __awaiter(void 0, void 0, void 0, function* () {
    yield page.evaluate((selectors) => {
        selectors.forEach((sel) => {
            document.querySelectorAll(sel).forEach((el) => el.remove());
        });
    }, ELEMENTS_TO_REMOVE);
});
const optimizeLayout = (page) => __awaiter(void 0, void 0, void 0, function* () {
    yield page.evaluate(() => {
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
                el.style.maxWidth = "1280px";
                el.style.width = "100%";
            }
        });
    });
});
app.post("/screenshot", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { url, stage, sourceId, customTimeout = 2000 } = req.body;
    if (!url || typeof url !== "string") {
        res.status(400).json({ error: "URL is required and must be a string." });
        return;
    }
    if (!sourceId) {
        res.status(400).json({ error: "sourceId is required." });
        return;
    }
    const bucketName = stage === "production"
        ? process.env.AWS_BUCKET_NAME_PRODUCTION
        : process.env.AWS_BUCKET_NAME;
    try {
        const browser = yield playwright_1.chromium.launch({
            headless: true,
            args: [
                "--disable-dev-shm-usage",
                "--disable-setuid-sandbox",
                "--window-size=1280,720",
            ],
        });
        const context = yield browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            deviceScaleFactor: 1,
        });
        const page = yield context.newPage();
        yield page.route("**/*", (route) => __awaiter(void 0, void 0, void 0, function* () {
            const request = route.request();
            if (request
                .url()
                .match(/google-analytics|doubleclick|adsense|facebook|analytics/i)) {
                yield route.abort();
            }
            else {
                yield route.continue();
            }
        }));
        yield page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: customTimeout,
        });
        yield Promise.all([
            optimizeLayout(page),
            handleCookieConsent(page),
            removeDistractions(page),
        ]);
        yield page.waitForTimeout(1000);
        const screenshotBuffer = yield page.screenshot({
            fullPage: true,
            type: "png",
            timeout: customTimeout,
        });
        yield browser.close();
        const fileName = `screenshot-${Date.now()}.png`;
        const filePath = `link-preview/${fileName}`;
        yield s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: bucketName,
            Key: filePath,
            Body: screenshotBuffer,
            ContentType: "image/png",
            CacheControl: "public, max-age=31536000",
        }));
        const previewUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${filePath}`;
        yield axios_1.default.post("http://localhost:3001/api/sources/updateSourcePreview", {
            sourceId,
            previewUrl,
        });
        res.status(200).send();
    }
    catch (error) {
        console.error("Screenshot error:", error);
        res.status(500).json({
            error: "Screenshot failed",
            details: error instanceof Error ? error.message : "Unknown error",
        });
    }
}));
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
