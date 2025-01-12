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
// Middleware to parse JSON request bodies
app.use(express_1.default.json());
app.use((0, cors_1.default)({
    origin: "*", // Allow all origins; restrict this to specific origins in production
    methods: ["GET", "POST"], // Allowed HTTP methods
    allowedHeaders: ["Content-Type", "Authorization"], // Allowed headers
}));
// POST route to take a screenshot
app.post("/screenshot", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { url, stage } = req.body;
    console.log("url", url, process.env.AWS_BUCKET_NAME_PRODUCTION, process.env.AWS_BUCKET_NAME, process.env.AWS_REGION);
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
        // Launch Playwright browser
        const browser = yield playwright_1.chromium.launch({ headless: true });
        const context = yield browser.newContext();
        const page = yield context.newPage();
        // Navigate to the given URL
        yield page.goto(url, { waitUntil: "load" });
        // Take a screenshot
        const screenshotBuffer = yield page.screenshot({ fullPage: true });
        // Close the browser
        yield browser.close();
        // Generate a unique file name for S3
        const fileName = `screenshot-${Date.now()}.png`;
        const folder = "link-preview";
        const filePath = `${folder}/${fileName}`; // Save in folder "link-preview"
        // Upload the screenshot to S3
        const uploadParams = {
            Bucket: bucketName,
            Key: filePath, // Include folder name in the Key
            Body: screenshotBuffer,
            ContentType: "image/png",
        };
        yield s3Client.send(new client_s3_1.PutObjectCommand(uploadParams));
        // Generate the public URL of the uploaded file (if the bucket allows public access)
        const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${filePath}`;
        // Respond with the file URL
        res.json({
            message: "Screenshot saved successfully to S3 in /link-preview folder",
            fileUrl,
        });
    }
    catch (error) {
        console.error("Error taking screenshot or uploading to S3:", error);
        res
            .status(500)
            .json({ error: "Failed to take screenshot or upload to S3" });
    }
}));
// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
