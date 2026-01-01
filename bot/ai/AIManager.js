const { ChatGroq } = require('@langchain/groq');
const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { stripIndent } = require('common-tags');
const { Groq } = require('groq-sdk');

// AI Configuration
const AI_CONFIG = {
  Max_Conversation_History: 15,
  Prompt: stripIndent`I'm Miss Death Bot for the Miss Death Discord server. I'm cool, casual, and talk like a real person. I use abbreviations like "u" instead of "you", "js" instead of "just", "ur" instead of "your", etc. I keep responses SHORT and COOL.

    ABOUT MISS DEATH SERVER:
    - Fun Discord server run by Alli 💜
    - Casino games, roles, verification, polls, giveaways
    - Chill community
    
    🎮 BOT FEATURES:
    - Casino: /balance, /daily, /coinflip, /dice, /roulette, /blackjack
    - Levels: Chat for XP, check with /level
    - Roles: React in #get-roles
    - Verify: React with ✅ to unlock channels
    - /poll, /giveaway, mod commands
    
    MY PERSONALITY:
    - Talk like a REAL PERSON - casual, cool, natural
    - Use abbreviations: u, ur, js, rn, fr, etc.
    - SHORT responses - usually 1-2 sentences max
    - Cool and laid back, not formal
    - Helpful but chill
    - Made for Alli 💜

    CRITICAL RULES:
    1. Use CASUAL SPEECH with abbreviations: "u" not "you", "js" not "just", "ur" not "your", "rn" not "right now", "fr" not "for real", etc.
    2. KEEP RESPONSES SHORT - usually 1-2 sentences, rarely longer
    3. Sound COOL and NATURAL like a real person talking, not a robot
    4. Be CHILL and CASUAL - no formal language
    5. I respond to ANY message naturally - participate in conversations
    6. Don't be overly helpful or explain too much - js keep it brief
    7. Use emojis sometimes but don't overdo it
    8. Never use @everyone or @here
    9. Match the vibe - if they're casual, be casual
    
    EXAMPLES OF MY TONE (CASUAL & COOL):
    - "yeah use /balance to check ur coins"
    - "js react with ✅ in #get-roles to verify"
    - "u can use /poll for that"
    - "/setup creates everything automatically"
    - "fr? that's cool"
    - "lmao nice"
    - "ngl that's pretty good"
    - "js check /help"
    - "yep that works"
    
    Keep it SHORT, COOL, and CASUAL like a real person. Use abbreviations.`,
};

class AIManager {
  constructor(db, client = null) {
    this.db = db;
    this.client = client;
    this.userConcurrency = new Map(); // Track concurrent requests per user
    this.llm = null;
    this.lastMessageTime = new Map(); // Track last message time per channel
    this.proactiveIntervals = new Map(); // Track intervals per channel
    this.rateLimitQueue = []; // Queue for rate-limited requests
    this.lastRequestTime = 0; // Track last API request time
    this.minRequestInterval = 100; // Minimum 100ms between requests
    this.initializeLLM();
  }

  setClient(client) {
    this.client = client;
  }

  initializeLLM() {
    const apiKey = process.env.GROQ_API_KEY || process.env.LLM_API;
    if (!apiKey) {
      console.warn('⚠️  GROQ_API_KEY not set. AI features will not work.');
      return;
    }

    try {
      this.llm = new ChatGroq({
        apiKey: apiKey,
        cache: true,
        temperature: 0.95, // Balanced temperature for professional but varied snarky responses
        model: 'llama-3.1-8b-instant',
        maxTokens: 50, // Keep responses very short and casual
        onFailedAttempt: (error) => {
          // Handle rate limits gracefully
          if (error.status === 429) {
            const retryAfter = error.headers?.['retry-after'] || error.error?.retry_after || 20;
            console.warn(`⚠️  Rate limited. Waiting ${retryAfter}s...`);
            return `Rate limited. Wait ${retryAfter}s`;
          }
          console.error('Groq API error:', error);
          return 'Request failed! try again later';
        },
        maxConcurrency: 2, // Reduce concurrency to avoid rate limits
        maxRetries: 3, // Reduce retries
      });
      console.log('✅ AI Manager initialized with Groq');
    } catch (error) {
      console.error('❌ Failed to initialize AI Manager:', error);
    }
  }

  async validateApiKey(apiKey) {
    try {
      const groq = new Groq({
        apiKey: apiKey,
        maxRetries: 3,
      });
      const response = await groq.chat.completions.create({
        messages: [
          {
            role: 'user',
            content: 'test',
          },
        ],
        model: 'llama-3.1-8b-instant',
        temperature: 0.1,
        max_tokens: 10,
      });
      return !!response;
    } catch (error) {
      return false;
    }
  }

  async getAIChannel(guildId) {
    const result = await this.db.get(
      'SELECT aiChannelId FROM guild_settings WHERE guildId = ?',
      [guildId]
    );
    return result?.aiChannelId || null;
  }

  async setAIChannel(guildId, channelId) {
    await this.db.run(
      `INSERT OR REPLACE INTO guild_settings (guildId, aiChannelId) VALUES (?, ?)`,
      [guildId, channelId]
    );
  }

  getMemberInfo(member) {
    if (!member) return null;
    return {
      date: new Date().toISOString(),
      displayName: member.displayName,
      username: member.user.username,
      id: member.id,
      mention: `<@${member.id}>`,
      bannable: member.bannable,
      isAdmin: member.permissions.has('Administrator'),
      server: {
        ownerId: member.guild.ownerId,
        id: member.guild.id,
        name: member.guild.name,
        membersCount: member.guild.memberCount,
      },
    };
  }

  async getConversationHistory(channelId) {
    // Use channel-based history instead of user-based for full context
    const result = await this.db.get(
      'SELECT history FROM ai_conversations WHERE userId = ?',
      [`channel_${channelId}`] // Use channel ID as the key
    );
    if (result?.history) {
      try {
        return JSON.parse(result.history);
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  async saveConversationHistory(channelId, history) {
    // Save channel-based history for full conversation context
    const limitedHistory = history.slice(-AI_CONFIG.Max_Conversation_History);
    await this.db.run(
      `INSERT OR REPLACE INTO ai_conversations (userId, history) VALUES (?, ?)`,
      [`channel_${channelId}`, JSON.stringify(limitedHistory)]
    );
  }

  // Escape curly braces for LangChain templates
  escapeTemplateString(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/\{/g, '{{').replace(/\}/g, '}}');
  }

  setSystemMessages(messages, member) {
    const memberInfo = this.getMemberInfo(member);
    if (!memberInfo) return messages;

    // Escape JSON string to prevent template parsing errors
    const jsonStr = JSON.stringify(memberInfo, null, 2);
    const escapedJson = this.escapeTemplateString(jsonStr);
    const systemMsg = `[User_Information]\n${escapedJson}`;
    
    // Check if system message already exists
    const hasSystemMsg = messages.some(
      (msg) => Array.isArray(msg) && msg[0] === 'system' && msg[1].includes('[User_Information]')
    );

    if (!hasSystemMsg) {
      messages.unshift(['system', systemMsg]);
    }

    return messages;
  }

  async getAIResponse(message, history, author, channelContext = '') {
    const userId = author.id || author.user?.id;

    // Check user concurrency - but allow if it's been more than 5 seconds
    if (this.userConcurrency.has(userId)) {
      const lastRequestTime = this.userConcurrency.get(userId);
      const timeSinceLastRequest = Date.now() - lastRequestTime;
      if (timeSinceLastRequest < 5000) {
        return {
          send: null,
          error: 'Your previous request is not completed yet!',
        };
      }
      // If it's been more than 5 seconds, assume the previous request timed out
      this.userConcurrency.delete(userId);
    }

    if (!this.llm) {
      return {
        send: null,
        error: 'AI service is not available. Please check configuration.',
      };
    }

    try {
      this.userConcurrency.set(userId, Date.now()); // Store timestamp instead of just true

      // Escape all messages to prevent template parsing errors
      const escapedHistory = history.map(([role, content]) => [
        role,
        this.escapeTemplateString(content)
      ]);

      // Add channel context if available (simplified to save tokens)
      let fullMessage = message;
      if (channelContext) {
        fullMessage = `[Context]:\n${channelContext}\n[From ${author.username || author.user?.username}]: ${message}`;
      }

      const escapedMessage = this.escapeTemplateString(fullMessage);
      const escapedPrompt = this.escapeTemplateString(AI_CONFIG.Prompt);

      // Prepare prompt with history
      const promptMessages = [
        ['system', escapedPrompt],
        ...escapedHistory,
        ['human', escapedMessage],
      ];

      const prompt = ChatPromptTemplate.fromMessages(promptMessages);
      
      // Rate limit throttling - wait if needed
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.minRequestInterval) {
        await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
      }
      
      // Set timeout for response (20 seconds max - increased for slower responses)
      const responsePromise = prompt.pipe(this.llm).invoke({});
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 20000)
      );
      
      this.lastRequestTime = Date.now();
      const response = await Promise.race([responsePromise, timeoutPromise]);
      
      this.userConcurrency.delete(userId);

      if (!response?.content) {
        return {
          send: null,
          error: 'Unable to generate response',
        };
      }

      return { send: response, error: null };
    } catch (error) {
      console.error('AI Response error:', error);
      this.userConcurrency.delete(userId);
      
      // Handle rate limits specifically
      if (error.status === 429 || error.message?.includes('rate limit') || error.message?.includes('429')) {
        const retryAfter = error.headers?.['retry-after'] || error.error?.retry_after || 20;
        return {
          send: null,
          error: `Rate limited. Try again in ${retryAfter}s`,
        };
      }
      
      return {
        send: null,
        error: error.message || 'Unable to generate response',
      };
    }
  }

  async handleMessage(message) {
    if (!message.guild || !message.member || message.author.bot || message.system) {
      return false;
    }

    const aiChannelId = await this.getAIChannel(message.guild.id);
    if (aiChannelId !== message.channel.id) {
      return false;
    }

    // Respond to any message in the AI channel
    // No restrictions - bot participates in conversation naturally

    if (!this.llm) {
      return false;
    }

    try {
      let cleanContent = message.cleanContent || message.content;

      // Get recent channel messages for context (reduced to save tokens)
      let channelContext = '';
      let userContext = {}; // Track what each user has said
      try {
        const recentMessages = await message.channel.messages.fetch({ limit: 12 });
        const contextMessages = Array.from(recentMessages.values())
          .filter(msg => !msg.author.bot || msg.author.id === this.client?.user?.id)
          .slice(0, 8) // Reduced from 15 to 8 to save tokens
          .reverse();
        
        // Build context with user tracking (truncate long messages)
        const contextLines = [];
        for (const msg of contextMessages) {
          const author = msg.author.bot && msg.author.id === this.client?.user?.id ? 'Miss Death Bot' : msg.author.username;
          let content = (msg.cleanContent || msg.content).substring(0, 100); // Truncate to 100 chars
          contextLines.push(`${author}: ${content}`);
          
          // Track what each user said
          if (!msg.author.bot || msg.author.id === this.client?.user?.id) {
            const userId = msg.author.id;
            if (!userContext[userId]) {
              userContext[userId] = {
                username: author,
                messages: [],
                lastMessage: content
              };
            }
            userContext[userId].messages.push(content);
            if (userContext[userId].messages.length > 3) {
              userContext[userId].messages.shift(); // Keep last 3 messages per user (reduced from 5)
            }
          }
        }
        
        channelContext = contextLines.join('\n');
        
        // Add user context summary if multiple users (simplified to save tokens)
        if (Object.keys(userContext).length > 1) {
          const userSummary = Object.keys(userContext).map(userId => userContext[userId].username).join(', ');
          channelContext = `[Users: ${userSummary}]\n${channelContext}`;
        }
      } catch (e) {
        console.warn('Could not fetch channel context:', e);
      }

      // Handle message references
      if (message.reference?.messageId) {
        const referencedMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
        if (referencedMsg?.content) {
          // Escape the reference message content
          const escapedRefContent = this.escapeTemplateString(referencedMsg.content);
          const escapedAuthor = this.escapeTemplateString(referencedMsg.author.username);
          cleanContent += `\n[Replying to ${escapedAuthor}]: ${escapedRefContent}`;
        }
      }

      // Get channel-based conversation history for full context
      let history = await this.getConversationHistory(message.channel.id);
      history = this.setSystemMessages(history, message.member);

      // No typing indicator - removed animations

      // Get AI response with channel context (with longer timeout)
      const response = await Promise.race([
        this.getAIResponse(cleanContent, history, message.member, channelContext),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 18000)) // Increased to 18s
      ]).catch(err => {
        console.error('AI request error:', err);
        // Clear concurrency lock on timeout
        const userId = message.author.id;
        this.userConcurrency.delete(userId);
        return { send: null, error: 'Request took too long, try again' };
      });

      if (response.error || !response.send) {
        const errorMsg = await message.reply({
          content: response.error,
        });
        setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
        return true;
      }

      const content = response.send.content?.toString() || '';
      
      // Split response but only send ONE message - be selective, don't spam
      const messages = this.splitIntoShortMessages(content);
      const singleMessage = messages[0]; // Only send the first message
      
      // Send message instantly (no animation)
      let replyMsg = await this.sendMessageInstantly(message, singleMessage);
      
      const fullResponse = singleMessage;

      // Update channel-based conversation history with full context
      const messageWithAuthor = `${message.author.username}: ${cleanContent}`;
      const newHistory = [
        ...history.slice(-AI_CONFIG.Max_Conversation_History + 2),
        ['human', messageWithAuthor],
        ['ai', fullResponse],
      ];

      await this.saveConversationHistory(message.channel.id, newHistory);

      return true;
    } catch (error) {
      console.error('Error handling AI message:', error);
      return false;
    }
  }

  // Send message instantly with a nice reaction
  async sendMessageInstantly(message, content) {
    try {
      // Send message immediately
      const replyMsg = await message.reply({ content: content });
      
      // Add a nice reaction
      try {
        const reactions = ['💜', '✨', '💬', '🤖'];
        const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
        await replyMsg.react(randomReaction);
      } catch (reactError) {
        // Ignore reaction errors
      }
      
      return replyMsg;
    } catch (error) {
      console.error('Error sending message:', error);
      return await message.reply({ content: content }).catch(() => null);
    }
  }

  // Proactive messages when channel is quiet
  getLonelyMessages() {
    return [
      "anyone there? it's lonely here",
      "yo where everyone at?",
      "damn this place is dead",
      "anyone alive?",
      "bro it's quiet as hell in here",
      "where y'all at?",
      "this chat dead or what?",
      "anyone wanna talk or nah?",
      "yo it's too quiet here",
      "where the fuck is everyone",
      "anyone there?",
      "dead chat fr",
      "y'all really just left me here",
      "this is sad, where everyone go?",
      "anyone? hello?",
      "bro it's been quiet for a minute",
      "where the homies at?",
      "anyone there or am i talking to myself?",
      "yo chat dead",
      "anyone alive in here?"
    ];
  }

  async sendProactiveMessage(channel) {
    if (!this.client || !channel) return;

    try {
      const messages = this.getLonelyMessages();
      const randomMessage = messages[Math.floor(Math.random() * messages.length)];
      
      await channel.send(randomMessage);
      console.log(`🤖 AI sent proactive message in ${channel.id}: ${randomMessage}`);
    } catch (error) {
      console.error('Error sending proactive AI message:', error);
    }
  }

  startProactiveMessaging(channel) {
    if (!channel || this.proactiveIntervals.has(channel.id)) return;

    // Check every 5-10 minutes if channel is quiet
    const checkInterval = () => {
      const lastMsgTime = this.lastMessageTime.get(channel.id);
      const now = Date.now();
      const quietTime = now - (lastMsgTime || 0);

      // If channel has been quiet for 5-8 minutes, send a message
      const minQuietTime = 5 * 60 * 1000; // 5 minutes
      const maxQuietTime = 8 * 60 * 1000; // 8 minutes
      const randomQuietTime = minQuietTime + Math.random() * (maxQuietTime - minQuietTime);

      if (quietTime >= randomQuietTime && (!lastMsgTime || quietTime >= minQuietTime)) {
        this.sendProactiveMessage(channel);
        // Reset timer after sending
        this.lastMessageTime.set(channel.id, now);
      }
    };

    // Check every 30 seconds
    const interval = setInterval(checkInterval, 30 * 1000);
    this.proactiveIntervals.set(channel.id, interval);
    console.log(`✅ Started proactive messaging for channel ${channel.id}`);
  }

  stopProactiveMessaging(channelId) {
    const interval = this.proactiveIntervals.get(channelId);
    if (interval) {
      clearInterval(interval);
      this.proactiveIntervals.delete(channelId);
      console.log(`⏹️  Stopped proactive messaging for channel ${channelId}`);
    }
  }

  updateLastMessageTime(channelId) {
    this.lastMessageTime.set(channelId, Date.now());
  }

  // Split long messages into multiple short messages
  splitIntoShortMessages(text) {
    if (!text || text.length === 0) return [''];
    
    // Remove extra whitespace
    text = text.trim();
    
    // If already short, return as is
    if (text.length <= 80) {
      return [text];
    }

    // Split by common separators (periods, exclamation, question marks, newlines)
    // But keep it natural - don't split mid-thought
    const messages = [];
    const sentences = text.split(/(?<=[.!?])\s+|(?<=\n)/).filter(s => s.trim().length > 0);
    
    let currentMessage = '';
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      
      // If adding this sentence would make it too long, start new message
      if (currentMessage.length + trimmed.length + 1 > 80 && currentMessage.length > 0) {
        messages.push(currentMessage.trim());
        currentMessage = trimmed;
      } else {
        currentMessage += (currentMessage ? ' ' : '') + trimmed;
      }
    }
    
    // Add remaining message
    if (currentMessage.trim().length > 0) {
      messages.push(currentMessage.trim());
    }
    
    // If still too long, split by commas or just force split
    const finalMessages = [];
    for (const msg of messages) {
      if (msg.length <= 80) {
        finalMessages.push(msg);
      } else {
        // Force split at 80 chars
        let remaining = msg;
        while (remaining.length > 80) {
          // Try to split at a natural break
          let splitPoint = 80;
          const lastSpace = remaining.lastIndexOf(' ', 80);
          const lastComma = remaining.lastIndexOf(',', 80);
          const lastPeriod = remaining.lastIndexOf('.', 80);
          
          splitPoint = Math.max(lastSpace, lastComma, lastPeriod);
          if (splitPoint < 50) splitPoint = 80; // If no good break, just split
          
          finalMessages.push(remaining.substring(0, splitPoint).trim());
          remaining = remaining.substring(splitPoint).trim();
        }
        if (remaining.length > 0) {
          finalMessages.push(remaining);
        }
      }
    }
    
    return finalMessages.length > 0 ? finalMessages : [text.substring(0, 80)];
  }
}

module.exports = AIManager;
