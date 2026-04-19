const { PrismaClient } = require("@prisma/client");
const sendWhatsApp = require("./twilioWhatsapp");

const prisma = new PrismaClient();

/**
 * Daily Sales Calculator
 * 
 * Formula: Sales = Expenses (today) + Vendor Payments (today) + Cash Collected (today) - Opening Balance
 * Opening Balance = Previous day's cash deposit/collected amount
 */
class DailySalesService {

    /**
     * Get the start and end of a given date (IST-aware)
     */
    static getDateBounds(date) {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);
        return { start, end };
    }

    /**
     * Get today's date string in YYYY-MM-DD format (IST)
     */
    static getTodayIST() {
        const now = new Date();
        // Convert to IST (UTC+5:30)
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istDate = new Date(now.getTime() + istOffset);
        return istDate.toISOString().split("T")[0];
    }

    /**
     * Get a Date object for start of day in IST
     */
    static getISTDateStart(dateStr) {
        // dateStr like "2026-04-20"
        // IST is UTC+5:30, so midnight IST = previous day 18:30 UTC
        const date = new Date(dateStr + "T00:00:00+05:30");
        return date;
    }

    static getISTDateEnd(dateStr) {
        const date = new Date(dateStr + "T23:59:59.999+05:30");
        return date;
    }

    /**
     * Get total expenses for a user on a given date
     */
    static async getTodayExpenses(userId, dateStr) {
        const start = this.getISTDateStart(dateStr);
        const end = this.getISTDateEnd(dateStr);

        const result = await prisma.expense.aggregate({
            where: {
                userId: userId,
                createdAt: { gte: start, lte: end },
            },
            _sum: { amount: true },
            _count: { id: true },
        });

        return {
            total: result._sum.amount || 0,
            count: result._count.id || 0,
        };
    }

    /**
     * Get total vendor payments for a user on a given date
     */
    static async getTodayVendorPayments(userId, dateStr) {
        const start = this.getISTDateStart(dateStr);
        const end = this.getISTDateEnd(dateStr);

        const result = await prisma.vendorPayment.aggregate({
            where: {
                userId: userId,
                date: { gte: start, lte: end },
            },
            _sum: { amount: true },
            _count: { id: true },
        });

        return {
            total: result._sum.amount || 0,
            count: result._count.id || 0,
        };
    }

    /**
     * Get the opening balance (previous day's cash deposit)
     */
    static async getOpeningBalance(userId, dateStr) {
        // Find the most recent cash deposit BEFORE today
        const todayStart = this.getISTDateStart(dateStr);

        const previousDeposit = await prisma.cashDeposit.findFirst({
            where: {
                userId: userId,
                date: { lt: todayStart },
            },
            orderBy: { date: "desc" },
        });

        return previousDeposit ? previousDeposit.amount : 0;
    }

    /**
     * Record cash collected for today
     */
    static async recordCashDeposit(userId, amount, dateStr, notes = null) {
        const dateStart = this.getISTDateStart(dateStr);

        // Upsert — update if exists for today, create if not
        const deposit = await prisma.cashDeposit.upsert({
            where: {
                userId_date: {
                    userId: userId,
                    date: dateStart,
                },
            },
            update: {
                amount: amount,
                notes: notes,
            },
            create: {
                userId: userId,
                amount: amount,
                date: dateStart,
                notes: notes,
            },
        });

        return deposit;
    }

    /**
     * Calculate and save daily sales for a given date
     * Sales = Expenses + Vendor Payments + Cash Collected - Opening Balance
     */
    static async calculateDailySales(userId, dateStr) {
        const expenses = await this.getTodayExpenses(userId, dateStr);
        const vendorPayments = await this.getTodayVendorPayments(userId, dateStr);
        const openingBalance = await this.getOpeningBalance(userId, dateStr);

        // Get cash collected for today
        const dateStart = this.getISTDateStart(dateStr);
        const cashDeposit = await prisma.cashDeposit.findFirst({
            where: {
                userId: userId,
                date: dateStart,
            },
        });

        const cashCollected = cashDeposit ? cashDeposit.amount : 0;

        // Sales = Expenses + Vendor Payments + Cash Collected - Opening Balance
        const salesAmount =
            expenses.total + vendorPayments.total + cashCollected - openingBalance;

        // Upsert the daily sales record
        const dailySales = await prisma.dailySales.upsert({
            where: {
                userId_date: {
                    userId: userId,
                    date: dateStart,
                },
            },
            update: {
                totalExpenses: expenses.total,
                totalVendor: vendorPayments.total,
                cashCollected: cashCollected,
                openingBalance: openingBalance,
                salesAmount: salesAmount,
            },
            create: {
                userId: userId,
                date: dateStart,
                totalExpenses: expenses.total,
                totalVendor: vendorPayments.total,
                cashCollected: cashCollected,
                openingBalance: openingBalance,
                salesAmount: salesAmount,
            },
        });

        return {
            date: dateStr,
            totalExpenses: expenses.total,
            expenseCount: expenses.count,
            totalVendor: vendorPayments.total,
            vendorCount: vendorPayments.count,
            cashCollected: cashCollected,
            openingBalance: openingBalance,
            salesAmount: salesAmount,
        };
    }

    /**
     * Get daily sales for a period
     */
    static async getSalesHistory(userId, period = "month", limit = 30) {
        const whereClause = { userId: userId };

        const now = new Date();
        if (period === "today") {
            const dateStr = this.getTodayIST();
            const start = this.getISTDateStart(dateStr);
            const end = this.getISTDateEnd(dateStr);
            whereClause.date = { gte: start, lte: end };
        } else if (period === "week") {
            const weekAgo = new Date(now);
            weekAgo.setDate(weekAgo.getDate() - 7);
            whereClause.date = { gte: weekAgo };
        } else if (period === "month") {
            const monthAgo = new Date(now);
            monthAgo.setDate(monthAgo.getDate() - 30);
            whereClause.date = { gte: monthAgo };
        }

        const sales = await prisma.dailySales.findMany({
            where: whereClause,
            orderBy: { date: "desc" },
            take: limit,
        });

        const totalSales = sales.reduce((sum, s) => sum + s.salesAmount, 0);
        const avgDailySales = sales.length > 0 ? totalSales / sales.length : 0;

        return {
            sales: sales.map((s) => ({
                date: s.date.toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    weekday: "short",
                }),
                totalExpenses: s.totalExpenses,
                totalVendor: s.totalVendor,
                cashCollected: s.cashCollected,
                openingBalance: s.openingBalance,
                salesAmount: s.salesAmount,
            })),
            totalSales: totalSales,
            avgDailySales: Math.round(avgDailySales),
            daysTracked: sales.length,
            period: period,
        };
    }

    /**
     * Send the 8:30 PM cash collection prompt to all active users
     */
    static async sendCashCollectionPrompts() {
        try {
            // Get all users who have had activity (expenses or vendor payments) today
            const dateStr = this.getTodayIST();
            const start = this.getISTDateStart(dateStr);
            const end = this.getISTDateEnd(dateStr);

            // Get all distinct users
            const users = await prisma.user.findMany({
                select: { id: true, phoneNumber: true, name: true },
            });

            for (const user of users) {
                try {
                    // Check if they already submitted cash for today
                    const existingDeposit = await prisma.cashDeposit.findFirst({
                        where: {
                            userId: user.id,
                            date: start,
                        },
                    });

                    if (existingDeposit) {
                        // Already recorded, skip
                        console.log(`Cash already recorded for ${user.phoneNumber} today, skipping prompt.`);
                        continue;
                    }

                    // Get today's summary to include in the prompt
                    const expenses = await this.getTodayExpenses(user.id, dateStr);
                    const vendorPayments = await this.getTodayVendorPayments(user.id, dateStr);
                    const openingBalance = await this.getOpeningBalance(user.id, dateStr);

                    // Only prompt if they had some activity today OR have opening balance
                    if (expenses.total === 0 && vendorPayments.total === 0 && openingBalance === 0) {
                        console.log(`No activity for ${user.phoneNumber} today, skipping prompt.`);
                        continue;
                    }

                    const message = `🕗 *Good evening!* Time for your daily cash count.\n\n📊 *Today's Summary So Far:*\n• 💸 Expenses: ₹${expenses.total.toLocaleString("en-IN")}\n• 🏪 Vendor Payments: ₹${vendorPayments.total.toLocaleString("en-IN")}\n• 💰 Opening Balance: ₹${openingBalance.toLocaleString("en-IN")}\n\n*How much cash did you collect today?* 💵\n\n_Just reply with the amount (e.g., \"cash collected 5000\" or \"today's collection 8000\")_`;

                    await sendWhatsApp(user.phoneNumber, message);
                    console.log(`📨 Cash collection prompt sent to ${user.phoneNumber}`);
                } catch (userError) {
                    console.error(`Failed to prompt user ${user.phoneNumber}:`, userError.message);
                }
            }

            console.log("✅ Cash collection prompts sent successfully");
        } catch (error) {
            console.error("❌ Failed to send cash collection prompts:", error.message);
        }
    }
}

module.exports = DailySalesService;
