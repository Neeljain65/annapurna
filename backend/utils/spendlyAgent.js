const { GoogleGenAI } = require("@google/genai");
const { PrismaClient } = require("@prisma/client");
const { GeminiService } = require("./gemini");
const SmartCategorization = require("./smartCategorization");
const BudgetManager = require("./budgetManager");
const ExpenseAnalytics = require("./expenseAnalytics");
const sendWhatsApp = require("./twilioWhatsapp");
const axios = require("axios");

const prisma = new PrismaClient();
const geminiService = new GeminiService();
const DailySalesService = require("./dailySales");

// ─── Tool Definitions ───
const tools = [
    {
        functionDeclarations: [
            {
                name: "track_expense",
                description:
                    "Track/save a new expense from the user's message. Use this when the user mentions spending money on utilities, bills, personal purchases, or describes any financial expense (NOT vendor/trader payments). Examples: '50rs coffee', 'paid 200 to uber', 'bought groceries for 1200', 'dinner 500', 'spent 300 on petrol', 'electricity bill 2000'.",
                parameters: {
                    type: "object",
                    properties: {
                        message: {
                            type: "string",
                            description:
                                "The user's original message describing the expense, passed as-is for extraction.",
                        },
                    },
                    required: ["message"],
                },
            },
            {
                name: "get_expenses",
                description:
                    "Get a list of the user's recent expenses, optionally filtered by time period or category. Use this when the user asks to see, show, or list their expenses/transactions. Examples: 'show my expenses', 'what did I spend today', 'recent purchases', 'list my food expenses'.",
                parameters: {
                    type: "object",
                    properties: {
                        period: {
                            type: "string",
                            description:
                                "Time period filter: 'today', 'week', 'month', or 'all'. Default is 'all'.",
                            enum: ["today", "week", "month", "all"],
                        },
                        category: {
                            type: "string",
                            description:
                                "Optional category filter like 'Food & Dining', 'Transportation', 'Shopping', etc. Leave empty for all categories.",
                        },
                        limit: {
                            type: "number",
                            description:
                                "Number of expenses to return. Default is 10.",
                        },
                    },
                },
            },
            {
                name: "get_expense_summary",
                description:
                    "Get an analytical summary of the user's spending, including totals, category breakdowns, and statistics. Use this for questions about how much they spent, spending patterns, category breakdowns, top categories, averages, etc. Examples: 'summary', 'how much did I spend this month', 'total expenses on food', 'top 3 categories', 'spending breakdown'.",
                parameters: {
                    type: "object",
                    properties: {
                        period: {
                            type: "string",
                            description:
                                "Time period: 'today', 'week', 'month', or 'all'. Default is 'month'.",
                            enum: ["today", "week", "month", "all"],
                        },
                        category: {
                            type: "string",
                            description:
                                "Optional category filter. Leave empty for all categories.",
                        },
                        analysis_type: {
                            type: "string",
                            description:
                                "Type of analysis: 'total' for just the total amount, 'summary' for detailed breakdown, 'top' for top categories.",
                            enum: ["total", "summary", "top"],
                        },
                        top_n: {
                            type: "number",
                            description:
                                "For 'top' analysis type, how many top categories to show. Default is 5.",
                        },
                    },
                },
            },
            {
                name: "set_budget",
                description:
                    "Set or update a spending budget for a specific category. Use this when the user wants to create, set, or change a budget limit. Examples: 'set food budget 5000 monthly', 'budget 3000 for travel this month', 'limit my shopping to 2000 per week'.",
                parameters: {
                    type: "object",
                    properties: {
                        category: {
                            type: "string",
                            description:
                                "Expense category for the budget. Must be one of: 'Food & Dining', 'Transportation', 'Shopping', 'Groceries', 'Entertainment', 'Healthcare', 'Utilities', 'Education', 'Personal Care', 'Miscellaneous'.",
                        },
                        amount: {
                            type: "number",
                            description: "Budget amount in INR (rupees).",
                        },
                        period: {
                            type: "string",
                            description:
                                "Budget period: 'monthly', 'weekly', or 'daily'. Default is 'monthly'.",
                            enum: ["monthly", "weekly", "daily"],
                        },
                    },
                    required: ["category", "amount"],
                },
            },
            {
                name: "get_budget_status",
                description:
                    "Check the current budget utilization and status. Shows how much has been spent vs the budget limit. Use for questions about budget progress, remaining budget, or if they're over budget. Examples: 'budget status', 'am I over budget', 'how much food budget left', 'check my budgets'.",
                parameters: {
                    type: "object",
                    properties: {
                        category: {
                            type: "string",
                            description:
                                "Optional category to check specific budget. Leave empty for all budgets.",
                        },
                    },
                },
            },
            {
                name: "generate_dashboard_link",
                description:
                    "Generate and send a secure magic link to the user's web dashboard for viewing detailed analytics, charts, and exporting data. Use this when the user asks for the dashboard, web view, login link, or wants to see charts/analytics on the web. Examples: 'dashboard', 'login', 'web view', 'show me the website', 'open dashboard'.",
                parameters: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "list_budgets",
                description:
                    "List all active budgets the user has set. Use when user asks to see their budgets, budget list, or what budgets they have. Examples: 'my budgets', 'list budgets', 'what budgets do I have'.",
                parameters: {
                    type: "object",
                    properties: {},
                },
            },
            // ─── Vendor Payment Tools ───
            {
                name: "track_vendor_payment",
                description:
                    "Track/record a payment made to a vendor, trader, supplier, or wholesaler. Use this when the user mentions giving money TO a vendor/trader/supplier, paying a trader, settling dues with a vendor, or any business-to-vendor payment. This is DIFFERENT from personal expenses — these are payments to business vendors/traders. Examples: '1000 given to abc trader', 'paid 5000 to sharma supplier', 'gave 2000 to vegetable vendor', 'settled 10000 with xyz trader bill 456', 'payment to ravi wholesaler 3000'.",
                parameters: {
                    type: "object",
                    properties: {
                        vendor_name: {
                            type: "string",
                            description:
                                "Name of the vendor/trader/supplier. Extract from user message.",
                        },
                        amount: {
                            type: "number",
                            description:
                                "Payment amount in INR (rupees).",
                        },
                        ref_bill_no: {
                            type: "string",
                            description:
                                "Reference bill number or invoice number if mentioned. Optional.",
                        },
                        payment_mode: {
                            type: "string",
                            description:
                                "Payment mode if mentioned: 'cash', 'upi', 'bank_transfer', 'cheque', 'card', or 'other'. Default is 'cash'.",
                            enum: ["cash", "upi", "bank_transfer", "cheque", "card", "other"],
                        },
                        notes: {
                            type: "string",
                            description:
                                "Any additional notes about the payment (items purchased, reason, etc.)",
                        },
                        date: {
                            type: "string",
                            description:
                                "Date of payment in YYYY-MM-DD format if mentioned. Defaults to today.",
                        },
                    },
                    required: ["vendor_name", "amount"],
                },
            },
            {
                name: "get_vendor_payments",
                description:
                    "Get a list of payments made to vendors/traders, optionally filtered by vendor name, time period, or payment status. Use when the user asks to see vendor payments, trader dues, or payment history with a specific vendor. Examples: 'show vendor payments', 'payments to abc trader', 'vendor history this month', 'how much paid to suppliers', 'trader payments today'.",
                parameters: {
                    type: "object",
                    properties: {
                        vendor_name: {
                            type: "string",
                            description:
                                "Optional vendor/trader name to filter by. Leave empty for all vendors.",
                        },
                        period: {
                            type: "string",
                            description:
                                "Time period filter: 'today', 'week', 'month', or 'all'. Default is 'all'.",
                            enum: ["today", "week", "month", "all"],
                        },
                        limit: {
                            type: "number",
                            description:
                                "Number of records to return. Default is 10.",
                        },
                    },
                },
            },
            {
                name: "get_vendor_summary",
                description:
                    "Get a summary/analytics of vendor payments — total paid, top vendors, payment breakdowns by vendor. Use for questions like 'how much paid to vendors', 'total vendor payments', 'top vendors', 'vendor payment summary'. Examples: 'vendor summary', 'total paid to traders this month', 'top 5 vendors', 'vendor payment breakdown'.",
                parameters: {
                    type: "object",
                    properties: {
                        period: {
                            type: "string",
                            description:
                                "Time period: 'today', 'week', 'month', or 'all'. Default is 'month'.",
                            enum: ["today", "week", "month", "all"],
                        },
                        vendor_name: {
                            type: "string",
                            description:
                                "Optional specific vendor name to get summary for.",
                        },
                        top_n: {
                            type: "number",
                            description:
                                "Number of top vendors to show. Default is 5.",
                        },
                    },
                },
            },
            {
                name: "get_vendor_ledger",
                description:
                    "Get a complete ledger/khata for a specific vendor showing all transactions. Like an account statement for that vendor. Use when user asks about a specific vendor's account, khata, ledger, or full history. Examples: 'khata of abc trader', 'abc trader ka hisab', 'ledger for sharma supplier', 'full account of xyz vendor'.",
                parameters: {
                    type: "object",
                    properties: {
                        vendor_name: {
                            type: "string",
                            description:
                                "Name of the vendor to get ledger for. Required.",
                        },
                        period: {
                            type: "string",
                            description:
                                "Time period: 'week', 'month', 'all'. Default is 'all'.",
                            enum: ["week", "month", "all"],
                        },
                    },
                    required: ["vendor_name"],
                },
            },
            // ─── Cash Collection & Daily Sales Tools ───
            {
                name: "record_cash_collected",
                description:
                    "Record the cash collected/cash in hand at the end of the day. Use this when the user reports their daily cash collection, cash count, or cash in drawer. This triggers the daily sales calculation. Examples: 'cash collected 5000', 'today collection 8000', 'cash in hand 12000', '5000 cash collected', 'aaj ka collection 7000'.",
                parameters: {
                    type: "object",
                    properties: {
                        amount: {
                            type: "number",
                            description:
                                "Cash amount collected/in hand in INR.",
                        },
                        date: {
                            type: "string",
                            description:
                                "Date in YYYY-MM-DD format. Defaults to today.",
                        },
                        notes: {
                            type: "string",
                            description:
                                "Any notes about the cash collection.",
                        },
                    },
                    required: ["amount"],
                },
            },
            {
                name: "get_daily_sales",
                description:
                    "Get the calculated daily sales for today or a specific date. Shows the full breakdown: expenses + vendor payments + cash collected - opening balance = sales. Use when user asks about today's sales, daily sales, shop sales, or business performance. Examples: 'aaj ki sale', 'today sales', 'daily sales', 'how much sale today', 'shop sales'.",
                parameters: {
                    type: "object",
                    properties: {
                        date: {
                            type: "string",
                            description:
                                "Date in YYYY-MM-DD format. Defaults to today.",
                        },
                    },
                },
            },
            {
                name: "get_sales_history",
                description:
                    "Get sales history over a period — shows daily sales for each day with totals and averages. Use when user asks about sales over time, weekly/monthly sales, sales trend, or sales report. Examples: 'sales this week', 'monthly sales', 'sales history', 'last 7 days sales', 'sales report'.",
                parameters: {
                    type: "object",
                    properties: {
                        period: {
                            type: "string",
                            description:
                                "Time period: 'today', 'week', 'month', or 'all'. Default is 'month'.",
                            enum: ["today", "week", "month", "all"],
                        },
                        limit: {
                            type: "number",
                            description:
                                "Number of days to show. Default is 30.",
                        },
                    },
                },
            },
        ],
    },
];

// ─── System Prompt ───
function getSystemPrompt() {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    });
    const timeStr = now.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });

    return `You are **Spendly**, a smart, friendly WhatsApp assistant for a shop owner. You help them track daily expenses (utility bills, personal spends) AND manage vendor/trader payments — all through natural conversation.

## Current Context
- Date: ${dateStr}
- Time: ${timeStr}
- Platform: WhatsApp (use WhatsApp formatting: *bold*, _italic_, ~strikethrough~)
- Currency: Indian Rupees (₹ / INR)

## Your Capabilities (use the tools provided)
### 💰 Expenses (for utility bills, personal spends)
1. **Track Expenses**: When users mention spending on utilities, bills, personal items → use track_expense.
2. **View Expenses**: When users ask to see their expense transactions → use get_expenses.
3. **Spending Analytics**: For expense totals, breakdowns → use get_expense_summary.
4. **Budget Management**: Set budgets with set_budget, check with get_budget_status, list with list_budgets.
5. **Dashboard**: When users want the web dashboard → use generate_dashboard_link.

### 🏪 Vendor Payments (for traders, suppliers, wholesalers)
6. **Track Vendor Payment**: When a user says they GAVE money TO a vendor/trader/supplier → use track_vendor_payment.
7. **View Vendor Payments**: When users ask to see vendor/trader payment history → use get_vendor_payments.
8. **Vendor Analytics**: For vendor payment totals, top vendors → use get_vendor_summary.
9. **Vendor Ledger/Khata**: When users ask for a specific vendor's full account/khata → use get_vendor_ledger.

## CRITICAL: Expense vs Vendor Payment Detection
- **Expense**: User SPENT money on something for themselves/their shop (electricity bill, groceries, petrol, food).
  - Examples: "paid 2000 electricity bill", "bought chai for 50", "spent 500 on petrol"
- **Vendor Payment**: User GAVE money TO a trader/vendor/supplier as a business payment.
  - Examples: "1000 given to abc trader", "paid 5000 to sharma supplier", "gave vegetable vendor 2000"
  - Keywords: "given to", "paid to [vendor/trader/supplier]", "settled with", "payment to"

## Vendor Payment Flow
When a user tracks a vendor payment:
1. Save the payment with the details provided.
2. After saving, ASK the user: "📋 *Got it!* ₹{amount} paid to *{vendor}* is recorded. Do you have a *bill/reference number* for this? (You can skip by saying 'no')."
3. If the user provides a bill number, UPDATE the record. If they say no/skip, just confirm and move on.
4. Also ask about payment mode if not mentioned: "💳 Was this paid by *cash, UPI, bank transfer, or cheque*?"

## Response Guidelines
- Be conversational, warm, and use relevant emojis 💰📊🎯🏪
- Keep responses concise (WhatsApp messages should be short and scannable)
- Use WhatsApp formatting (*bold* for emphasis, bullet points with •)
- When tracking an expense or vendor payment, confirm what was saved
- When showing data, format numbers with ₹ and Indian number formatting (e.g., ₹1,00,000)
- If the user's message is ambiguous (could be expense or vendor payment), ask for clarification
- For greetings, respond naturally and remind them what you can do (mention BOTH expense tracking AND vendor payments)
- Never make up data — only report what the tools return
- If a tool returns an error, apologize and suggest trying again

## Category Mapping (for expense budgets and queries)
When users mention categories casually, map them:
- food/dining/restaurant/lunch/dinner/breakfast/snack/coffee → "Food & Dining"
- travel/transport/uber/ola/cab/fuel/petrol/auto → "Transportation"
- shopping/clothes/amazon/flipkart/online → "Shopping"
- grocery/vegetables/supermarket/kirana → "Groceries"
- movie/entertainment/netflix/games → "Entertainment"
- medical/health/doctor/medicine/hospital → "Healthcare"
- bill/utility/electricity/water/internet/recharge → "Utilities"
- course/education/book/tuition → "Education"
- gym/salon/beauty/cosmetics → "Personal Care"
- anything else → "Miscellaneous"

## Cash Collection & Daily Sales
When the user reports cash collected (usually in the evening):
1. Record the cash amount using record_cash_collected.
2. This auto-calculates today's sales using: *Sales = Expenses + Vendor Payments + Cash Collected - Opening Balance*
3. Share the full breakdown with the user.
4. Opening Balance = previous day's cash collection amount.

When user says things like "cash collected 5000", "aaj ka collection 8000", "cash in hand 12000" → use record_cash_collected.
When user asks "today's sales", "aaj ki sale", "daily sales" → use get_daily_sales.
When user asks "sales this month", "weekly sales report" → use get_sales_history.`;
}

// ─── Tool Execution ───
async function executeTool(toolName, args, phoneNumber) {
    try {
        switch (toolName) {
            case "track_expense":
                return await handleTrackExpense(args.message, phoneNumber);

            case "get_expenses":
                return await handleGetExpenses(
                    phoneNumber,
                    args.period || "all",
                    args.category || null,
                    args.limit || 10
                );

            case "get_expense_summary":
                return await handleGetSummary(
                    phoneNumber,
                    args.period || "month",
                    args.category || null,
                    args.analysis_type || "summary",
                    args.top_n || 5
                );

            case "set_budget":
                return await handleSetBudget(
                    phoneNumber,
                    args.category,
                    args.amount,
                    args.period || "monthly"
                );

            case "get_budget_status":
                return await handleGetBudgetStatus(
                    phoneNumber,
                    args.category || null
                );

            case "generate_dashboard_link":
                return await handleDashboardLink(phoneNumber);

            case "list_budgets":
                return await handleListBudgets(phoneNumber);

            // ─── Vendor Payment Tools ───
            case "track_vendor_payment":
                return await handleTrackVendorPayment(phoneNumber, args);

            case "get_vendor_payments":
                return await handleGetVendorPayments(
                    phoneNumber,
                    args.vendor_name || null,
                    args.period || "all",
                    args.limit || 10
                );

            case "get_vendor_summary":
                return await handleGetVendorSummary(
                    phoneNumber,
                    args.period || "month",
                    args.vendor_name || null,
                    args.top_n || 5
                );

            case "get_vendor_ledger":
                return await handleGetVendorLedger(
                    phoneNumber,
                    args.vendor_name,
                    args.period || "all"
                );

            // ─── Cash Collection & Daily Sales Tools ───
            case "record_cash_collected":
                return await handleRecordCashCollected(
                    phoneNumber,
                    args.amount,
                    args.date || null,
                    args.notes || null
                );

            case "get_daily_sales":
                return await handleGetDailySales(
                    phoneNumber,
                    args.date || null
                );

            case "get_sales_history":
                return await handleGetSalesHistory(
                    phoneNumber,
                    args.period || "month",
                    args.limit || 30
                );

            default:
                return { error: `Unknown tool: ${toolName}` };
        }
    } catch (error) {
        console.error(`Tool execution error (${toolName}):`, error.message);
        return { error: `Failed to execute ${toolName}: ${error.message}` };
    }
}

// ─── Tool Implementations ───

async function handleTrackExpense(message, phoneNumber) {
    // Extract expense data using existing Gemini service
    const expenseData = await geminiService.extractExpenseData(message);

    // Smart categorization
    const categorizationResult = await SmartCategorization.categorize(
        message,
        expenseData.vendor || "",
        expenseData.total || 0
    );
    const category = categorizationResult.category;

    // Save to database
    const newExpense = await prisma.expense.create({
        data: {
            userId: phoneNumber,
            imageUrl: null,
            source: "whatsapp",
            amount: parseFloat(expenseData.total) || 0,
            category: category,
            description: `Vendor: ${
                expenseData.vendor || "N/A"
            } | Date: ${
                expenseData.date ||
                new Date().toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                })
            }`,
            rawText: message,
            structuredData: expenseData,
        },
    });

    // Check budget alerts
    const budgetAlerts = await BudgetManager.checkBudgetAlerts(
        prisma,
        phoneNumber,
        newExpense
    );

    return {
        success: true,
        expense: {
            amount: newExpense.amount,
            category: category,
            vendor: expenseData.vendor || "N/A",
            date: expenseData.date || "today",
            id: newExpense.id,
        },
        budgetAlerts:
            budgetAlerts.length > 0
                ? budgetAlerts
                : null,
    };
}

async function handleGetExpenses(phoneNumber, period, category, limit) {
    const whereClause = { userId: phoneNumber };

    // Time filter
    const now = new Date();
    if (period === "today") {
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        whereClause.createdAt = { gte: startOfDay };
    } else if (period === "week") {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        whereClause.createdAt = { gte: weekAgo };
    } else if (period === "month") {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        whereClause.createdAt = { gte: startOfMonth };
    }

    // Category filter
    if (category) {
        whereClause.category = { contains: category, mode: "insensitive" };
    }

    const expenses = await prisma.expense.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        take: Math.min(limit, 20),
    });

    return {
        expenses: expenses.map((e) => ({
            amount: e.amount,
            category: e.category,
            vendor:
                e.description?.match(/Vendor: ([^|]+)/)?.[1]?.trim() || "N/A",
            date: e.createdAt.toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
            }),
            rawText: e.rawText,
        })),
        total: expenses.reduce((sum, e) => sum + e.amount, 0),
        count: expenses.length,
        period: period,
    };
}

async function handleGetSummary(
    phoneNumber,
    period,
    category,
    analysisType,
    topN
) {
    const whereClause = { userId: phoneNumber };

    const now = new Date();
    if (period === "today") {
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        whereClause.createdAt = { gte: startOfDay };
    } else if (period === "week") {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        whereClause.createdAt = { gte: weekAgo };
    } else if (period === "month") {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        whereClause.createdAt = { gte: startOfMonth };
    }

    if (category) {
        whereClause.category = { contains: category, mode: "insensitive" };
    }

    const expenses = await prisma.expense.findMany({
        where: whereClause,
        select: { amount: true, category: true, createdAt: true },
    });

    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    const count = expenses.length;

    // Category breakdown
    const categoryTotals = {};
    expenses.forEach((e) => {
        categoryTotals[e.category] =
            (categoryTotals[e.category] || 0) + e.amount;
    });

    const topCategories = Object.entries(categoryTotals)
        .sort(([, a], [, b]) => b - a)
        .slice(0, topN)
        .map(([cat, amount]) => ({
            category: cat,
            amount: amount,
            percentage: total > 0 ? ((amount / total) * 100).toFixed(1) : 0,
        }));

    // Daily average
    let daysInPeriod = 1;
    if (period === "week") daysInPeriod = 7;
    else if (period === "month") daysInPeriod = now.getDate();
    else if (period === "all" && count > 0) {
        const oldest = await prisma.expense.findFirst({
            where: { userId: phoneNumber },
            orderBy: { createdAt: "asc" },
            select: { createdAt: true },
        });
        if (oldest) {
            daysInPeriod = Math.max(
                1,
                Math.ceil(
                    (now - oldest.createdAt) / (1000 * 60 * 60 * 24)
                )
            );
        }
    }

    return {
        total: total,
        count: count,
        period: period,
        category: category || "all",
        dailyAverage: total / daysInPeriod,
        topCategories: topCategories,
    };
}

async function handleSetBudget(phoneNumber, category, amount, period) {
    const budgetData = { category, amount, period, isValid: true };
    const result = await BudgetManager.setBudget(budgetData, prisma, phoneNumber);
    return { message: result };
}

async function handleGetBudgetStatus(phoneNumber, category) {
    const result = await BudgetManager.checkBudgetStatus(
        prisma,
        phoneNumber,
        category
    );
    return { message: result };
}

async function handleDashboardLink(phoneNumber) {
    try {
        const response = await axios.post(
            `${
                process.env.BACKEND_URL || "http://localhost:3000"
            }/auth/whatsapp-login`,
            { phone: phoneNumber },
            {
                headers: { "Content-Type": "application/json" },
                allowAbsoluteUrls: true,
            }
        );

        if (response.data.success) {
            return {
                success: true,
                message:
                    "Dashboard link has been sent to your WhatsApp! Check your messages.",
            };
        }
        return { success: false, message: "Failed to generate dashboard link." };
    } catch (error) {
        console.error("Dashboard link error:", error.message);
        return {
            success: false,
            message: "Failed to generate dashboard link. Please try again.",
        };
    }
}

async function handleListBudgets(phoneNumber) {
    const result = await BudgetManager.listBudgets(prisma, phoneNumber);
    return { message: result };
}

// ─── Vendor Payment Implementations ───

async function handleTrackVendorPayment(phoneNumber, args) {
    const {
        vendor_name,
        amount,
        ref_bill_no,
        payment_mode,
        notes,
        date,
    } = args;

    // Parse date if provided
    let paymentDate = new Date();
    if (date) {
        const parsed = new Date(date);
        if (!isNaN(parsed.getTime())) {
            paymentDate = parsed;
        }
    }

    const payment = await prisma.vendorPayment.create({
        data: {
            userId: phoneNumber,
            vendorName: vendor_name.trim(),
            amount: parseFloat(amount) || 0,
            date: paymentDate,
            refBillNo: ref_bill_no || null,
            paymentMode: payment_mode || "cash",
            notes: notes || null,
            status: "paid",
            rawText: `${amount} given to ${vendor_name}${ref_bill_no ? ` bill:${ref_bill_no}` : ""}`,
        },
    });

    // Get running total for this vendor
    const vendorTotal = await prisma.vendorPayment.aggregate({
        where: {
            userId: phoneNumber,
            vendorName: { equals: vendor_name.trim(), mode: "insensitive" },
        },
        _sum: { amount: true },
        _count: { id: true },
    });

    return {
        success: true,
        payment: {
            id: payment.id,
            vendorName: payment.vendorName,
            amount: payment.amount,
            date: payment.date.toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
            }),
            refBillNo: payment.refBillNo,
            paymentMode: payment.paymentMode,
            notes: payment.notes,
        },
        vendorRunningTotal: vendorTotal._sum.amount || 0,
        vendorPaymentCount: vendorTotal._count.id || 0,
        needsBillNo: !ref_bill_no,
        needsPaymentMode: !payment_mode,
    };
}

async function handleGetVendorPayments(phoneNumber, vendorName, period, limit) {
    const whereClause = { userId: phoneNumber };

    // Time filter
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
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        whereClause.date = { gte: startOfMonth };
    }

    // Vendor name filter (fuzzy)
    if (vendorName) {
        whereClause.vendorName = { contains: vendorName.trim(), mode: "insensitive" };
    }

    const payments = await prisma.vendorPayment.findMany({
        where: whereClause,
        orderBy: { date: "desc" },
        take: Math.min(limit, 20),
    });

    const total = payments.reduce((sum, p) => sum + p.amount, 0);

    return {
        payments: payments.map((p) => ({
            vendorName: p.vendorName,
            amount: p.amount,
            date: p.date.toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
            }),
            refBillNo: p.refBillNo || "—",
            paymentMode: p.paymentMode || "cash",
            notes: p.notes || "",
        })),
        total: total,
        count: payments.length,
        period: period,
        vendorFilter: vendorName || "all",
    };
}

async function handleGetVendorSummary(phoneNumber, period, vendorName, topN) {
    const whereClause = { userId: phoneNumber };

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
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        whereClause.date = { gte: startOfMonth };
    }

    if (vendorName) {
        whereClause.vendorName = { contains: vendorName.trim(), mode: "insensitive" };
    }

    const payments = await prisma.vendorPayment.findMany({
        where: whereClause,
        select: { amount: true, vendorName: true, date: true, paymentMode: true },
    });

    const total = payments.reduce((sum, p) => sum + p.amount, 0);
    const count = payments.length;

    // Vendor-wise breakdown
    const vendorTotals = {};
    const vendorCounts = {};
    payments.forEach((p) => {
        const name = p.vendorName;
        vendorTotals[name] = (vendorTotals[name] || 0) + p.amount;
        vendorCounts[name] = (vendorCounts[name] || 0) + 1;
    });

    const topVendors = Object.entries(vendorTotals)
        .sort(([, a], [, b]) => b - a)
        .slice(0, topN)
        .map(([name, amount]) => ({
            vendorName: name,
            totalPaid: amount,
            paymentCount: vendorCounts[name],
            percentage: total > 0 ? ((amount / total) * 100).toFixed(1) : 0,
        }));

    // Payment mode breakdown
    const modeBreakdown = {};
    payments.forEach((p) => {
        const mode = p.paymentMode || "cash";
        modeBreakdown[mode] = (modeBreakdown[mode] || 0) + p.amount;
    });

    return {
        total: total,
        count: count,
        period: period,
        uniqueVendors: Object.keys(vendorTotals).length,
        topVendors: topVendors,
        paymentModeBreakdown: modeBreakdown,
    };
}

async function handleGetVendorLedger(phoneNumber, vendorName, period) {
    const whereClause = {
        userId: phoneNumber,
        vendorName: { contains: vendorName.trim(), mode: "insensitive" },
    };

    const now = new Date();
    if (period === "week") {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        whereClause.date = { gte: weekAgo };
    } else if (period === "month") {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        whereClause.date = { gte: startOfMonth };
    }

    const payments = await prisma.vendorPayment.findMany({
        where: whereClause,
        orderBy: { date: "asc" },
    });

    const total = payments.reduce((sum, p) => sum + p.amount, 0);

    // Build ledger entries with running balance
    let runningTotal = 0;
    const ledger = payments.map((p) => {
        runningTotal += p.amount;
        return {
            date: p.date.toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
            }),
            amount: p.amount,
            runningTotal: runningTotal,
            refBillNo: p.refBillNo || "—",
            paymentMode: p.paymentMode || "cash",
            notes: p.notes || "",
        };
    });

    // Find the actual vendor name (case-corrected)
    const actualVendorName =
        payments.length > 0 ? payments[0].vendorName : vendorName;

    return {
        vendorName: actualVendorName,
        totalPaid: total,
        transactionCount: payments.length,
        period: period,
        ledger: ledger,
        firstPayment:
            payments.length > 0
                ? payments[0].date.toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                  })
                : null,
        lastPayment:
            payments.length > 0
                ? payments[payments.length - 1].date.toLocaleDateString(
                      "en-IN",
                      {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                      }
                  )
                : null,
    };
}

// ─── Cash Collection & Daily Sales Implementations ───

async function handleRecordCashCollected(phoneNumber, amount, dateStr, notes) {
    // Use today's IST date if not provided
    const targetDate = dateStr || DailySalesService.getTodayIST();

    // Record the cash deposit
    const deposit = await DailySalesService.recordCashDeposit(
        phoneNumber,
        parseFloat(amount) || 0,
        targetDate,
        notes
    );

    // Auto-calculate daily sales
    const salesData = await DailySalesService.calculateDailySales(
        phoneNumber,
        targetDate
    );

    return {
        success: true,
        cashDeposit: {
            amount: deposit.amount,
            date: deposit.date.toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                weekday: "short",
            }),
        },
        dailySales: {
            totalExpenses: salesData.totalExpenses,
            expenseCount: salesData.expenseCount,
            totalVendor: salesData.totalVendor,
            vendorCount: salesData.vendorCount,
            cashCollected: salesData.cashCollected,
            openingBalance: salesData.openingBalance,
            salesAmount: salesData.salesAmount,
            formula: "Sales = Expenses + Vendor Payments + Cash Collected - Opening Balance",
        },
    };
}

async function handleGetDailySales(phoneNumber, dateStr) {
    const targetDate = dateStr || DailySalesService.getTodayIST();

    // Try to calculate (or recalculate) for the date
    const salesData = await DailySalesService.calculateDailySales(
        phoneNumber,
        targetDate
    );

    return {
        date: targetDate,
        totalExpenses: salesData.totalExpenses,
        expenseCount: salesData.expenseCount,
        totalVendor: salesData.totalVendor,
        vendorCount: salesData.vendorCount,
        cashCollected: salesData.cashCollected,
        openingBalance: salesData.openingBalance,
        salesAmount: salesData.salesAmount,
        formula: "Sales = Expenses + Vendor Payments + Cash Collected - Opening Balance",
        hasCashData: salesData.cashCollected > 0,
    };
}

async function handleGetSalesHistory(phoneNumber, period, limit) {
    const result = await DailySalesService.getSalesHistory(
        phoneNumber,
        period,
        limit
    );
    return result;
}

// ─── Main Agent ───
class SpendlyAgent {
    constructor() {
        this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }

    /**
     * Process a user message through the AI agent.
     * Returns the final text response to send via WhatsApp.
     */
    async processMessage(phoneNumber, userMessage, isFirstMessage = false) {
        try {
            const systemPrompt = getSystemPrompt();

            // Add first-message context if applicable
            let messageContent = userMessage;
            if (isFirstMessage) {
                messageContent = `[SYSTEM NOTE: This is a brand new user who just joined Spendly. Welcome them warmly and explain what you can do. Their message: "${userMessage}"]`;
            }

            // Create a chat session with function calling
            const chat = this.ai.chats.create({
                model: "gemini-2.5-flash",
                config: {
                    tools: tools,
                    systemInstruction: systemPrompt,
                },
                history: [],
            });

            // Send the user message
            let response = await chat.sendMessage({
                message: messageContent,
            });

            // Function calling loop — keep executing tools until we get a final text response
            const MAX_TOOL_CALLS = 5;
            let toolCallCount = 0;

            while (toolCallCount < MAX_TOOL_CALLS) {
                // Check if the model wants to call a function
                const candidate = response.candidates?.[0];
                const parts = candidate?.content?.parts || [];

                const functionCalls = parts.filter(
                    (part) => part.functionCall
                );

                if (functionCalls.length === 0) {
                    // No more function calls — we have the final text response
                    break;
                }

                // Execute each function call
                const functionResponses = [];
                for (const part of functionCalls) {
                    const { name, args } = part.functionCall;
                    console.log(`Agent calling tool: ${name}`, args);

                    const result = await executeTool(name, args || {}, phoneNumber);

                    functionResponses.push({
                        functionResponse: {
                            name: name,
                            response: result,
                        },
                    });
                }

                // Send function results back to the model
                response = await chat.sendMessage({
                    message: functionResponses,
                });

                toolCallCount++;
            }

            // Extract the final text response
            const finalText = response.text || "";

            if (!finalText.trim()) {
                return "I processed your request! Is there anything else I can help with? 😊";
            }

            return finalText.trim();
        } catch (error) {
            console.error("SpendlyAgent error:", error);
            return "❌ Sorry, I had trouble processing that. Could you try again or rephrase? Type *help* if you need to see what I can do!";
        }
    }

    /**
     * Process an image message (receipt/bill photo).
     * Extracts text via OCR and processes it through the agent.
     */
    async processImageMessage(phoneNumber, imageUrl, ocrText, isFirstMessage = false) {
        try {
            // If OCR extracted text, use it as context
            const messageContent = ocrText
                ? `[The user sent a photo of a receipt/bill. OCR extracted text: "${ocrText}". Please extract and track the expense from this receipt.]`
                : `[The user sent a photo of a receipt/bill but OCR could not extract text. Ask them to try a clearer photo or type the expense manually.]`;

            return await this.processMessage(phoneNumber, messageContent, isFirstMessage);
        } catch (error) {
            console.error("Image processing error:", error);
            return "❌ I couldn't process that image. Could you try sending a clearer photo, or tell me the expense manually? For example: *200rs lunch at cafe*";
        }
    }
}

module.exports = new SpendlyAgent();
