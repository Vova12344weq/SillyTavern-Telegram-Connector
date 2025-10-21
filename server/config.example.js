// config.js
// Reference configuration file for the advanced version of server.js

module.exports = {
    // --- KEY SETTINGS ---

    // 1. YOUR BOT SECRET TOKEN
    // Insert your current token obtained from @BotFather here.
    // NEVER share this token with anyone.
    telegramToken: '',

    // 2. YOUR TELEGRAM GROUP ID
    // Make sure this is the ID of the group where the game will take place.
    // Group chat IDs usually start with "-".
    chatId: -, // Replace with your group ID

    // 3. WebSocket port (usually can be left as is)
    wssPort: 2333,

    // --- PREFIX SETTINGS (VERY IMPORTANT) ---

    // 4. Prefix format for players from Telegram.
    // Using the most reliable "armor-piercing" option with angle brackets.
    prefix: '<{username}>: ',

    // 5. Prefix format for messages sent from SillyTavern (if needed).
    // Keep a consistent style for maximum predictability.
    hostPrefix: '<User>: ',

    // 6. Prefix for AI responses (LEAVE EMPTY!)
    // AI will generate its own prefix (e.g., "Character: ...").
    aiPrefix: '',

    // 7. Forward messages from SillyTavern to Telegram?
    forwardHostMessages: true,

    // 8. Language (for possible system messages)
    language: 'us',

    // --- SECURITY SETTINGS ---

    // 9. List of allowed users (IDs).
    // Currently empty, which means "allow everyone".
    // For security, it's recommended to add the numeric IDs of all players here.
    // Example: allowedUserIds: [12345678, 87654321, 374616460],
    allowedUserIds: [], // <-- LIST CLEARED, ACCESS GRANTED TO ALL
};
