const axios = require("axios");
const sendWhatsApp = require("./twilioWhatsapp");

class SpendlyBot {
    static getWelcomeMessage(isNewUser = false) {
        if (isNewUser) {
            return `🎉 *Welcome to Spendly!*

Hi there! I'm your personal expense tracking assistant. I'll help you track every rupee you spend effortlessly.

*Here's what I can do:*
📝 *Text tracking:* Send me messages like "50rs coffee at CCD" or "paid 500 to grocery store"
📷 *Bill scanning:* Send me photos of bills/receipts and I'll extract all details automatically
📊 *Smart categorization:* I'll automatically categorize your expenses
🌐 *Web dashboard:* Type "dashboard" for beautiful analytics and charts

*Try it now!* Send me your first expense or a bill photo.

Type 'help' anytime for more options! 💪`;
        } else {
            return `👋 *Welcome back!*

Ready to track more expenses? Send me:
• A text like "100rs lunch at office canteen"
• A photo of your bill/receipt
• Type 'dashboard' for your web analytics
• Type 'help' for all commands`;
        }
    }

    static getHelpMessage() {
        return `💸 *Spendly Commands 💸:*

*💰 Expense Tracking:*
• Send text: "50rs coffee" or "paid 200 to uber"
• Send bill photo for auto-extraction

*📊 Analytics & Reports:*
• \`summary\` - View your expense summary
• \`today\` - Today's expenses
• \`week\` - This week's expenses
• \`categories\` - Expense breakdown by category
• "How much did I spend on food this month?"
• "Show my total expenses for July"
• "Top 3 categories last 7 days"

*💸 Budget Management:*
• "Set budget for food as 5000 this month"
• "Set travel budget 3000 monthly"
• \`budgets\` - List all your budgets
• \`budget status\` - Check budget usage

*🌐 Web Dashboard:*
• \`login\` or \`dashboard\` - Get secure link to web dashboard
• View detailed analytics, charts, and export data

*🔧 Other Commands:*
• \`help\` - Show this menu

*Pro Tips:*
💡 I auto-categorize expenses (Food, Travel, Shopping, etc.)
💡 Set budgets and get alerts when you're close to limits
💡 Ask me natural questions about your spending!
💡 Send clear photos for accurate bill scanning
💡 Use the web dashboard for detailed analytics and data export

What would you like to track today? 📊`;
    }

    static getErrorMessage(error = "general") {
        const messages = {
            general:
                "❌ Oops! Something went wrong. Please try again or contact support.",
            parsing: `❌ *Couldn't understand that expense*

*Try these formats:*
• "50rs coffee at cafe"
• "paid 200 to grocery store"
• "300 rupees dinner"
• Or send a clear bill photo

Need help? Type 'help' 💪`,
            image: "❌ Please send a clear image of your bill or receipt. I can extract all the details automatically! 📷",
        };
        return messages[error] || messages.general;
    }

    static getSuccessMessage(expenseData, isImage = false) {
        const amount = expenseData.total || 0;
        const vendor = expenseData.vendor || "item";
        const date = expenseData.date || "today";

        // Randomly include dashboard reminder (20% chance)
        const includeDashboardReminder = Math.random() < 0.2;
        const dashboardReminder = includeDashboardReminder
            ? "\n\n💡 *Tip:* Type 'dashboard' to see beautiful charts and analytics on the web!"
            : "";

        if (isImage) {
            return `✅ *Bill processed successfully!*

💰 *Amount:* ₹${amount}
🏪 *Vendor:* ${vendor}
📅 *Date:* ${date}

Your expense has been saved automatically! 🎉

Send another expense or type 'summary' to see your spending overview.${dashboardReminder}`;
        } else {
            return `✅ *Expense saved!*

₹${amount} spent at ${vendor} on ${date}

Keep tracking! Send another expense or type 'help' for more options. 📊${dashboardReminder}`;
        }
    }

    static getProcessingMessage(isImage = false) {
        if (isImage) {
            return "🔍 *Processing your bill...*\n\nI'm extracting all the details from your receipt. This will take a few seconds! ⏳";
        } else {
            return "⏳ Processing your expense...";
        }
    }

    static isCommand(text) {
        const lowerText = text.toLowerCase().trim();

        // Direct command matches (including multi-word commands)
        const directCommands = [
            "hi",
            "hello",
            "hey",
            "start",
            "help",
            "summary",
            "today",
            "week",
            "budget",
            "budget status",
            "budgets",
            "categories",
            "login",
            "dashboard",
        ];
        if (directCommands.some((cmd) => lowerText === cmd)) {
            return true;
        }

        // Check for natural language queries
        const queryPatterns = [
            /how much.*spend.*on/i,
            /show.*total.*expenses/i,
            /show.*expenses?/i,
            /show.*my.*expenses/i,
            /expenses.*for.*month/i,
            /expenses.*this.*month/i,
            /top.*categories/i,
            /set.*budget/i,
            /budget.*for/i,
            /spend.*this/i,
            /spend.*last/i,
            /total.*spent/i,
            /expenses? for/i,
            /spending.*on/i,
            /breakdown/i,
            /monthly.*expenses/i,
            /weekly.*expenses/i,
            /daily.*expenses/i,
        ];

        return queryPatterns.some((pattern) => pattern.test(text));
    }

    // static async handleCommand(command, phoneNumber, prisma) {
    //     const cmd = command.toLowerCase().trim();

    //     // Import the new services
    //     const ExpenseAnalytics = require("./expenseAnalytics");
    //     const BudgetManager = require("./budgetManager");

    //     switch (cmd) {
    //         case "help":
    //             return this.getHelpMessage();

    //         case "summary":
    //             return await this.getSummaryMessage(phoneNumber, prisma);

    //         case "today":
    //             return await this.getTodayExpenses(phoneNumber, prisma);

    //         case "week":
    //             return await this.getWeekExpenses(phoneNumber, prisma);

    //         case "categories":
    //             return await this.getCategoryBreakdown(phoneNumber, prisma);

    //         case "budgets":
    //             return await BudgetManager.listBudgets(prisma, phoneNumber);

    //         case "budget status":
    //             return await BudgetManager.checkBudgetStatus(
    //                 prisma,
    //                 phoneNumber
    //             );

    //         case "start":
    //         case "hi":
    //         case "hello":
    //         case "hey":
    //             // Check if user exists to determine welcome message
    //             const user = await prisma.user.findUnique({
    //                 where: { id: phoneNumber },
    //             });
    //             return this.getWelcomeMessage(!user);

    //         default:
    //             // Check if it's a natural language query
    //             if (this.isNaturalQuery(command)) {
    //                 // Check if it's a budget command
    //                 if (this.isBudgetCommand(command)) {
    //                     return await BudgetManager.parseAndSetBudget(
    //                         command,
    //                         prisma,
    //                         phoneNumber
    //                     );
    //                 }
    //                 // Otherwise, treat as analytics query
    //                 return await ExpenseAnalytics.parseAndExecuteQuery(
    //                     command,
    //                     prisma,
    //                     phoneNumber
    //                 );
    //             }

    //             return this.getHelpMessage();
    //     }
    // }

    static async handleCommand(command, phoneNumber, prisma) {
        const cmd = command.toLowerCase().trim();

        const ExpenseAnalytics = require("./expenseAnalytics");
        const BudgetManager = require("./budgetManager");

        switch (cmd) {
            case "help":
                return this.getHelpMessage();

            case "summary":
                return await this.getSummaryMessage(phoneNumber, prisma);

            case "today":
                return await this.getTodayExpenses(phoneNumber, prisma);

            case "week":
                return await this.getWeekExpenses(phoneNumber, prisma);

            case "categories":
                return await this.getCategoryBreakdown(phoneNumber, prisma);

            case "budgets":
                return await BudgetManager.listBudgets(prisma, phoneNumber);

            case "budget status":
                return await BudgetManager.checkBudgetStatus(
                    prisma,
                    phoneNumber
                );

            case "start":
            case "hi":
            case "hello":
            case "hey":
                const user = await prisma.user.findUnique({
                    where: { id: phoneNumber },
                });
                return this.getWelcomeMessage(!user);

            case "login":
            case "dashboard":
                return await SpendlyBot.generateDashboardLink(phoneNumber);

            default:
                if (this.isNaturalQuery(command)) {
                    if (this.isBudgetCommand(command)) {
                        return await BudgetManager.parseAndSetBudget(
                            command,
                            prisma,
                            phoneNumber
                        );
                    }
                    return await ExpenseAnalytics.parseAndExecuteQuery(
                        command,
                        prisma,
                        phoneNumber
                    );
                }

                return this.getHelpMessage();
        }
    }

    static async generateDashboardLink(phone) {
        try {
            console.log(`Generating dashboard link for: ${phone}`);

            const response = await axios.post(
                `${
                    process.env.BACKEND_URL || "http://localhost:3000"
                }/auth/whatsapp-login`,
                { phone },
                {
                    headers: { "Content-Type": "application/json" },
                    allowAbsoluteUrls: true,
                }
            );

            if (!response.data.success) {
                return "❌ Failed to generate dashboard link. Please try again later.";
            }

            // Return null — whatsapp-login already sent the link via WhatsApp
            return null;
        } catch (error) {
            console.error("Dashboard link generation failed:", error);
            return "❌ Sorry, there was an error generating your dashboard link. Please try again later.";
        }
    }

    static isNaturalQuery(text) {
        const queryPatterns = [
            /how much.*spend.*on/i,
            /show.*total.*expenses/i,
            /show.*expenses/i,
            /show.*my.*expenses/i,
            /expenses.*for.*month/i,
            /expenses.*this.*month/i,
            /top.*categories/i,
            /set.*budget/i,
            /budget.*for/i,
            /spend.*this/i,
            /spend.*last/i,
            /monthly.*expenses/i,
            /weekly.*expenses/i,
            /daily.*expenses/i,
        ];

        return queryPatterns.some((pattern) => pattern.test(text));
    }

    static isBudgetCommand(text) {
        const budgetPatterns = [/set.*budget/i, /budget.*for/i];

        return budgetPatterns.some((pattern) => pattern.test(text));
    }

    static async getSummaryMessage(phoneNumber, prisma) {
        try {
            const expenses = await prisma.expense.findMany({
                where: { userId: phoneNumber },
                orderBy: { createdAt: "desc" },
                take: 10,
            });

            if (expenses.length === 0) {
                return `📊 *Your Expense Summary*

No expenses tracked yet! Start by sending me your first expense:
• Text: "50rs coffee at cafe"
• Or send a bill photo 📷

Let's start tracking! 💪`;
            }

            const totalAmount = expenses.reduce(
                (sum, exp) => sum + exp.amount,
                0
            );
            const todayExpenses = expenses.filter((exp) => {
                const today = new Date();
                const expDate = new Date(exp.createdAt);
                return expDate.toDateString() === today.toDateString();
            });
            const todayTotal = todayExpenses.reduce(
                (sum, exp) => sum + exp.amount,
                0
            );

            return `📊 *Your Expense Summary*

💰 *Total Expenses:* ₹${totalAmount.toFixed(2)}
📅 *Today's Spending:* ₹${todayTotal.toFixed(2)}
📈 *Total Entries:* ${expenses.length}

*Recent Expenses:*
${expenses
    .slice(0, 5)
    .map(
        (exp) =>
            `• ₹${exp.amount} - ${
                exp.description?.split("|")[0]?.replace("Vendor: ", "") ||
                "Unknown"
            }`
    )
    .join("\n")}

Type 'categories' for breakdown or keep tracking! 🚀`;
        } catch (error) {
            console.error("Summary error:", error);
            return this.getErrorMessage();
        }
    }

    static async getTodayExpenses(phoneNumber, prisma) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            const expenses = await prisma.expense.findMany({
                where: {
                    userId: phoneNumber,
                    createdAt: {
                        gte: today,
                        lt: tomorrow,
                    },
                },
                orderBy: { createdAt: "desc" },
            });

            if (expenses.length === 0) {
                return `📅 *Today's Expenses*

No expenses tracked today yet!

Start tracking:
• "50rs coffee"
• Send a bill photo 📷`;
            }

            const total = expenses.reduce((sum, exp) => sum + exp.amount, 0);

            return `📅 *Today's Expenses (${new Date().toLocaleDateString()})*

💰 *Total:* ₹${total.toFixed(2)}
📊 *Entries:* ${expenses.length}

${expenses
    .map(
        (exp) =>
            `• ₹${exp.amount} - ${
                exp.description?.split("|")[0]?.replace("Vendor: ", "") ||
                "Unknown"
            }`
    )
    .join("\n")}

Keep it up! 🎯`;
        } catch (error) {
            console.error("Today expenses error:", error);
            return this.getErrorMessage();
        }
    }

    static async getWeekExpenses(phoneNumber, prisma) {
        try {
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);

            const expenses = await prisma.expense.findMany({
                where: {
                    userId: phoneNumber,
                    createdAt: { gte: weekAgo },
                },
                orderBy: { createdAt: "desc" },
            });

            if (expenses.length === 0) {
                return `📊 *This Week's Expenses*

No expenses this week yet!

Start tracking your spending! 💪`;
            }

            const total = expenses.reduce((sum, exp) => sum + exp.amount, 0);
            const avgDaily = (total / 7).toFixed(2);

            return `📊 *This Week's Expenses*

💰 *Total:* ₹${total.toFixed(2)}
📈 *Daily Average:* ₹${avgDaily}
📊 *Entries:* ${expenses.length}

*Top Expenses:*
${expenses
    .slice(0, 5)
    .map(
        (exp) =>
            `• ₹${exp.amount} - ${
                exp.description?.split("|")[0]?.replace("Vendor: ", "") ||
                "Unknown"
            }`
    )
    .join("\n")}

Type 'categories' for detailed breakdown! 📈`;
        } catch (error) {
            console.error("Week expenses error:", error);
            return this.getErrorMessage();
        }
    }

    static async getCategoryBreakdown(phoneNumber, prisma) {
        try {
            const expenses = await prisma.expense.findMany({
                where: { userId: phoneNumber },
                select: { amount: true, category: true },
            });

            if (expenses.length === 0) {
                return `📊 *Category Breakdown*

No expenses to categorize yet!

Start tracking to see your spending patterns! 🎯`;
            }

            const categoryTotals = {};
            expenses.forEach((exp) => {
                const cat = exp.category || "Uncategorized";
                categoryTotals[cat] = (categoryTotals[cat] || 0) + exp.amount;
            });

            const total = Object.values(categoryTotals).reduce(
                (sum, amount) => sum + amount,
                0
            );
            const sortedCategories = Object.entries(categoryTotals)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 8);

            return `📊 *Category Breakdown*

💰 *Total Spending:* ₹${total.toFixed(2)}

${sortedCategories
    .map(([category, amount]) => {
        const percentage = ((amount / total) * 100).toFixed(1);
        return `• ${category}: ₹${amount.toFixed(2)} (${percentage}%)`;
    })
    .join("\n")}

Keep tracking to optimize your spending! 🎯`;
        } catch (error) {
            console.error("Category breakdown error:", error);
            return this.getErrorMessage();
        }
    }
}

module.exports = SpendlyBot;
