const axios = require("axios");
const cloudinary = require("../utils/cloudinary");
const { PrismaClient } = require("@prisma/client");
const { extractTextFromImage } = require("../utils/ocr");
const spendlyAgent = require("../utils/spendlyAgent");
const sendWhatsApp = require("../utils/twilioWhatsapp");

const prisma = new PrismaClient();

//using twilio api
const MessagingResponse = require("twilio").twiml.MessagingResponse;

const messageRateLimit = new Map();
const MAX_DAILY_MESSAGES = 100;
const DAILY_WINDOW = 24 * 60 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [key, data] of messageRateLimit.entries()) {
        if (now - data.lastReset > DAILY_WINDOW) {
            messageRateLimit.delete(key);
        }
    }
}, 60 * 60 * 1000);

function checkRateLimit(phoneNumber) {
    const now = Date.now();
    const key = phoneNumber;

    if (!messageRateLimit.has(key)) {
        messageRateLimit.set(key, {
            dailyCount: 0,
            lastReset: now,
            isBlocked: false,
        });
    }

    const data = messageRateLimit.get(key);

    if (now - data.lastReset > DAILY_WINDOW) {
        data.dailyCount = 0;
        data.lastReset = now;
        data.isBlocked = false;
    }

    if (data.isBlocked) {
        const resetHours = Math.ceil(
            (DAILY_WINDOW - (now - data.lastReset)) / (1000 * 60 * 60)
        );
        return {
            allowed: false,
            reason: "blocked",
            resetIn: DAILY_WINDOW - (now - data.lastReset),
            resetHours: resetHours,
            current: data.dailyCount,
            limit: MAX_DAILY_MESSAGES,
        };
    }

    if (data.dailyCount >= MAX_DAILY_MESSAGES) {
        data.isBlocked = true;
        messageRateLimit.set(key, data);

        const resetHours = Math.ceil(
            (DAILY_WINDOW - (now - data.lastReset)) / (1000 * 60 * 60)
        );
        return {
            allowed: false,
            reason: "daily_limit_exceeded",
            resetIn: DAILY_WINDOW - (now - data.lastReset),
            resetHours: resetHours,
            current: data.dailyCount,
            limit: MAX_DAILY_MESSAGES,
        };
    }

    data.dailyCount++;
    messageRateLimit.set(key, data);

    return {
        allowed: true,
        remaining: MAX_DAILY_MESSAGES - data.dailyCount,
        current: data.dailyCount,
        limit: MAX_DAILY_MESSAGES,
    };
}

module.exports = async (req, res) => {
    try {
        // Ignore Twilio status callbacks
        if (
            (req.body.MessageStatus && req.body.MessageStatus !== "received") ||
            (req.body.SmsStatus && req.body.SmsStatus !== "received") ||
            req.body.Payload
        ) {
            const twiml = new MessagingResponse();
            res.type("text/xml");
            return res.send(twiml.toString());
        }

        const from = req.body.From;
        const body = req.body.Body;
        const numMedia = parseInt(req.body.NumMedia) || 0;

        if (!from) {
            console.warn(
                "Twilio message payload malformed - missing From:",
                req.body
            );
            const twiml = new MessagingResponse();
            res.type("text/xml");
            return res.send(twiml.toString());
        }

        const phoneNumber = from.replace("whatsapp:", "");

        // Rate limiting
        const rateLimitCheck = checkRateLimit(phoneNumber);
        if (!rateLimitCheck.allowed) {
            const twiml = new MessagingResponse();
            let message;

            if (
                rateLimitCheck.reason === "daily_limit_exceeded" ||
                rateLimitCheck.reason === "blocked"
            ) {
                message = `🚫 *Daily Message Limit Exceeded*

You've used all *${rateLimitCheck.limit} messages* for today (${rateLimitCheck.current}/${rateLimitCheck.limit}).

Your number is now *blocked* for the next *${rateLimitCheck.resetHours} hours*.

🌐 *Continue tracking expenses:*
• Use our web dashboard for unlimited access
• Type "dashboard" for the link

⏰ *Reset:* Your limit will reset in ${rateLimitCheck.resetHours} hours.`;
            }

            twiml.message(message);
            res.type("text/xml");
            return res.send(twiml.toString());
        }

        // Rate limit warning (3 or fewer remaining)
        if (rateLimitCheck.remaining <= 3 && rateLimitCheck.remaining > 0) {
            const warningMessage = `⚠️ *Message Limit Warning*

You have *${rateLimitCheck.remaining} messages* remaining today (${rateLimitCheck.current}/${rateLimitCheck.limit} used).

💡 *Tip:* Use our web dashboard for unlimited access!`;

            sendWhatsApp(phoneNumber, warningMessage).catch((err) =>
                console.error("Failed to send warning message:", err)
            );
        }

        // Check if user exists, create if new
        let user = await prisma.user.findUnique({
            where: { id: phoneNumber },
        });

        let isFirstMessage = false;
        if (!user) {
            isFirstMessage = true;
            user = await prisma.user.create({
                data: {
                    id: phoneNumber,
                    phoneNumber: phoneNumber,
                    name: `User ${phoneNumber.slice(-4)}`,
                    isFirstTime: true,
                },
            });
        } else if (user.isFirstTime) {
            isFirstMessage = true;
            await prisma.user.update({
                where: { id: phoneNumber },
                data: { isFirstTime: false },
            });
        }

        // ─── Process through AI Agent ───
        let agentResponse;

        if (body && numMedia === 0) {
            // Text message → send to agent
            agentResponse = await spendlyAgent.processMessage(
                phoneNumber,
                body,
                isFirstMessage
            );
        } else if (numMedia > 0) {
            // Image message → download, upload to cloudinary, extract text, send to agent
            const mediaUrl = req.body.MediaUrl0;
            const mediaContentType = req.body.MediaContentType0;

            if (!mediaUrl || !mediaContentType.startsWith("image/")) {
                agentResponse =
                    "❌ Please send a clear image of your bill or receipt. I can extract all the details automatically! 📷";
            } else {
                try {
                    const imageResponse = await axios.get(mediaUrl, {
                        responseType: "arraybuffer",
                        auth: {
                            username: process.env.TWILIO_ACCOUNT_SID,
                            password: process.env.TWILIO_AUTH_TOKEN,
                        },
                    });

                    const buffer = Buffer.from(imageResponse.data);

                    // Upload to Cloudinary
                    const cloudinaryResult = await new Promise(
                        (resolve, reject) => {
                            const stream = cloudinary.uploader.upload_stream(
                                { folder: "whatsapp-expenses" },
                                (error, result) => {
                                    if (error) reject(error);
                                    else resolve(result);
                                }
                            );
                            stream.end(buffer);
                        }
                    );

                    // Try OCR extraction
                    let ocrText = "";
                    try {
                        ocrText = await extractTextFromImage(
                            cloudinaryResult.secure_url
                        );
                    } catch (ocrError) {
                        console.error("OCR failed:", ocrError.message);
                    }

                    // Process through agent
                    agentResponse = await spendlyAgent.processImageMessage(
                        phoneNumber,
                        cloudinaryResult.secure_url,
                        ocrText,
                        isFirstMessage
                    );
                } catch (error) {
                    console.error("Error processing image:", error);
                    agentResponse =
                        "❌ I had trouble processing that image. Could you try a clearer photo, or tell me the expense manually?";
                }
            }
        } else {
            // No text, no media — just greet
            agentResponse = await spendlyAgent.processMessage(
                phoneNumber,
                "hello",
                isFirstMessage
            );
        }

        // Send agent response via Twilio API (not TwiML, to avoid double-sending)
        if (agentResponse) {
            await sendWhatsApp(phoneNumber, agentResponse);
        }

        // Return empty TwiML (we already sent the response via API)
        const twiml = new MessagingResponse();
        res.type("text/xml");
        res.send(twiml.toString());
    } catch (err) {
        console.error("Server error:", err);
        const twiml = new MessagingResponse();
        res.type("text/xml");
        res.status(500).send(twiml.toString());
    }
};
