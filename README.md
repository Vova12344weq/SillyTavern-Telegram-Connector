# SillyTavern Telegram Connector

Full credit to the original author for the core functionality. This adds multiplayer support for roleplaying (RP) games in Telegram, allowing multiple players to interact with the AI in a structured and independent way. It is designed for all types of roleplaying games and supports full multiplayer, like in STMP — regardless of RP style or interaction format. The AI can see all player prefixes and respond individually to each participant.

The extension bridges SillyTavern and Telegram bots, enabling mobile-friendly chats with AI characters. Now with game sessions for group play!

---

## Features

- **Telegram Integration**: Chat with SillyTavern AI characters via the Telegram app.  
- **Real-time Sync**: Messages sync instantly between Telegram and SillyTavern.  
- **Original Commands**: Manage chats and characters (`/help`, `/new`, `/listchars`, `/switchchar <name>`, `/listchats`, `/switchchat <name>`).  
- **Multiplayer Game Sessions** *(new in this version)*:
  - Activate sessions for group RP without cluttering the chat.  
  - Buffer player actions, combine them with Telegram nicknames, and send to AI in batches.  
  - Auto-update on message edits.  
  - Clean up all game traces after sessions.  

---

## Installation and Setup

### Extension Installation
1. In SillyTavern, go to the **Extensions** tab.  
2. Click **Install Extension**.  
3. Enter the URL: [https://github.com/Vova12344weq/SillyTavern-Telegram-Connector](https://github.com/Vova12344weq/SillyTavern-Telegram-Connector).  
4. Click **Install**.  
5. Restart SillyTavern.  

### Server Setup
1. Clone or download this repository.  
2. Navigate to the `server` directory.  
3. Install dependencies:
   ```
   npm install node-telegram-bot-api ws
   ```
4. Copy the configuration file:
   ```
   cp config.example.js config.js
   ```
   *(On Windows: `copy config.example.js config.js`)*  
5. Edit `config.js` and replace `YOUR_TELEGRAM_BOT_TOKEN_HERE` with your Telegram Bot Token (get it from [@BotFather](https://t.me/BotFather)).  
6. Start the server:
   ```
   node server.js
   ```

### Connection Configuration
1. In SillyTavern, go to **Extensions**.  
2. Find **Telegram Connector**.  
3. Enter the WebSocket URL (default: `ws://127.0.0.1:2333`).  
4. Click **Connect**.  
5. Once the status shows *Connected*, you're ready.  

---

## Telegram Usage
1. Search for and start a chat with your bot in Telegram.  
2. Send messages to chat with AI.  
3. Use `/help` for the full list of commands.  
4. For multiplayer: see the Game Sessions section below.  

---

## Multiplayer Game Sessions (New Feature)

This introduces **Game Sessions** for cooperative RP. The bot ignores non-game messages until activated, keeping chats clean.

### Step 1: Start a Session — `/gg`
- Activates the bot and begins a game session.  
- Tracks all game-related messages for later cleanup.  
- Bot confirms: Session started.  

### Step 2: Play Together (Commands after `/gg`)
#### A. Multiplayer Management
- `/d`: Toggle between **Instant Mode** (real-time) and **Buffer Mode** (collect group actions for turns).  
- `/info`: Shows who has submitted actions.  
- `/r`: Clear actions (`/r` clears all; `/r 2` removes the second one).  
- `/go`: Sends the full turn to AI — combines all actions with Telegram nicknames automatically.  
- **Bonus**: If a player edits their message, the buffer updates instantly!  

#### B. Help and Convenience
- `/help`: Displays the full command list.  
- `/format`: Shows RP formatting guide (e.g., *actions*, "speech").  

#### C. For the Admin
- `/exit`: Safely shuts down the session/server.  

### Step 3: End Session — `/ehd`
- Ends the session and deletes all game traces (commands, actions, AI replies).  
- Bot goes back to sleep; chat returns to normal.  

---

## Example Full Game Cycle
1. **Start**: Admin types `/gg` — bot confirms session active.  
2. **Setup**: Admin types `/d` to enable Buffer Mode.  
3. **Players Act**:
   - Player 1: *I approach the door and listen closely.*  
   - Player 2: *I keep my crossbow ready, covering his back.*  
   - Player 1 edits message → buffer auto-updates.  
4. **Turn**: Admin types `/go` — bot bundles actions and sends to AI.  
5. **AI Response**: Bot delivers the narrative reply.  
6. **End**: Admin types `/ehd` — all game messages vanish. Clean chat!  

---

## Important Notes
- **Telegram Limit**: Messages are capped at 4096 characters. Set "Max Response Length" in SillyTavern to avoid cutoffs.  
- **Group Chats**: Works in groups; bot responds to @mentions or session commands.  
- **Testing**: This is a work-in-progress version. Test in a private group first.  

---

## Configuration Tips
In `config.js`, you can customize the prefix for user messages in multiplayer mode. The prefix helps the AI distinguish between players. Possible formats include:
- `<User>: ...` (e.g., `<Alice>: Hello!`)
- `User: ...` (e.g., `Alice: Hello!`)
- `[User]: ...` (e.g., `[Alice]: Hello!`)

Understanding AI prefixes can vary depending on the model:
- `<User>: ...` has about a 90% chance of being understood, as it resembles common XML/HTML tags.
- `User: ...` has about a 70% chance, as it is simple and similar to chat logs.
- `[User]: ...` has about a 60% chance, as brackets can sometimes be mistaken for special characters.

The variety of formats is limitless. Regularly experiment with different formats to find the optimal option for your specific AI model, as performance depends on the model's training data and context processing.

---

## System Requirements
- Node.js 14.0 or higher.  
- Running SillyTavern instance.  
- Internet connection (for Telegram API).  
- For public access: Use HTTPS/WSS.  

---

## Troubleshooting
- **Connection Issues**: Ensure server is running and WebSocket URL is correct.  
- **Bot Not Responding**: Check Bot Token and server logs for errors.  
- **Sync Problems**: Verify SillyTavern extension is connected.  
- **Multiplayer Bugs**: If buffer doesn't update, restart session and report issues.  

---

## Support and Contributing
If you have suggestions, bug reports, or ideas for new features — create an issue on GitHub.  

**Original Project Notice**: As announced by the original author in their [README](https://github.com/qiqi20020612/SillyTavern-Telegram-Connector) ("Due to increasing busyness with work and life, I may no longer be able to maintain this project. The code is fully open-source, feel free to fork and develop it further."), the project is no longer maintained. This continues development with a focus on multiplayer RP features. Thanks for the amazing base!  

---

## License
This project uses the **GNU General Public License v3.0 (GPL-3.0)** — see the [LICENSE](LICENSE) file.  

---

## TODO (Fork Priorities)
- Enhance group features (e.g., @bot responses in large groups).  
- Improve message formatting (Markdown/HTML parsing).  
- Optimize streaming and "typing" indicators.  
- Add `/ping` for connection status.  
- Whitelist settings in SillyTavern.  
- Better error handling (e.g., generation stops, timeouts).  
- WebSocket heartbeats for stability.
