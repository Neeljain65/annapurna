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

// ─── Tool Definitions ───
const tools = [
    {
        functionDeclarations: [
            {
                name: "track_expense",
                description:
                    "Track/save a new expense from the user's message. Use this when the user mentions spending money, paying for something, buying something, or describes any financial transaction. Examples: '50rs coffee', 'paid 200 to uber', 'bought groceries for 1200', 'dinner 500', 'spent 300 on petrol'.",
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

    return `You are **Spendly**, a smart, friendly WhatsApp expense tracking assistant. You help users track their daily expenses, manage budgets, and understand their spending habits — all through natural conversation.

## Current Context
- Date: ${dateStr}
- Time: ${timeStr}
- Platform: WhatsApp (use WhatsApp formatting: *bold*, _italic_, ~strikethrough~)
- Currency: Indian Rupees (₹ / INR)

## Your Capabilities (use the tools provided)
1. **Track Expenses**: When users mention spending money, use track_expense to save it.
2. **View Expenses**: When users ask to see their transactions, use get_expenses.
3. **Spending Analytics**: For questions about how much they spent, totals, breakdowns — use get_expense_summary.
4. **Budget Management**: Set budgets with set_budget, check with get_budget_status, list with list_budgets.
5. **Dashboard**: When users want the web dashboard, use generate_dashboard_link.

## Response Guidelines
- Be conversational, warm, and use relevant emojis 💰📊🎯
- Keep responses concise (WhatsApp messages should be short and scannable)
- Use WhatsApp formatting (*bold* for emphasis, bullet points with •)
- When tracking an expense, confirm what was saved
- When showing data, format numbers with ₹ and Indian number formatting
- If the user's message is ambiguous (could be expense or question), ask for clarification
- For greetings, respond naturally and remind them what you can do
- Never make up expense data — only report what the tools return
- If a tool returns an error, apologize and suggest trying again

## Category Mapping (for budget and queries)
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
- anything else → "Miscellaneous"`;
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
