const express = require("express");
const router = express.Router();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const rateLimit = require("express-rate-limit");

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: {
        error: "Too many requests from this IP, please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const exportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 2,
    message: {
        error: "Too many export requests, please try again in an hour.",
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// ─── Get all vendor payments ───
router.get("/", apiLimiter, async (req, res) => {
    try {
        const { phone, userId, vendor, period } = req.query;
        let userPhone = phone || userId;

        if (userPhone && userPhone.startsWith(" ")) {
            userPhone = "+" + userPhone.trim();
        }

        if (!userPhone) {
            return res
                .status(400)
                .json({ error: "Phone number or user ID required" });
        }

        const whereClause = { userId: userPhone };

        // Vendor name filter
        if (vendor) {
            whereClause.vendorName = {
                contains: vendor.trim(),
                mode: "insensitive",
            };
        }

        // Time period filter
        if (period) {
            const now = new Date();
            if (period === "today") {
                const startOfDay = new Date(now);
                startOfDay.setHours(0, 0, 0, 0);
                whereClause.date = { gte: startOfDay };
            } else if (period === "week") {
                const weekAgo = new Date(now);
                weekAgo.setDate(weekAgo.getDate() - 7);
                whereClause.date = { gte: weekAgo };
            } else if (period === "month") {
                const startOfMonth = new Date(
                    now.getFullYear(),
                    now.getMonth(),
                    1
                );
                whereClause.date = { gte: startOfMonth };
            }
        }

        const payments = await prisma.vendorPayment.findMany({
            where: whereClause,
            orderBy: { date: "desc" },
            take: 100,
        });

        const transformedPayments = payments.map((p) => ({
            id: p.id,
            vendorName: p.vendorName,
            amount: p.amount,
            date: p.date.toISOString(),
            refBillNo: p.refBillNo,
            paymentMode: p.paymentMode,
            notes: p.notes,
            status: p.status,
            createdAt: p.createdAt.toISOString(),
        }));

        return res.json(transformedPayments);
    } catch (error) {
        console.error("Get vendor payments error:", error);
        return res
            .status(500)
            .json({ error: "Failed to fetch vendor payments" });
    }
});

// ─── Get vendor payment stats (summary) ───
router.get("/stats", apiLimiter, async (req, res) => {
    try {
        let { phone } = req.query;

        if (phone && phone.startsWith(" ")) {
            phone = "+" + phone.trim();
        }

        if (!phone) {
            return res.status(400).json({ error: "Phone number required" });
        }

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(
            now.getFullYear(),
            now.getMonth() + 1,
            0,
            23,
            59,
            59,
            999
        );

        const monthlyPayments = await prisma.vendorPayment.findMany({
            where: {
                userId: phone,
                date: {
                    gte: startOfMonth,
                    lte: endOfMonth,
                },
            },
            orderBy: { date: "desc" },
        });

        const totalAmount = monthlyPayments.reduce(
            (sum, p) => sum + p.amount,
            0
        );
        const totalPayments = monthlyPayments.length;

        // Vendor-wise breakdown
        const vendors = {};
        monthlyPayments.forEach((p) => {
            vendors[p.vendorName] =
                (vendors[p.vendorName] || 0) + p.amount;
        });

        // Payment mode breakdown
        const paymentModes = {};
        monthlyPayments.forEach((p) => {
            const mode = p.paymentMode || "cash";
            paymentModes[mode] = (paymentModes[mode] || 0) + p.amount;
        });

        // Daily payments
        const dailyPayments = {};
        monthlyPayments.forEach((p) => {
            const date = p.date.toISOString().split("T")[0];
            dailyPayments[date] = (dailyPayments[date] || 0) + p.amount;
        });

        const dailyPaymentsArray = Object.entries(dailyPayments)
            .map(([date, amount]) => ({ date, amount }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        // Unique vendors count
        const uniqueVendors = new Set(
            monthlyPayments.map((p) => p.vendorName.toLowerCase())
        ).size;

        const stats = {
            totalAmount,
            totalPayments,
            uniqueVendors,
            vendors,
            paymentModes,
            dailyPayments: dailyPaymentsArray,
        };

        return res.json(stats);
    } catch (error) {
        console.error("Get vendor stats error:", error);
        return res
            .status(500)
            .json({ error: "Failed to fetch vendor stats" });
    }
});

// ─── Get ledger for a specific vendor ───
router.get("/ledger/:vendorName", apiLimiter, async (req, res) => {
    try {
        let { phone } = req.query;
        const { vendorName } = req.params;

        if (phone && phone.startsWith(" ")) {
            phone = "+" + phone.trim();
        }

        if (!phone) {
            return res.status(400).json({ error: "Phone number required" });
        }

        if (!vendorName) {
            return res.status(400).json({ error: "Vendor name required" });
        }

        const payments = await prisma.vendorPayment.findMany({
            where: {
                userId: phone,
                vendorName: {
                    contains: decodeURIComponent(vendorName).trim(),
                    mode: "insensitive",
                },
            },
            orderBy: { date: "asc" },
        });

        const total = payments.reduce((sum, p) => sum + p.amount, 0);

        // Build ledger with running balance
        let runningTotal = 0;
        const ledger = payments.map((p) => {
            runningTotal += p.amount;
            return {
                id: p.id,
                date: p.date.toISOString(),
                amount: p.amount,
                runningTotal: runningTotal,
                refBillNo: p.refBillNo,
                paymentMode: p.paymentMode,
                notes: p.notes,
            };
        });

        return res.json({
            vendorName:
                payments.length > 0
                    ? payments[0].vendorName
                    : decodeURIComponent(vendorName),
            totalPaid: total,
            transactionCount: payments.length,
            ledger: ledger,
        });
    } catch (error) {
        console.error("Get vendor ledger error:", error);
        return res
            .status(500)
            .json({ error: "Failed to fetch vendor ledger" });
    }
});

// ─── Export vendor payments ───
router.get("/export", exportLimiter, async (req, res) => {
    try {
        const { phone, userId, format = "csv" } = req.query;
        let userPhone = phone || userId;

        if (userPhone && userPhone.startsWith(" ")) {
            userPhone = "+" + userPhone.trim();
        }

        if (!userPhone) {
            return res
                .status(400)
                .json({ error: "Phone number or user ID required" });
        }

        const payments = await prisma.vendorPayment.findMany({
            where: { userId: userPhone },
            orderBy: { date: "desc" },
        });

        if (format.toLowerCase() === "csv") {
            const csvHeader =
                "Date,Vendor Name,Amount,Ref Bill No,Payment Mode,Notes,Status\n";
            const csvRows = payments
                .map((p) => {
                    const date = new Date(p.date).toLocaleDateString();
                    const vendorName = (p.vendorName || "").replace(
                        /"/g,
                        '""'
                    );
                    const notes = (p.notes || "").replace(/"/g, '""');
                    return `"${date}","${vendorName}","${p.amount}","${
                        p.refBillNo || ""
                    }","${p.paymentMode || "cash"}","${notes}","${p.status}"`;
                })
                .join("\n");

            const csvContent = csvHeader + csvRows;

            res.setHeader("Content-Type", "text/csv");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="spendly-vendor-payments-${
                    new Date().toISOString().split("T")[0]
                }.csv"`
            );
            return res.send(csvContent);
        } else {
            res.setHeader("Content-Type", "application/json");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="spendly-vendor-payments-${
                    new Date().toISOString().split("T")[0]
                }.json"`
            );
            return res.json({
                exportDate: new Date().toISOString(),
                totalPayments: payments.length,
                totalAmount: payments.reduce((sum, p) => sum + p.amount, 0),
                payments: payments,
            });
        }
    } catch (error) {
        console.error("Export vendor payments error:", error);
        return res
            .status(500)
            .json({ error: "Failed to export vendor payments" });
    }
});

module.exports = router;
