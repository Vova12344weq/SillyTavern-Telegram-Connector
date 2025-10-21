// server.js
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// 添加日志记录函数，带有时间戳
function logWithTimestamp(level, ...args) {
    const now = new Date();

    // 使用本地时区格式化时间
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    const timestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    const prefix = `[${timestamp}]`;

    switch (level) {
        case 'error':
            console.error(prefix, ...args);
            break;
        case 'warn':
            console.warn(prefix, ...args);
            break;
        default:
            console.log(prefix, ...args);
    }
}

// 重启保护 - 防止循环重启
const RESTART_PROTECTION_FILE = path.join(__dirname, '.restart_protection');
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60000; // 1分钟

// 检查是否可能处于循环重启状态
function checkRestartProtection() {
    try {
        if (fs.existsSync(RESTART_PROTECTION_FILE)) {
            const data = JSON.parse(fs.readFileSync(RESTART_PROTECTION_FILE, 'utf8'));
            const now = Date.now();

            // 清理过期的重启记录
            data.restarts = data.restarts.filter(time => now - time < RESTART_WINDOW_MS);

            // 添加当前重启时间
            data.restarts.push(now);

            // 如果在时间窗口内重启次数过多，则退出
            if (data.restarts.length > MAX_RESTARTS) {
                logWithTimestamp('error', `检测到可能的循环重启！在${RESTART_WINDOW_MS / 1000}秒内重启了${data.restarts.length}次。`);
                logWithTimestamp('error', '为防止资源耗尽，服务器将退出。请手动检查并修复问题后再启动。');

                // 如果有通知chatId，尝试发送错误消息
                if (process.env.RESTART_NOTIFY_CHATID) {
                    const chatId = parseInt(process.env.RESTART_NOTIFY_CHATID);
                    if (!isNaN(chatId)) {
                        // 创建临时bot发送错误消息
                        try {
                            const tempBot = new TelegramBot(require('./config').telegramToken, { polling: false });
                            tempBot.sendMessage(chatId, '检测到循环重启！服务器已停止以防止资源耗尽。请手动检查问题。')
                            .finally(() => process.exit(1));
                        } catch (e) {
                            process.exit(1);
                        }
                        return; // 等待消息发送后退出
                    }
                }

                process.exit(1);
            }

            // 保存更新后的重启记录
            fs.writeFileSync(RESTART_PROTECTION_FILE, JSON.stringify(data));
        } else {
            // 创建新的重启保护文件
            fs.writeFileSync(RESTART_PROTECTION_FILE, JSON.stringify({ restarts: [Date.now()] }));
        }
    } catch (error) {
        logWithTimestamp('error', '重启保护检查失败:', error);
        // 出错时继续执行，不要阻止服务器启动
    }
}

// 启动时检查重启保护
checkRestartProtection();

// 检查配置文件是否存在
const configPath = path.join(__dirname, './config.js');
if (!fs.existsSync(configPath)) {
    logWithTimestamp('error', '错误: 找不到配置文件 config.js！');
    logWithTimestamp('error', '请在server目录下复制 config.example.js 为 config.js，并设置您的Telegram Bot Token');
    process.exit(1); // 终止程序
}

const config = require('./config');

// --- 配置 ---
// 从配置文件中获取Telegram Bot Token和WebSocket端口
const token = config.telegramToken;
// WebSocket服务器端口
const wssPort = config.wssPort;

// 检查是否修改了默认token
if (token === 'TOKEN' || token === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    logWithTimestamp('error', '错误: 请先在config.js文件中设置你的Telegram Bot Token！');
    logWithTimestamp('error', '找到 telegramToken: \'YOUR_TELEGRAM_BOT_TOKEN_HERE\' 这一行并替换为你从BotFather获取的token');
    process.exit(1); // 终止程序
}

// 初始化Telegram Bot，但不立即启动轮询
const bot = new TelegramBot(token, { polling: false });
logWithTimestamp('log', '正在初始化Telegram Bot...');

// 手动清除所有未处理的消息，然后启动轮询
(async function clearAndStartPolling() {
    try {
        logWithTimestamp('log', '正在清除Telegram消息队列...');

        // 检查是否是重启，如果是则使用更彻底的清除方式
        const isRestart = process.env.TELEGRAM_CLEAR_UPDATES === '1';
        if (isRestart) {
            logWithTimestamp('log', '检测到重启标记，将执行更彻底的消息队列清理...');
            // 获取更新并丢弃所有消息
            let updates;
            let lastUpdateId = 0;

            // 循环获取所有更新直到没有更多更新
            do {
                updates = await bot.getUpdates({
                    offset: lastUpdateId,
                    limit: 100,
                    timeout: 0
                });

                if (updates && updates.length > 0) {
                    lastUpdateId = updates[updates.length - 1].update_id + 1;
                    logWithTimestamp('log', `清理了 ${updates.length} 条消息，当前offset: ${lastUpdateId}`);
                }
            } while (updates && updates.length > 0);

            // 清除环境变量
            delete process.env.TELEGRAM_CLEAR_UPDATES;
            logWithTimestamp('log', '消息队列清理完成');
        } else {
            // 普通启动时的清理
            const updates = await bot.getUpdates({ limit: 100, timeout: 0 });
            if (updates && updates.length > 0) {
                // 如果有更新，获取最后一个更新的ID并设置offset为它+1
                const lastUpdateId = updates[updates.length - 1].update_id;
                await bot.getUpdates({ offset: lastUpdateId + 1, limit: 1, timeout: 0 });
                logWithTimestamp('log', `已清除 ${updates.length} 条待处理消息`);
            } else {
                logWithTimestamp('log', '没有待处理消息需要清除');
            }
        }

        // 启动轮询
        bot.startPolling({
            restart: true,
            clean: true
        });
        logWithTimestamp('log', 'Telegram Bot轮询已启动');
    } catch (error) {
        logWithTimestamp('error', '清除消息队列或启动轮询时出错:', error);
        // 如果清除失败，仍然尝试启动轮询
        bot.startPolling({ restart: true, clean: true });
        logWithTimestamp('log', 'Telegram Bot轮询已启动（清除队列失败后）');
    }
})();

// 初始化WebSocket服务器
const wss = new WebSocket.Server({ port: wssPort });
logWithTimestamp('log', `WebSocket服务器正在监听端口 ${wssPort}...`);

let sillyTavernClient = null; // 用于存储连接的SillyTavern扩展客户端

// 用于存储正在进行的流式会话，调整会话结构，使用Promise来处理messageId
// 结构: { messagePromise: Promise<number> | null, lastText: String, timer: NodeJS.Timeout | null, isEditing: boolean }
const ongoingStreams = new Map();

// Chat states for multiplayer mode
const chatStates = new Map();

// State for conversation mode
const conversationModeStates = new Map();

// Get or create conversation state
function getOrCreateConversationState(chatId) {
    if (!conversationModeStates.has(chatId)) {
        conversationModeStates.set(chatId, {
            isActive: false,
            messagesToDelete: [],
        });
    }
    return conversationModeStates.get(chatId);
}

// Get or create chat state
function getOrCreateState(chatId) {
    if (!chatStates.has(chatId)) {
        chatStates.set(chatId, { mode: 'immediate', buffer: [], lastInfoMessageId: null, pendingResponse: false });
    }
    return chatStates.get(chatId);
}

// Wrapper for bot.sendMessage to track message IDs in conversation mode
async function sendMessageAndTrack(chatId, text, options) {
    const convoState = getOrCreateConversationState(chatId);
    try {
        const sentMessage = await bot.sendMessage(chatId, text, options);
        if (convoState.isActive && sentMessage) {
            convoState.messagesToDelete.push(sentMessage.message_id);
        }
        return sentMessage;
    } catch (err) {
        logWithTimestamp('error', `sendMessageAndTrack failed for chat ${chatId}:`, err.message);
        throw err; // Re-throw the error to be handled by the caller
    }
}

// 重载服务器函数
function reloadServer(chatId) {
    logWithTimestamp('log', '重载服务器端组件...');
    Object.keys(require.cache).forEach(function (key) {
        if (key.indexOf('node_modules') === -1) {
            delete require.cache[key];
        }
    });
    try {
        delete require.cache[require.resolve('./config.js')];
        const newConfig = require('./config.js');
        Object.assign(config, newConfig);
        logWithTimestamp('log', '配置文件已重新加载');
    } catch (error) {
        logWithTimestamp('error', '重新加载配置文件时出错:', error);
        if (chatId) sendMessageAndTrack(chatId, '重新加载配置文件时出错: ' + error.message);
        return;
    }
    logWithTimestamp('log', '服务器端组件已重载');
    if (chatId) sendMessageAndTrack(chatId, '服务器端组件已成功重载。');
}

// 重启服务器函数
function restartServer(chatId) {
    logWithTimestamp('log', '重启服务器端组件...');

    // 首先停止Telegram Bot轮询
    bot.stopPolling().then(() => {
        logWithTimestamp('log', 'Telegram Bot轮询已停止');

        // 然后关闭WebSocket服务器
        if (wss) {
            wss.close(() => {
                logWithTimestamp('log', 'WebSocket服务器已关闭，准备重启...');
                setTimeout(() => {
                    const { spawn } = require('child_process');
                    const serverPath = path.join(__dirname, 'server.js');
                    logWithTimestamp('log', `重启服务器: ${serverPath}`);
                    const cleanEnv = {
                        PATH: process.env.PATH,
                        NODE_PATH: process.env.NODE_PATH,
                        TELEGRAM_CLEAR_UPDATES: '1' // 添加标记，表示这是一次重启
                    };
                    if (chatId) cleanEnv.RESTART_NOTIFY_CHATID = chatId.toString();
                    const child = spawn(process.execPath, [serverPath], { detached: true, stdio: 'inherit', env: cleanEnv });
                    child.unref();
                    process.exit(0);
                }, 1000);
            });
        } else {
            // 如果没有WebSocket服务器，直接重启
            setTimeout(() => {
                const { spawn } = require('child_process');
                const serverPath = path.join(__dirname, 'server.js');
                logWithTimestamp('log', `重启服务器: ${serverPath}`);
                const cleanEnv = {
                    PATH: process.env.PATH,
                    NODE_PATH: process.env.NODE_PATH,
                    TELEGRAM_CLEAR_UPDATES: '1' // 添加标记，表示这是一次重启
                };
                if (chatId) cleanEnv.RESTART_NOTIFY_CHATID = chatId.toString();
                const child = spawn(process.execPath, [serverPath], { detached: true, stdio: 'inherit', env: cleanEnv });
                child.unref();
                process.exit(0);
            }, 1000);
        }
    }).catch(err => {
        logWithTimestamp('error', '停止Telegram Bot轮询时出错:', err);
        // 即使出错也继续重启过程
        if (wss) {
            wss.close(() => {
                // 重启代码...
                setTimeout(() => {
                    const { spawn } = require('child_process');
                    const serverPath = path.join(__dirname, 'server.js');
                    logWithTimestamp('log', `重启服务器: ${serverPath}`);
                    const cleanEnv = {
                        PATH: process.env.PATH,
                        NODE_PATH: process.env.NODE_PATH,
                        TELEGRAM_CLEAR_UPDATES: '1' // 添加标记，表示这是一次重启
                    };
                    if (chatId) cleanEnv.RESTART_NOTIFY_CHATID = chatId.toString();
                    const child = spawn(process.execPath, [serverPath], { detached: true, stdio: 'inherit', env: cleanEnv });
                    child.unref();
                    process.exit(0);
                }, 1000);
            });
        } else {
            // 如果没有WebSocket服务器，直接重启
            setTimeout(() => {
                const { spawn } = require('child_process');
                const serverPath = path.join(__dirname, 'server.js');
                logWithTimestamp('log', `重启服务器: ${serverPath}`);
                const cleanEnv = {
                    PATH: process.env.PATH,
                    NODE_PATH: process.env.NODE_PATH,
                    TELEGRAM_CLEAR_UPDATES: '1' // 添加标记，表示这是一次重启
                };
                if (chatId) cleanEnv.RESTART_NOTIFY_CHATID = chatId.toString();
                const child = spawn(process.execPath, [serverPath], { detached: true, stdio: 'inherit', env: cleanEnv });
                child.unref();
                process.exit(0);
            }, 1000);
        }
    });
}

// 退出服务器函数
function exitServer() {
    logWithTimestamp('log', '正在关闭服务器...');
    const forceExitTimeout = setTimeout(() => {
        logWithTimestamp('error', '退出操作超时，强制退出进程');
        process.exit(1);
    }, 10000);
    try {
        if (fs.existsSync(RESTART_PROTECTION_FILE)) {
            fs.unlinkSync(RESTART_PROTECTION_FILE);
            logWithTimestamp('log', '已清理重启保护文件');
        }
    } catch (error) {
        logWithTimestamp('error', '清理重启保护文件失败:', error);
    }
    const finalExit = () => {
        clearTimeout(forceExitTimeout);
        logWithTimestamp('log', '服务器端组件已成功关闭');
        process.exit(0);
    };
    if (wss) {
        wss.close(() => {
            logWithTimestamp('log', 'WebSocket服务器已关闭');
            bot.stopPolling().finally(finalExit);
        });
    } else {
        bot.stopPolling().finally(finalExit);
    }
}

function handleSystemCommand(command, chatId) {
    logWithTimestamp('log', `执行系统命令: ${command}`);

    // 处理 ping 命令 - 返回连接状态信息
    if (command === 'ping') {
        const bridgeStatus = 'Bridge状态：已连接 ✅';
        const stStatus = sillyTavernClient && sillyTavernClient.readyState === WebSocket.OPEN ?
        'SillyTavern状态：已连接 ✅' :
        'SillyTavern状态：未连接 ❌';
    sendMessageAndTrack(chatId, `${bridgeStatus}\n${stStatus}`);
    return;
    }

    let responseMessage = '';
    switch (command) {
        case 'reload':
            responseMessage = '正在重载服务器端组件...';
            // 如果SillyTavern已连接，则执行刷新UI
            if (sillyTavernClient && sillyTavernClient.readyState === WebSocket.OPEN) {
                sillyTavernClient.commandToExecuteOnClose = { command, chatId };
                sillyTavernClient.send(JSON.stringify({ type: 'system_command', command: 'reload_ui_only', chatId }));
            } else {
                // 如果未连接，直接重载服务器
                sendMessageAndTrack(chatId, responseMessage);
                reloadServer(chatId);
            }
            break;
        case 'restart':
            responseMessage = '正在重启服务器端组件...';
            // 如果SillyTavern已连接，则执行刷新UI
            if (sillyTavernClient && sillyTavernClient.readyState === WebSocket.OPEN) {
                sillyTavernClient.commandToExecuteOnClose = { command, chatId };
                sillyTavernClient.send(JSON.stringify({ type: 'system_command', command: 'reload_ui_only', chatId }));
            } else {
                // 如果未连接，直接重启服务器
                sendMessageAndTrack(chatId, responseMessage);
                restartServer(chatId);
            }
            break;
        case 'exit':
            responseMessage = '正在关闭服务器端组件...';
            // 如果SillyTavern已连接，则执行刷新UI
            if (sillyTavernClient && sillyTavernClient.readyState === WebSocket.OPEN) {
                sillyTavernClient.commandToExecuteOnClose = { command, chatId };
                sillyTavernClient.send(JSON.stringify({ type: 'system_command', command: 'reload_ui_only', chatId }));
            } else {
                // 如果未连接，直接退出服务器
                sendMessageAndTrack(chatId, responseMessage);
                exitServer();
            }
            break;
        default:
            logWithTimestamp('warn', `未知的系统命令: ${command}`);
            sendMessageAndTrack(chatId, `未知的系统命令: /${command}`);
            return;
    }

    // 只有在SillyTavern已连接的情况下，消息才会在上面的switch语句中发送
    // 所以这里只在SillyTavern已连接时发送响应消息
    if (sillyTavernClient && sillyTavernClient.readyState === WebSocket.OPEN) {
        sendMessageAndTrack(chatId, responseMessage);
    }
}

async function handleTelegramCommand(command, args, chatId) {
    logWithTimestamp('log', `处理Telegram命令: /${command} ${args.join(' ')}`);

    // 显示"输入中"状态
    bot.sendChatAction(chatId, 'typing').catch(error =>
    logWithTimestamp('error', '发送"输入中"状态失败:', error));

    // 默认回复
    let replyText = `未知命令: /${command}。 使用 /help 查看所有命令。`;

    // 特殊处理help命令，无论SillyTavern是否连接都可以显示
    if (command === 'help') {
        replyText = `*SillyTavern Telegram Bridge Commands*\n\n` +
        `*Conversation Mode*\n` +
        `/gg - Start a conversation with the AI. Messages will be deleted after.\n` +
        `/ehd - End the conversation and delete all messages in the session.\n\n` +
        `*Chat Management*\n` +
        `/new - Start a new chat with the current character.\n` +
        `/listchats - List all saved chats for the current character.\n` +
        `/switchchat <chat_name> - Load a specific chat.\n` +
        `/switchchat_<number> - Load chat by number.\n\n` +
        `*Character Management*\n` +
        `/listchars - List all available characters.\n` +
        `/switchchar <char_name> - Switch to a specific character.\n` +
        `/switchchar_<number> - Switch character by number.\n\n` +
        `*Multiplayer Mode*\n` +
        `/d - Toggle between Immediate Mode and Buffer Mode.\n` +
        `/go - Send all buffered actions to the AI as a group turn.\n` +
        `/info - Display the current buffer contents.\n` +
        `/r - Clear the entire buffer.\n` +
        `/r <number> - Remove a specific action from the buffer.\n` +
        `/format - Show roleplay formatting guide.\n\n` +
        `*System Management*\n` +
        `/reload - Reload server components and refresh ST UI.\n` +
        `/restart - Restart server components and refresh ST UI.\n` +
        `/exit - Exit the server components.\n` +
        `/ping - Check connection status.`;

        // 发送帮助信息并返回
        sendMessageAndTrack(chatId, replyText, { parse_mode: 'Markdown' }).catch(err => {
            logWithTimestamp('error', `发送命令回复失败: ${err.message}`);
        });
        return;
    }

    const state = getOrCreateState(chatId);

    // 检查SillyTavern是否连接
    if (!sillyTavernClient || sillyTavernClient.readyState !== WebSocket.OPEN) {
        sendMessageAndTrack(chatId, 'SillyTavern未连接，无法执行角色和聊天相关命令。请先确保SillyTavern已打开并启用了Telegram扩展。');
        return;
    }

    // 根据命令类型处理
    switch (command) {
        case 'new':
            // 发送命令到前端执行
            sillyTavernClient.send(JSON.stringify({
                type: 'execute_command',
                command: 'new',
                chatId: chatId
            }));
            return; // 前端会发送响应，所以这里直接返回
        case 'listchars':
            // 发送命令到前端执行
            sillyTavernClient.send(JSON.stringify({
                type: 'execute_command',
                command: 'listchars',
                chatId: chatId
            }));
            return;
        case 'switchchar':
            if (args.length === 0) {
                replyText = '请提供角色名称或序号。用法: /switchchar <角色名称> 或 /switchchar_数字';
            } else {
                // 发送命令到前端执行
                sillyTavernClient.send(JSON.stringify({
                    type: 'execute_command',
                    command: 'switchchar',
                    args: args,
                    chatId: chatId
                }));
                return;
            }
            break;
        case 'listchats':
            // 发送命令到前端执行
            sillyTavernClient.send(JSON.stringify({
                type: 'execute_command',
                command: 'listchats',
                chatId: chatId
            }));
            return;
        case 'switchchat':
            if (args.length === 0) {
                replyText = '请提供聊天记录名称。用法： /switchchat <聊天记录名称>';
            } else {
                // 发送命令到前端执行
                sillyTavernClient.send(JSON.stringify({
                    type: 'execute_command',
                    command: 'switchchat',
                    args: args,
                    chatId: chatId
                }));
                return;
            }
            break;
        case 'd':
            state.mode = state.mode === 'immediate' ? 'buffer' : 'immediate';
            if (state.mode === 'immediate') {
                state.buffer = [];
            }
            replyText = `Mode switched to ${state.mode} mode.`;
            break;
        case 'go':
            if (state.mode !== 'buffer') {
                replyText = 'Not in buffer mode.';
            } else if (state.buffer.length === 0) {
                replyText = 'Buffer is empty.';
            } else {
                ongoingStreams.delete(chatId); // Clear previous stream session before new generation
                const fullText = state.buffer.map(b => b.text).join('\n\n');
                sillyTavernClient.send(JSON.stringify({ type: 'user_message', chatId, text: fullText }));
                state.pendingResponse = true;
                replyText = state.pendingResponse ? 'Group actions resent to AI.' : 'Group actions sent to AI.';
            }
            break;
        case 'info':
            if (state.mode !== 'buffer') {
                replyText = 'Not in buffer mode.';
            } else if (state.buffer.length === 0) {
                replyText = 'Buffer is empty.';
            } else {
                replyText = 'Current buffer contents:\n' + state.buffer.map((b, i) => `${i + 1}. ${b.username}: ${b.originalText}`).join('\n');
            }
            const sentMessage = await sendMessageAndTrack(chatId, replyText);
            if (sentMessage) {
                state.lastInfoMessageId = sentMessage.message_id;
            }
            return;
        case 'r':
            if (state.mode !== 'buffer') {
                replyText = 'Not in buffer mode.';
            } else {
                if (args.length === 0) {
                    state.buffer = [];
                } else {
                    const num = parseInt(args[0]);
                    if (isNaN(num) || num < 1 || num > state.buffer.length) {
                        replyText = 'Invalid number.';
                        sendMessageAndTrack(chatId, replyText).catch(err => {
                            logWithTimestamp('error', `发送命令回复失败: ${err.message}`);
                        });
                        return;
                    } else {
                        state.buffer.splice(num - 1, 1);
                    }
                }
                // Update the info message without notification
                let updatedReplyText;
                if (state.buffer.length === 0) {
                    updatedReplyText = 'Buffer is empty.';
                } else {
                    updatedReplyText = 'Current buffer contents:\n' + state.buffer.map((b, i) => `${i + 1}. ${b.username}: ${b.originalText}`).join('\n');
                }
                if (state.lastInfoMessageId) {
                    bot.editMessageText(updatedReplyText, {
                        chat_id: chatId,
                        message_id: state.lastInfoMessageId
                    }).catch(err => {
                        if (!err.message.includes('message is not modified')) {
                            logWithTimestamp('error', '编辑 /info 消息失败:', err.message);
                        }
                        state.lastInfoMessageId = null; // 如果失败，失效
                    });
                } else {
                    const sentMessage = await sendMessageAndTrack(chatId, updatedReplyText);
                    if (sentMessage) {
                        state.lastInfoMessageId = sentMessage.message_id;
                    }
                }
                return;
            }
            break;
        case 'format':
            replyText = 'Roleplay Formatting Guide:\n\n' +
            '- **Bold text** for strong emphasis or important elements.\n' +
            '- *Italic text* for actions, emphasis, or descriptions.\n' +
            '- "Double quotes" for direct speech or dialogue.\n' +
            '- - Dash for thoughts, internal monologue, or narrative descriptions without quotes.\n\n' +
            'Example:\n**I charge forward!**\n*I carefully open the door.*\n"Hello, everyone!"\n- I wonder what\'s behind this door...';
            break;
        default:
            // 处理特殊格式的命令，如 switchchar_1, switchchat_2 等
            const charMatch = command.match(/^switchchar_(\d+)$/);
            if (charMatch) {
                // 发送命令到前端执行
                sillyTavernClient.send(JSON.stringify({
                    type: 'execute_command',
                    command: command, // 保持原始命令格式
                    chatId: chatId
                }));
                return;
            }

            const chatMatch = command.match(/^switchchat_(\d+)$/);
            if (chatMatch) {
                // 发送命令到前端执行
                sillyTavernClient.send(JSON.stringify({
                    type: 'execute_command',
                    command: command, // 保持原始命令格式
                    chatId: chatId
                }));
                return;
            }
    }

    // 发送回复
    sendMessageAndTrack(chatId, replyText).catch(err => {
        logWithTimestamp('error', `发送命令回复失败: ${err.message}`);
    });
}

// --- WebSocket服务器逻辑 ---
wss.on('connection', ws => {
    logWithTimestamp('log', 'SillyTavern扩展已连接！');
    sillyTavernClient = ws;

    ws.on('message', async (message) => { // 将整个回调设为async
        let data; // 在 try 块外部声明 data
        try {
            data = JSON.parse(message);

            // --- 处理流式文本块 ---
            if (data.type === 'stream_chunk' && data.chatId) {
                let session = ongoingStreams.get(data.chatId);

                // 1. 如果会话不存在，立即同步创建一个占位会话，创建会话和messagePromise
                if (!session) {
                    // 使用let声明，以便在Promise内部访问
                    let resolveMessagePromise;
                    const messagePromise = new Promise(resolve => {
                        resolveMessagePromise = resolve;
                    });

                    session = {
                        messagePromise: messagePromise,
                        lastText: data.text,
                        timer: null,
                        isEditing: false, // 新增状态锁
                    };
                    ongoingStreams.set(data.chatId, session);

                    // 异步发送第一条消息并更新 session
                    sendMessageAndTrack(data.chatId, '正在思考...')
                    .then(sentMessage => {
                        // 当消息发送成功时，解析Promise并传入messageId
                        resolveMessagePromise(sentMessage.message_id);
                    }).catch(err => {
                        logWithTimestamp('error', '发送初始Telegram消息失败:', err);
                        ongoingStreams.delete(data.chatId); // 出错时清理
                    });
                } else {
                    // 2. 如果会话存在，只更新最新文本
                    session.lastText = data.text;
                }

                // 3. 尝试触发一次编辑（节流保护）
                // 确保 messageId 已经获取到，并且当前没有正在进行的编辑或定时器
                // 使用 await messagePromise 来确保messageId可用
                const messageId = await session.messagePromise;

                if (messageId && !session.isEditing && !session.timer) {
                    session.timer = setTimeout(async () => { // 定时器回调也设为async
                        const currentSession = ongoingStreams.get(data.chatId);
                        if (currentSession) {
                            const currentMessageId = await currentSession.messagePromise;
                            if (currentMessageId) {
                                currentSession.isEditing = true;
                                bot.editMessageText(currentSession.lastText, {
                                    chat_id: data.chatId,
                                    message_id: currentMessageId,
                                }).catch(err => {
                                    if (!err.message.includes('message is not modified'))
                                        logWithTimestamp('error', '编辑Telegram消息失败:', err.message);
                                }).finally(() => {
                                    if (ongoingStreams.has(data.chatId)) ongoingStreams.get(data.chatId).isEditing = false;
                                });
                            }
                            currentSession.timer = null;
                        }
                    }, 2000);
                }
                return;
            }

            // --- 处理流式结束信号 ---
            if (data.type === 'stream_end' && data.chatId) {
                const session = ongoingStreams.get(data.chatId);
                // 只有当存在会话时才处理，这表明确实是流式传输
                if (session) {
                    if (session.timer) {
                        clearTimeout(session.timer);
                    }
                    logWithTimestamp('log', `收到流式结束信号，等待最终渲染文本更新...`);
                    // 注意：我们不在这里清理会话，而是等待final_message_update
                }
                // 如果不存在会话但收到stream_end，这是一个异常情况
                // 可能是由于某些原因会话被提前清理了
                else {
                    logWithTimestamp('warn', `收到流式结束信号，但找不到对应的会话 ChatID ${data.chatId}`);
                    // 为安全起见，我们仍然发送消息，但这种情况不应该发生
                    await sendMessageAndTrack(data.chatId, data.text || "消息生成完成").catch(err => {
                        logWithTimestamp('error', '发送流式结束消息失败:', err.message);
                    });
                }
                return;
            }

            // --- 处理最终渲染后的消息更新 ---
            if (data.type === 'final_message_update' && data.chatId) {
                const session = ongoingStreams.get(data.chatId);

                // 如果会话存在，说明是流式传输的最终更新
                if (session) {
                    // 使用 await messagePromise
                    const messageId = await session.messagePromise;
                    if (messageId) {
                        logWithTimestamp('log', `收到流式最终渲染文本，更新消息 ${messageId}`);
                        await bot.editMessageText(config.aiPrefix + data.text, {
                            chat_id: data.chatId,
                            message_id: messageId,
                            // 可选：在这里指定 parse_mode: 'MarkdownV2' 或 'HTML'
                            // parse_mode: 'HTML',
                        }).catch(err => {
                            if (!err.message.includes('message is not modified'))
                                logWithTimestamp('error', '编辑最终格式化Telegram消息失败:', err.message);
                        });
                        logWithTimestamp('log', `ChatID ${data.chatId} 的流式传输准最终更新已发送。`);
                    } else {
                        logWithTimestamp('warn', `收到final_message_update，但流式会话的messageId未能获取。`);
                    }
                    // 清理流式会话
                    ongoingStreams.delete(data.chatId);
                    logWithTimestamp('log', `ChatID ${data.chatId} 的流式会话已完成并清理。`);
                }
                // 如果会话不存在，说明这是一个完整的非流式回复
                // 注意：这种情况不应该发生，因为我们已经在客户端修复了这个问题
                // 但为了健壮性，我们仍然保留这个处理
                else {
                    logWithTimestamp('log', `收到非流式完整回复，直接发送新消息到 ChatID ${data.chatId}`);
                    await sendMessageAndTrack(data.chatId, config.aiPrefix + data.text, {
                        // 可选：在这里指定 parse_mode
                    }).catch(err => {
                        logWithTimestamp('error', '发送非流式完整回复失败:', err.message);
                    });
                }
                // Clear buffer on successful response
                const state = getOrCreateState(data.chatId);
                if (data.text && data.text.trim() !== '') {
                    state.buffer = [];
                    state.pendingResponse = false;
                }
                return;
            }

            // --- 其他消息处理逻辑 ---
            if (data.type === 'error_message' && data.chatId) {
                logWithTimestamp('error', `收到SillyTavern的错误报告，将发送至Telegram用户 ${data.chatId}: ${data.text}`);
                sendMessageAndTrack(data.chatId, data.text);
            } else if (data.type === 'ai_reply' && data.chatId) {
                logWithTimestamp('log', `收到非流式AI回复，发送至Telegram用户 ${data.chatId}`);
                // 确保在发送消息前清理可能存在的流式会话
                if (ongoingStreams.has(data.chatId)) {
                    logWithTimestamp('log', `清理 ChatID ${data.chatId} 的流式会话，因为收到了非流式回复`);
                    ongoingStreams.delete(data.chatId);
                }
                // 发送非流式回复
                await sendMessageAndTrack(data.chatId, config.aiPrefix + data.text).catch(err => {
                    logWithTimestamp('error', `发送非流式AI回复失败: ${err.message}`);
                });
                // Clear buffer on successful response
                const state = getOrCreateState(data.chatId);
                if (data.text && data.text.trim() !== '') {
                    state.buffer = [];
                    state.pendingResponse = false;
                }
            } else if (data.type === 'typing_action' && data.chatId) {
                logWithTimestamp('log', `显示"输入中"状态给Telegram用户 ${data.chatId}`);
                bot.sendChatAction(data.chatId, 'typing').catch(error =>
                logWithTimestamp('error', '发送"输入中"状态失败:', error));
            } else if (data.type === 'command_executed') {
                // 处理前端命令执行结果
                logWithTimestamp('log', `命令 ${data.command} 执行完成，结果: ${data.success ? '成功' : '失败'}`);
                if (data.message) {
                    logWithTimestamp('log', `命令执行消息: ${data.message}`);
                }
            }
        } catch (error) {
            logWithTimestamp('error', '处理SillyTavern消息时出错:', error);
            // 确保即使在解析JSON失败时也能清理
            if (data && data.chatId) {
                ongoingStreams.delete(data.chatId);
            }
        }
    });

    ws.on('close', () => {
        logWithTimestamp('log', 'SillyTavern扩展已断开连接。');
        if (ws.commandToExecuteOnClose) {
            const { command, chatId } = ws.commandToExecuteOnClose;
            logWithTimestamp('log', `客户端断开连接，现在执行预定命令: ${command}`);
            if (command === 'reload') reloadServer(chatId);
            if (command === 'restart') restartServer(chatId);
            if (command === 'exit') exitServer(chatId);
        }
        sillyTavernClient = null;
        ongoingStreams.clear();
    });

    ws.on('error', (error) => {
        logWithTimestamp('error', 'WebSocket发生错误:', error);
        if (sillyTavernClient) {
            sillyTavernClient.commandToExecuteOnClose = null; // 清除标记，防止意外执行
        }
        sillyTavernClient = null;
        ongoingStreams.clear();
    });
});

// 检查是否需要发送重启完成通知
if (process.env.RESTART_NOTIFY_CHATID) {
    const chatId = parseInt(process.env.RESTART_NOTIFY_CHATID);
    if (!isNaN(chatId)) {
        setTimeout(() => {
            sendMessageAndTrack(chatId, '服务器端组件已成功重启并准备就绪')
            .catch(err => logWithTimestamp('error', '发送重启通知失败:', err))
            .finally(() => {
                delete process.env.RESTART_NOTIFY_CHATID;
            });
        }, 2000);
    }
}

// 监听Telegram消息
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name || 'Unknown';

    // 检查白名单是否已配置且不为空
    if (config.allowedUserIds && config.allowedUserIds.length > 0) {
        // 如果当前用户的ID不在白名单中
        if (!config.allowedUserIds.includes(userId)) {
            logWithTimestamp('log', `拒绝了来自非白名单用户的访问：\n  - User ID: ${userId}\n  - Username: @${username}\n  - Chat ID: ${chatId}\n  - Message: "${text}"`);
            // 向该用户发送一条拒绝消息
            bot.sendMessage(chatId, '抱歉，您无权使用此机器人。').catch(err => {
                logWithTimestamp('error', `向 ${chatId} 发送拒绝消息失败:`, err.message);
            });
            // 终止后续处理
            return;
        }
    }

    if (!text) return;

    const convoState = getOrCreateConversationState(chatId);

    if (text.startsWith('/')) {
        const parts = text.slice(1).trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        // Handle conversation mode commands
        if (command === 'gg') {
            if (convoState.isActive) {
                await sendMessageAndTrack(chatId, 'Conversation mode is already active.');
            } else {
                convoState.isActive = true;
                convoState.messagesToDelete = [msg.message_id]; // Start tracking with the command message itself
                logWithTimestamp('log', `Conversation mode activated for chat ${chatId}`);
                await sendMessageAndTrack(chatId, 'Conversation mode activated. You can now chat with the AI. Use /ehd to end and clean up.');
            }
            return;
        }

        if (command === 'ehd') {
            if (!convoState.isActive) {
                await sendMessageAndTrack(chatId, 'Conversation mode is not active.');
            } else {
                logWithTimestamp('log', `Conversation mode deactivating for chat ${chatId}. Cleaning up ${convoState.messagesToDelete.length} messages.`);
                convoState.messagesToDelete.push(msg.message_id); // Track the /ehd command itself

                const notification = await sendMessageAndTrack(chatId, 'Cleanup started...');
                convoState.messagesToDelete.push(notification.message_id); // Track the notification

                const messageIds = [...convoState.messagesToDelete]; // Create a copy
                let deletedCount = 0;
                let failedCount = 0;

                for (const messageId of messageIds) {
                    try {
                        await bot.deleteMessage(chatId, messageId);
                        deletedCount++;
                    } catch (error) {
                        failedCount++;
                        logWithTimestamp('warn', `Could not delete message ${messageId} in chat ${chatId}: ${error.message}`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 50));
                }

                logWithTimestamp('log', `Cleanup for chat ${chatId} complete. Deleted: ${deletedCount}, Failed: ${failedCount}.`);

                // Reset state
                convoState.isActive = false;
                convoState.messagesToDelete = [];
            }
            return;
        }

        // If conversation mode is active, track the command message
        if (convoState.isActive) {
            convoState.messagesToDelete.push(msg.message_id);
        }

        // 系统命令由服务器直接处理
        if (['reload', 'restart', 'exit', 'ping'].includes(command)) {
            handleSystemCommand(command, chatId);
            return;
        }

        // 其他命令也由服务器处理，但可能需要前端执行
        handleTelegramCommand(command, args, chatId);
        return;
    }

    // Only process non-command messages if conversation mode is active
    if (!convoState.isActive) {
        return; // Ignore message if not in conversation mode
    }

    // If we are here, conversation mode is active. Track the user's message.
    convoState.messagesToDelete.push(msg.message_id);

    // 处理普通消息
    if (sillyTavernClient && sillyTavernClient.readyState === WebSocket.OPEN) {
        logWithTimestamp('log', `从Telegram用户 ${chatId} 收到消息: "${text}"`);
        const prefixedText = config.prefix.replace('{username}', username) + text;
        const state = getOrCreateState(chatId);
        if (state.mode === 'immediate') {
            ongoingStreams.delete(chatId); // Clear previous stream session before new generation
            const payload = JSON.stringify({ type: 'user_message', chatId, text: prefixedText });
            sillyTavernClient.send(payload);
        } else {
            state.buffer.push({
                text: prefixedText,
                originalText: text,
                username: username,
                messageId: msg.message_id
            });
        }
    } else {
        logWithTimestamp('warn', '收到Telegram消息，但SillyTavern扩展未连接。');
        sendMessageAndTrack(chatId, '抱歉，我现在无法连接到SillyTavern。请确保SillyTavern已打开并启用了Telegram扩展。');
    }
});

// Handle edited messages for buffer updates
bot.on('edited_message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text) return;
    const messageId = msg.message_id;
    const username = msg.from.username || msg.from.first_name || 'Unknown';
    const state = getOrCreateState(chatId);
    if (state.mode === 'buffer') {
        const index = state.buffer.findIndex(b => b.messageId === messageId);
        if (index !== -1) {
            state.buffer[index].originalText = text;
            state.buffer[index].text = config.prefix.replace('{username}', username) + text;
            if (state.lastInfoMessageId) {
                let replyText;
                if (state.buffer.length === 0) {
                    replyText = 'Buffer is empty.';
                } else {
                    replyText = 'Current buffer contents:\n' + state.buffer.map((b, i) => `${i + 1}. ${b.username}: ${b.originalText}`).join('\n');
                }
                bot.editMessageText(replyText, {
                    chat_id: chatId,
                    message_id: state.lastInfoMessageId
                }).catch(err => {
                    if (!err.message.includes('message is not modified')) {
                        logWithTimestamp('error', '编辑 /info 消息失败:', err.message);
                    }
                    state.lastInfoMessageId = null; // 如果失败，失效
                });
            }
        }
    }
});
