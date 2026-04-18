const twilio = require("twilio");
const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

async function sendWhatsApp(to, message) {
    try {
        const fromNumber = process.env.TWILIO_PHONE_NUMBER.startsWith("whatsapp:")
            ? process.env.TWILIO_PHONE_NUMBER
            : `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`;
        const toNumber = to.startsWith("whatsapp:")
            ? to
            : `whatsapp:${to}`;

        const createParams = {
            body: message,
            from: fromNumber,
            to: toNumber,
        };

        // Override Twilio account-level default of "none" with a valid URL
        const backendUrl = process.env.BACKEND_URL;
        if (backendUrl) {
            createParams.statusCallback = `${backendUrl}/webhook/status`;
        }

        const msg = await client.messages.create(createParams);
        console.log("Sent via Twilio:", msg.sid);
    } catch (err) {
        console.error("Twilio send failed:", err.message);
    }
}

module.exports = sendWhatsApp;
