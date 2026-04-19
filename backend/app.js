require("dotenv").config();
const express = require("express");
const cors = require("cors");
const webhookRoutes = require("./routes/webhook");
const authRoutes = require("./routes/auth");
const expensesRoutes = require("./routes/expenses");
const vendorsRoutes = require("./routes/vendors");
const cron = require("node-cron");
const app = express();

app.use(
    cors({
        origin: ["http://localhost:3001", process.env.FRONTEND_URL].filter(
            Boolean
        ),
        credentials: true,
    })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount routes at both /api/* (for Digital Ocean) and /* (for local dev)
app.use("/api/webhook", webhookRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/expenses", expensesRoutes);
app.use("/api/vendors", vendorsRoutes);

app.use("/webhook", webhookRoutes);
app.use("/auth", authRoutes);
app.use("/expenses", expensesRoutes);
app.use("/vendors", vendorsRoutes);

app.get("/", (req, res) => {
    res.json({
        message: "Server is running",
        timestamp: new Date().toISOString(),
    });
});

app.get("/api", (req, res) => {
    res.json({
        message: "Server is running",
        timestamp: new Date().toISOString(),
    });
});

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        message: "Server is up and running",
    });
});

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        message: "Server is up and running",
    });
});

app.get("/api/keep-alive", (req, res) => {
    res.json({
        status: "alive",
        timestamp: new Date().toISOString(),
        message: "Keep-alive ping successful",
    });
});

app.get("/keep-alive", (req, res) => {
    res.json({
        status: "alive",
        timestamp: new Date().toISOString(),
        message: "Keep-alive ping successful",
    });
});

if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_KEEP_ALIVE === "true"
) {
    const serverUrl = process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL;

    if (serverUrl) {
        cron.schedule("*/5 * * * *", async () => {
            try {
                const fetch = (await import("node-fetch")).default;
                const response = await fetch(`${serverUrl}/keep-alive`);
                const data = await response.json();
            } catch (error) {
                console.error(
                    `Keep-alive ping failed at ${new Date().toISOString()}:`,
                    error.message
                );
            }
        });

        console.log(
            `Keep-alive cron job scheduled for ${serverUrl}/keep-alive (every 40 minutes)`
        );
    } else {
        console.log("Keep-alive disabled: SERVER_URL not configured");
    }
} else {
    console.log("Keep-alive disabled in development mode");
}

const DailySalesService = require("./utils/dailySales");

// ─── 8:30 PM IST Cash Collection Cron Job ───
// Runs every day at 8:30 PM IST (15:00 UTC) to ask users for daily cash collection
cron.schedule(
    "30 20 * * *",
    async () => {
        console.log(
            `💰 Cash collection cron triggered at ${new Date().toISOString()}`
        );
        try {
            await DailySalesService.sendCashCollectionPrompts();
        } catch (error) {
            console.error("Cash collection cron error:", error.message);
        }
    },
    {
        timezone: "Asia/Kolkata",
    }
);

console.log("⏰ Cash collection cron scheduled for 8:30 PM IST daily");

app.listen(process.env.PORT, () => {
    console.log(`Server is running on port ${process.env.PORT}`);
});
