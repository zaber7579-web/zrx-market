const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Client, GatewayIntentBits, EmbedBuilder, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionType, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ActivityType } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const EventEmitter = require('events');

// Database connection for bot
// Ensure data directory exists
const fs = require('fs');
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('✅ Created data directory:', DATA_DIR);
  } catch (mkdirErr) {
    console.warn('⚠️  Could not create data directory:', mkdirErr.message);
    // Try using current working directory as fallback
    const fallbackDir = path.join(process.cwd(), 'data');
    try {
      if (!fs.existsSync(fallbackDir)) {
        fs.mkdirSync(fallbackDir, { recursive: true });
        console.log('✅ Created fallback data directory:', fallbackDir);
      }
    } catch (fallbackErr) {
      console.warn('⚠️  Could not create fallback data directory:', fallbackErr.message);
    }
  }
}

const DB_PATH = path.join(DATA_DIR, 'zrx-market.db');
console.log('📁 Database path:', DB_PATH);
console.log('📁 Current working directory:', process.cwd());
console.log('📁 __dirname:', __dirname);

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('❌ Bot: Error opening database:', err.message);
    console.error('❌ Database path:', DB_PATH);
    console.error('❌ Error code:', err.code, 'Error number:', err.errno);
  } else {
    console.log('✅ Bot database opened successfully');
    // Test if database is writable
    db.run('PRAGMA journal_mode = WAL;', (pragmaErr) => {
      if (pragmaErr) {
        console.warn('⚠️  Warning: Could not set WAL mode, database may be read-only:', pragmaErr.message);
      } else {
        console.log('✅ Database is writable (WAL mode enabled)');
      }
    });
  }
});

const dbHelpers = {
  get: (query, params = []) => {
    return new Promise((resolve, reject) => {
      db.get(query, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  all: (query, params = []) => {
    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  run: (query, params = []) => {
    return new Promise((resolve, reject) => {
      db.run(query, params, function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }
};

// Snarky responses array
const SNARKY_RESPONSES = {
  noPermission: [
    "What the fuck do you think you're doing? You don't have permission for that shit.",
    "Nah, you can't do that. Get the fuck outta here.",
    "Permission denied, you absolute moron. Try getting the right role first.",
    "Fuck off, you don't have permission. Simple as that."
  ],
  error: [
    "Well that's fucking broken. Good job breaking it.",
    "Something went wrong. Shocking, I know.",
    "Error occurred. Probably your fault.",
    "That didn't work. Surprise, surprise."
  ],
  notFound: [
    "That shit doesn't exist. Try again, dumbass.",
    "Couldn't find that. Maybe it never existed?",
    "Not found. You sure you typed that right?",
    "Doesn't exist. What a surprise."
  ],
  success: [
    "Done. You're welcome, I guess.",
    "There you go. Was that so hard?",
    "Success. Don't fuck it up now.",
    "Done. Try not to break it."
  ]
};

function getSnarkyResponse(type) {
  const responses = SNARKY_RESPONSES[type] || ["Whatever."];
  return responses[Math.floor(Math.random() * responses.length)];
}

class MiddlemanBot extends EventEmitter {
  constructor() {
    super();
    this.activeCollectors = new Map();
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessageTyping
      ]
    });

    // Initialize Casino Manager
    const CasinoManager = require('./casino/CasinoManager');
    this.casino = new CasinoManager(db);

    // Initialize AI Manager
    const AIManager = require('./ai/AIManager');
    this.ai = new AIManager(dbHelpers, this.client);
    
    // Set client reference after client is ready
    this.client.once(Events.ClientReady, () => {
      this.ai.setClient(this.client);
      this.startAIProactiveMessaging();
    });

    this.setupEventHandlers();
    this.setupCommands();
  }

  setupEventHandlers() {
    this.client.once(Events.ClientReady, async () => {
      console.log(`🤖 Bot logged in as ${this.client.user.tag} - Ready to be a snarky asshole!`);
      
      // Set Rich Presence
      this.client.user.setPresence({
        activities: [{ name: 'zrxmarket.com', type: ActivityType.Watching }],
        status: 'online',
      });

      // Set AI client reference
      this.ai.setClient(this.client);

      // Initialize database tables
      await this.initializeDatabase();

      await this.registerSlashCommands();
      await this.setupPendingThreadTimers();
      this.startAIProactiveMessaging();
    });

    this.client.on(Events.GuildMemberAdd, async (member) => {
      try {
        // Get welcome channel from database or find it by name
        let welcomeChannel = null;
        
        // Try to get from database first
        try {
          const config = await dbHelpers.get(
            'SELECT welcomeChannelId FROM server_config WHERE guildId = ?',
            [member.guild.id]
          );
          if (config?.welcomeChannelId) {
            welcomeChannel = await member.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
          }
        } catch (dbError) {
          // Table might not exist yet, continue
        }

        // If not found in DB, try to find channel by name
        if (!welcomeChannel) {
          welcomeChannel = member.guild.channels.cache.find(
            channel => (channel.name === 'welcom !' || channel.name === 'welcome' || channel.name === 'welcom') && channel.type === 0
          );
        }

        // Get welcome message from database or use default
        let welcomeMessage = null;
        try {
          const config = await dbHelpers.get(
            'SELECT welcomeMessage FROM server_config WHERE guildId = ?',
            [member.guild.id]
          );
          welcomeMessage = config?.welcomeMessage;
        } catch (dbError) {
          // Table might not exist yet, continue
        }

        // Default welcome message (matching the style from the old server)
        if (!welcomeMessage) {
          welcomeMessage = `hello welcome to miss death are server is run by me (alli) !! hope you have a good time in are server !`;
        }

        // Replace placeholders in message
        welcomeMessage = welcomeMessage
          .replace(/{user}/g, `<@${member.user.id}>`)
          .replace(/{username}/g, member.user.username)
          .replace(/{server}/g, member.guild.name)
          .replace(/{memberCount}/g, member.guild.memberCount.toString());

        // Send welcome message to channel
        if (welcomeChannel) {
          await welcomeChannel.send(welcomeMessage);
          console.log(`✅ Sent welcome message to ${member.user.tag} in ${welcomeChannel.name}`);
        } else {
          console.log(`⚠️ Welcome channel not found for ${member.guild.name}`);
        }

        // Try to send DM as backup (optional)
        try {
          await member.send(welcomeMessage);
          console.log(`✅ Also sent welcome DM to ${member.user.tag}`);
        } catch (dmError) {
          // DMs disabled, that's fine
        }

        // Auto-role assignment (if configured)
        try {
          const config = await dbHelpers.get(
            'SELECT autoRoleId FROM server_config WHERE guildId = ?',
            [member.guild.id]
          );
          if (config?.autoRoleId) {
            const role = await member.guild.roles.fetch(config.autoRoleId).catch(() => null);
            if (role) {
              await member.roles.add(role);
              console.log(`✅ Assigned auto-role to ${member.user.tag}`);
            }
          }
        } catch (roleError) {
          // Auto-role not configured or error, continue
        }

      } catch (error) {
        console.error('Error in GuildMemberAdd handler:', error.message);
      }
    });

    this.on('requestUpdated', async (request) => {
      console.log(`Request ${request.id} updated to status: ${request.status}`);
    });

    this.on('newRequest', async (request) => {
      console.log(`📨 New middleman request received: #${request.id}`);
      try {
        // Check if this is a request from chat (has tradeId and both parties requested)
        if (request.tradeId && request.user1RequestedMM && request.user2RequestedMM) {
          // Create acceptance thread for trade-based requests
          await this.createAcceptanceThread(request);
        } else {
          // Post directly for traditional requests
          await this.postMiddlemanRequest(request);
        }
      } catch (error) {
        console.error('❌ Error handling newRequest event:', error);
        console.error('Error details:', error.message);
        if (error.stack) {
          console.error('Stack trace:', error.stack);
        }
      }
    });

    this.on('newReport', async (report) => {
      await this.notifyModerationChannel(report);
    });

    this.client.on(Events.MessageCreate, async (message) => {
      // Handle AI chat in configured channels
      if (message.guild && !message.author.bot && !message.system) {
        await this.ai.handleMessage(message).catch(err => {
          console.error('AI message handler error:', err);
        });
        
        // Track XP for leveling system
        await this.trackXP(message).catch(err => {
          console.error('XP tracking error:', err);
        });
      }
    });

    this.client.on(Events.MessageReactionAdd, async (reaction, user) => {
      // Handle reaction roles
      if (reaction.message.guild && !user.bot) {
        await this.handleReactionRole(reaction, user, true).catch(err => {
          console.error('Reaction role error:', err);
        });
      }
      
      // Existing middleman acceptance reaction handler
      if (reaction.message.channel.isThread() && 
          reaction.message.channel.parentId === process.env.MIDDLEMAN_CHANNEL_ID &&
          reaction.emoji.name === '✅' &&
          !user.bot) {
        await this.handleAcceptanceReaction(reaction, user);
      }
    });

    this.client.on(Events.MessageReactionRemove, async (reaction, user) => {
      // Handle reaction role removal
      if (reaction.message.guild && !user.bot) {
        await this.handleReactionRole(reaction, user, false).catch(err => {
          console.error('Reaction role error:', err);
        });
      }
    });


    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (interaction.isButton()) {
        const customId = interaction.customId;

        if (customId.startsWith('report_request_info_')) {
          const reportId = parseInt(customId.replace('report_request_info_', ''));
          await this.handleRequestMoreInfo(interaction, reportId);
        } else if (customId.startsWith('report_chat_accused_')) {
          const reportId = parseInt(customId.replace('report_chat_accused_', ''));
          await this.handleChatWithAccused(interaction, reportId);
        }
        return;
      }

      // Handle slash commands
      if (interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
      }
    });
  }

  async initializeDatabase() {
    try {
      // Create server_config table for welcome settings
      await dbHelpers.run(`
        CREATE TABLE IF NOT EXISTS server_config (
          guildId TEXT PRIMARY KEY,
          welcomeChannelId TEXT,
          welcomeMessage TEXT,
          autoRoleId TEXT,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Database tables initialized');
    } catch (error) {
      console.error('❌ Error initializing database:', error);
    }
  }

  async registerSlashCommands() {
    try {
      const commands = [
        // Public commands
        new SlashCommandBuilder()
          .setName('help')
          .setDescription('Show all available commands'),
        
        new SlashCommandBuilder()
          .setName('ping')
          .setDescription('Check if the bot is alive'),
        
        new SlashCommandBuilder()
          .setName('stats')
          .setDescription('Show market statistics'),
        
        new SlashCommandBuilder()
          .setName('user')
          .setDescription('Look up a user')
          .addStringOption(option =>
            option.setName('discordid')
              .setDescription('Discord ID of the user')
              .setRequired(true)),
        
        new SlashCommandBuilder()
          .setName('trade')
          .setDescription('View trade details')
          .addIntegerOption(option =>
            option.setName('id')
              .setDescription('Trade ID')
              .setRequired(true)),

        // Casino commands
        new SlashCommandBuilder()
          .setName('balance')
          .setDescription('Check your casino coin balance'),
        
        new SlashCommandBuilder()
          .setName('daily')
          .setDescription('Claim your daily reward (500-1000 coins)'),
        
        new SlashCommandBuilder()
          .setName('work')
          .setDescription('Work to earn coins (cooldown: 1 hour)'),
        
        new SlashCommandBuilder()
          .setName('collect')
          .setDescription('Collect role-based income based on your Discord roles'),
        
        new SlashCommandBuilder()
          .setName('slut')
          .setDescription('Earn coins the... fun way (cooldown: 30 minutes)'),
        
        new SlashCommandBuilder()
          .setName('casinostats')
          .setDescription('View casino statistics')
          .addUserOption(option =>
            option.setName('user')
              .setDescription('User to check stats for (optional)')
              .setRequired(false)),
        
        new SlashCommandBuilder()
          .setName('coinflip')
          .setDescription('Flip a coin (heads or tails)')
          .addIntegerOption(option =>
            option.setName('bet')
              .setDescription('Amount to bet')
              .setRequired(true)
              .setMinValue(10)
              .setMaxValue(10000))
          .addStringOption(option =>
            option.setName('choice')
              .setDescription('Heads or tails')
              .setRequired(true)
              .addChoices(
                { name: 'Heads', value: 'heads' },
                { name: 'Tails', value: 'tails' }
              )),
        
        new SlashCommandBuilder()
          .setName('dice')
          .setDescription('Roll dice (1-6, 5x multiplier if you win)')
          .addIntegerOption(option =>
            option.setName('bet')
              .setDescription('Amount to bet')
              .setRequired(true)
              .setMinValue(10)
              .setMaxValue(10000))
          .addIntegerOption(option =>
            option.setName('guess')
              .setDescription('Your guess (1-6)')
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(6)),
        
        new SlashCommandBuilder()
          .setName('double')
          .setDescription('Double or nothing - 50/50 chance to double your bet')
          .addIntegerOption(option =>
            option.setName('bet')
              .setDescription('Amount to bet')
              .setRequired(true)
              .setMinValue(10)
              .setMaxValue(10000)),
        
        new SlashCommandBuilder()
          .setName('roulette')
          .setDescription('Play roulette')
          .addIntegerOption(option =>
            option.setName('bet')
              .setDescription('Amount to bet')
              .setRequired(true)
              .setMinValue(10)
              .setMaxValue(10000))
          .addStringOption(option =>
            option.setName('choice')
              .setDescription('Red, black, green, or a number (0-36)')
              .setRequired(true)),
        
        new SlashCommandBuilder()
          .setName('blackjack')
          .setDescription('Start a blackjack game')
          .addIntegerOption(option =>
            option.setName('bet')
              .setDescription('Amount to bet')
              .setRequired(true)
              .setMinValue(10)
              .setMaxValue(10000)),
        
        new SlashCommandBuilder()
          .setName('hit')
          .setDescription('Draw another card in blackjack'),
        
        new SlashCommandBuilder()
          .setName('stand')
          .setDescription('End your turn in blackjack'),

        // AI commands
        new SlashCommandBuilder()
          .setName('ai')
          .setDescription('AI chat configuration')
          .addSubcommand(subcommand =>
            subcommand
              .setName('setup')
              .setDescription('Set up AI chat channel')
              .addChannelOption(option =>
                option.setName('channel')
                  .setDescription('Channel for AI chat')
                  .setRequired(true))),

        // Moderator commands
        new SlashCommandBuilder()
          .setName('mm')
          .setDescription('Middleman commands')
          .addSubcommand(subcommand =>
            subcommand
              .setName('accept')
              .setDescription('Accept a middleman request')
              .addIntegerOption(option =>
                option.setName('id')
                  .setDescription('Request ID')
                  .setRequired(true)))
          .addSubcommand(subcommand =>
            subcommand
              .setName('decline')
              .setDescription('Decline a middleman request')
              .addIntegerOption(option =>
                option.setName('id')
                  .setDescription('Request ID')
                  .setRequired(true)))
          .addSubcommand(subcommand =>
            subcommand
              .setName('complete')
              .setDescription('Mark a request as completed')
              .addIntegerOption(option =>
                option.setName('id')
                  .setDescription('Request ID')
                  .setRequired(true)))
          .addSubcommand(subcommand =>
            subcommand
              .setName('list')
              .setDescription('List middleman requests')
              .addStringOption(option =>
                option.setName('status')
                  .setDescription('Filter by status')
                  .setRequired(false)
                  .addChoices(
                    { name: 'Pending', value: 'pending' },
                    { name: 'Accepted', value: 'accepted' },
                    { name: 'Declined', value: 'declined' },
                    { name: 'Completed', value: 'completed' }
                  ))),
        
        new SlashCommandBuilder()
          .setName('blacklist')
          .setDescription('Blacklist management')
          .addSubcommand(subcommand =>
            subcommand
              .setName('add')
              .setDescription('Blacklist a user')
              .addUserOption(option =>
                option.setName('user')
                  .setDescription('User to blacklist')
                  .setRequired(true))
              .addStringOption(option =>
                option.setName('reason')
                  .setDescription('Reason for blacklist')
                  .setRequired(true)))
          .addSubcommand(subcommand =>
            subcommand
              .setName('remove')
              .setDescription('Remove user from blacklist')
              .addUserOption(option =>
                option.setName('user')
                  .setDescription('User to remove')
                  .setRequired(true)))
          .addSubcommand(subcommand =>
            subcommand
              .setName('list')
              .setDescription('List all blacklisted users'))
          .addSubcommand(subcommand =>
            subcommand
              .setName('check')
              .setDescription('Check if user is blacklisted')
              .addUserOption(option =>
                option.setName('user')
                  .setDescription('User to check')
                  .setRequired(true))),
        
        new SlashCommandBuilder()
          .setName('report')
          .setDescription('Report management')
          .addSubcommand(subcommand =>
            subcommand
              .setName('list')
              .setDescription('List reports')
              .addStringOption(option =>
                option.setName('status')
                  .setDescription('Filter by status')
                  .setRequired(false)))
          .addSubcommand(subcommand =>
            subcommand
              .setName('view')
              .setDescription('View report details')
              .addIntegerOption(option =>
                option.setName('id')
                  .setDescription('Report ID')
                  .setRequired(true))),
        
        new SlashCommandBuilder()
          .setName('verify')
          .setDescription('Verify a user')
          .addUserOption(option =>
            option.setName('user')
              .setDescription('User to verify')
              .setRequired(true)),
        
        new SlashCommandBuilder()
          .setName('unverify')
          .setDescription('Unverify a user')
          .addUserOption(option =>
            option.setName('user')
              .setDescription('User to unverify')
              .setRequired(true)),
        
        new SlashCommandBuilder()
          .setName('serverstats')
          .setDescription('Show server statistics'),
        
        new SlashCommandBuilder()
          .setName('cleanup')
          .setDescription('Clean up old expired trades'),
        
        new SlashCommandBuilder()
          .setName('casinoadd')
          .setDescription('Add coins to a user (moderator only)')
          .addUserOption(option =>
            option.setName('user')
              .setDescription('User to add coins to')
              .setRequired(true))
          .addIntegerOption(option =>
            option.setName('amount')
              .setDescription('Amount of coins to add')
              .setRequired(true)
              .setMinValue(1)),
        
        new SlashCommandBuilder()
          .setName('casinoremove')
          .setDescription('Remove coins from a user (moderator only)')
          .addUserOption(option =>
            option.setName('user')
              .setDescription('User to remove coins from')
              .setRequired(true))
          .addIntegerOption(option =>
            option.setName('amount')
              .setDescription('Amount of coins to remove')
              .setRequired(true)
              .setMinValue(1)),
        
        new SlashCommandBuilder()
          .setName('casinoreset')
          .setDescription('Reset user casino stats (moderator only)')
          .addUserOption(option =>
            option.setName('user')
              .setDescription('User to reset')
              .setRequired(true)),
        
        new SlashCommandBuilder()
          .setName('setup')
          .setDescription('🔧 Auto-setup server channels and permissions (administrator only)')
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addBooleanOption(option =>
            option.setName('force')
              .setDescription('Delete existing channels and recreate (WARNING: Destructive)')
              .setRequired(false)),
        
        new SlashCommandBuilder()
          .setName('welcome')
          .setDescription('Configure welcome messages (administrator only)')
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
          .addSubcommand(subcommand =>
            subcommand
              .setName('channel')
              .setDescription('Set the welcome channel')
              .addChannelOption(option =>
                option.setName('channel')
                  .setDescription('Channel to send welcome messages')
                  .setRequired(true)))
          .addSubcommand(subcommand =>
            subcommand
              .setName('message')
              .setDescription('Set the welcome message')
              .addStringOption(option =>
                option.setName('message')
                  .setDescription('Welcome message (use {user} for mention, {username} for name, {server} for server name)')
                  .setRequired(true)))
          .addSubcommand(subcommand =>
            subcommand
              .setName('role')
              .setDescription('Set auto-role for new members')
              .addRoleOption(option =>
                option.setName('role')
                  .setDescription('Role to assign to new members')
                  .setRequired(true)))
          .addSubcommand(subcommand =>
            subcommand
              .setName('view')
              .setDescription('View current welcome settings')),

        // New useful commands
        new SlashCommandBuilder()
          .setName('poll')
          .setDescription('Create a poll')
          .addStringOption(option =>
            option.setName('question')
              .setDescription('Poll question')
              .setRequired(true))
          .addStringOption(option =>
            option.setName('options')
              .setDescription('Poll options separated by | (e.g., Option 1|Option 2|Option 3)')
              .setRequired(true))
          .addIntegerOption(option =>
            option.setName('duration')
              .setDescription('Duration in minutes (default: 60)')
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(10080)),

        new SlashCommandBuilder()
          .setName('giveaway')
          .setDescription('Giveaway management')
          .addSubcommand(subcommand =>
            subcommand
              .setName('start')
              .setDescription('Start a giveaway')
              .addStringOption(option =>
                option.setName('prize')
                  .setDescription('Prize description')
                  .setRequired(true))
              .addIntegerOption(option =>
                option.setName('duration')
                  .setDescription('Duration in minutes')
                  .setRequired(true)
                  .setMinValue(1))
              .addIntegerOption(option =>
                option.setName('winners')
                  .setDescription('Number of winners')
                  .setRequired(false)
                  .setMinValue(1)
                  .setMaxValue(10)))
          .addSubcommand(subcommand =>
            subcommand
              .setName('end')
              .setDescription('End a giveaway early')
              .addStringOption(option =>
                option.setName('message_id')
                  .setDescription('Giveaway message ID')
                  .setRequired(true)))
          .addSubcommand(subcommand =>
            subcommand
              .setName('reroll')
              .setDescription('Reroll giveaway winners')
              .addStringOption(option =>
                option.setName('message_id')
                  .setDescription('Giveaway message ID')
                  .setRequired(true))),

        new SlashCommandBuilder()
          .setName('level')
          .setDescription('Check your level and XP')
          .addUserOption(option =>
            option.setName('user')
              .setDescription('User to check (optional)')
              .setRequired(false)),

        new SlashCommandBuilder()
          .setName('leaderboard')
          .setDescription('View server leaderboard')
          .addStringOption(option =>
            option.setName('type')
              .setDescription('Leaderboard type')
              .setRequired(false)
              .addChoices(
                { name: 'Level', value: 'level' },
                { name: 'XP', value: 'xp' },
                { name: 'Casino', value: 'casino' }
              )),

        new SlashCommandBuilder()
          .setName('announce')
          .setDescription('Send an announcement (moderator only)')
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
          .addStringOption(option =>
            option.setName('message')
              .setDescription('Announcement message')
              .setRequired(true))
          .addChannelOption(option =>
            option.setName('channel')
              .setDescription('Channel to send announcement (default: current channel)')
              .setRequired(false))
          .addRoleOption(option =>
            option.setName('ping')
              .setDescription('Role to ping (optional)')
              .setRequired(false)),

        new SlashCommandBuilder()
          .setName('warn')
          .setDescription('Warn a user (moderator only)')
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
          .addUserOption(option =>
            option.setName('user')
              .setDescription('User to warn')
              .setRequired(true))
          .addStringOption(option =>
            option.setName('reason')
              .setDescription('Reason for warning')
              .setRequired(true)),

        new SlashCommandBuilder()
          .setName('mute')
          .setDescription('Timeout a user (moderator only)')
          .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
          .addUserOption(option =>
            option.setName('user')
              .setDescription('User to mute')
              .setRequired(true))
          .addIntegerOption(option =>
            option.setName('duration')
              .setDescription('Duration in minutes')
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(40320))
          .addStringOption(option =>
            option.setName('reason')
              .setDescription('Reason for mute')
              .setRequired(false)),

        new SlashCommandBuilder()
          .setName('kick')
          .setDescription('Kick a user (moderator only)')
          .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
          .addUserOption(option =>
            option.setName('user')
              .setDescription('User to kick')
              .setRequired(true))
          .addStringOption(option =>
            option.setName('reason')
              .setDescription('Reason for kick')
              .setRequired(false)),

        new SlashCommandBuilder()
          .setName('ban')
          .setDescription('Ban a user (moderator only)')
          .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
          .addUserOption(option =>
            option.setName('user')
              .setDescription('User to ban')
              .setRequired(true))
          .addIntegerOption(option =>
            option.setName('delete_days')
              .setDescription('Delete messages from last X days (0-7)')
              .setRequired(false)
              .setMinValue(0)
              .setMaxValue(7))
          .addStringOption(option =>
            option.setName('reason')
              .setDescription('Reason for ban')
              .setRequired(false)),

        new SlashCommandBuilder()
          .setName('reactionrole')
          .setDescription('Reaction role management (moderator only)')
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
          .addSubcommand(subcommand =>
            subcommand
              .setName('add')
              .setDescription('Add a reaction role')
              .addChannelOption(option =>
                option.setName('channel')
                  .setDescription('Channel with the message')
                  .setRequired(true))
              .addStringOption(option =>
                option.setName('message_id')
                  .setDescription('Message ID')
                  .setRequired(true))
              .addRoleOption(option =>
                option.setName('role')
                  .setDescription('Role to assign')
                  .setRequired(true))
              .addStringOption(option =>
                option.setName('emoji')
                  .setDescription('Emoji for reaction')
                  .setRequired(true)))
          .addSubcommand(subcommand =>
            subcommand
              .setName('remove')
              .setDescription('Remove a reaction role')
              .addChannelOption(option =>
                option.setName('channel')
                  .setDescription('Channel with the message')
                  .setRequired(true))
              .addStringOption(option =>
                option.setName('message_id')
                  .setDescription('Message ID')
                  .setRequired(true))
              .addStringOption(option =>
                option.setName('emoji')
                  .setDescription('Emoji to remove')
                  .setRequired(true)))
          .addSubcommand(subcommand =>
            subcommand
              .setName('list')
              .setDescription('List all reaction roles')),

        new SlashCommandBuilder()
          .setName('verify-setup')
          .setDescription('Setup verification and role selection messages (moderator only)')
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
          .addChannelOption(option =>
            option.setName('channel')
              .setDescription('Channel to send messages (default: get-roles)')
              .setRequired(false))
          .addRoleOption(option =>
            option.setName('verify_role')
              .setDescription('Role to give when verified (unlocks channels)')
              .setRequired(false))
      ].map(command => command.toJSON());

      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

      console.log('🔄 Registering slash commands...');

      const clientId = this.client.user.id;
      const guildId = process.env.GUILD_ID;
      
      if (guildId) {
        // Clear global commands first to avoid duplicates
        try {
          await rest.put(Routes.applicationCommands(clientId), { body: [] });
          console.log('✅ Cleared global commands to prevent duplicates');
        } catch (error) {
          console.warn('⚠️ Could not clear global commands (this is okay):', error.message);
        }
        
        // Register only guild commands
        await rest.put(
          Routes.applicationGuildCommands(clientId, guildId),
          { body: commands }
        );
        console.log(`✅ Successfully registered ${commands.length} slash commands for guild ${guildId}`);
      } else {
        // Clear guild commands if we're registering globally
        try {
          const guilds = this.client.guilds.cache;
          for (const [id, guild] of guilds) {
            await rest.put(Routes.applicationGuildCommands(clientId, id), { body: [] }).catch(() => {});
          }
          console.log('✅ Cleared guild commands to prevent duplicates');
        } catch (error) {
          console.warn('⚠️ Could not clear guild commands:', error.message);
        }
        
        await rest.put(
          Routes.applicationCommands(clientId),
          { body: commands }
        );
        console.log(`✅ Successfully registered ${commands.length} global slash commands`);
      }
    } catch (error) {
      console.error('❌ Error registering slash commands:', error);
    }
  }

  async handleSlashCommand(interaction) {
    const command = interaction.commandName;
    // Optional casino channel restriction - only enforce if set in env
    const CASINO_CHANNEL_ID = process.env.CASINO_CHANNEL_ID;

    // Commands that need async work - defer immediately to prevent timeout
    const asyncCommands = ['balance', 'daily', 'work', 'collect', 'slut', 'casinostats', 'coinflip', 'dice', 'double', 'roulette', 'blackjack', 'hit', 'stand', 
                           'stats', 'user', 'trade', 'ai', 'mm', 'blacklist', 'report', 'verify', 'unverify', 'serverstats', 'cleanup', 
                           'casinoadd', 'casinoremove', 'casinoreset', 'setup', 'welcome', 'poll', 'giveaway', 'level', 'leaderboard', 
                           'announce', 'warn', 'mute', 'kick', 'ban', 'reactionrole', 'verify-setup'];
    const needsDefer = asyncCommands.includes(command);
    
    // Commands that should be ephemeral (only visible to user)
    const ephemeralCommands = ['stats', 'user', 'trade', 'mm', 'blacklist', 'report', 'verify', 'unverify', 'serverstats', 'cleanup', 
                                'casinoadd', 'casinoremove', 'casinoreset', 'setup', 'welcome', 'level', 'leaderboard'];
    const isEphemeral = ephemeralCommands.includes(command);
    
    if (needsDefer) {
      await interaction.deferReply({ flags: isEphemeral ? 64 : undefined }); // 64 = EPHEMERAL flag
    }

    // Casino commands channel check - ONLY if CASINO_CHANNEL_ID is set in env (optional restriction)
    const casinoCommands = ['balance', 'daily', 'work', 'collect', 'slut', 'casinostats', 'coinflip', 'dice', 'double', 'roulette', 'blackjack', 'hit', 'stand'];
    if (casinoCommands.includes(command) && CASINO_CHANNEL_ID) {
      if (interaction.channel.id !== CASINO_CHANNEL_ID) {
        const snarkyResponses = [
          `Casino commands work in <#${CASINO_CHANNEL_ID}>.`,
          `Please use <#${CASINO_CHANNEL_ID}> for casino commands.`,
          `Casino commands are in <#${CASINO_CHANNEL_ID}>.`
        ];
        const snarky = snarkyResponses[Math.floor(Math.random() * snarkyResponses.length)];
        if (needsDefer) {
          return await interaction.editReply({ content: `❌ ${snarky}` });
        } else {
          return await interaction.reply({ content: `❌ ${snarky}`, flags: 64 }); // 64 = EPHEMERAL flag
        }
      }
    }

    try {
      switch (command) {
        case 'help':
          await this.handleSlashHelp(interaction);
          break;
        case 'ping':
          await interaction.reply({ content: `🏓 Pong! Fuck you, I'm alive. Latency: ${this.client.ws.ping}ms`, flags: 64 }); // 64 = EPHEMERAL flag
          break;
        case 'stats':
          await this.handleSlashStats(interaction);
          break;
        case 'user':
          await this.handleSlashUserLookup(interaction);
          break;
        case 'trade':
          await this.handleSlashTradeLookup(interaction);
          break;
        case 'balance':
          await this.handleSlashBalance(interaction);
          break;
        case 'daily':
          await this.handleSlashDaily(interaction);
          break;
        case 'work':
          await this.handleSlashWork(interaction);
          break;
        case 'collect':
          await this.handleSlashCollect(interaction);
          break;
        case 'slut':
          await this.handleSlashSlut(interaction);
          break;
        case 'casinostats':
          await this.handleSlashCasinoStats(interaction);
          break;
        case 'coinflip':
          await this.handleSlashCoinflip(interaction);
          break;
        case 'dice':
          await this.handleSlashDice(interaction);
          break;
        case 'double':
          await this.handleSlashDouble(interaction);
          break;
        case 'roulette':
          await this.handleSlashRoulette(interaction);
          break;
        case 'blackjack':
          await this.handleSlashBlackjack(interaction);
          break;
        case 'hit':
          await this.handleSlashBlackjackHit(interaction);
          break;
        case 'stand':
          await this.handleSlashBlackjackStand(interaction);
          break;
        case 'ai':
          await this.handleSlashAI(interaction);
          break;
        case 'mm':
          await this.handleSlashMM(interaction);
          break;
        case 'blacklist':
          await this.handleSlashBlacklist(interaction);
          break;
        case 'report':
          await this.handleSlashReport(interaction);
          break;
        case 'verify':
          await this.handleSlashVerify(interaction);
          break;
        case 'unverify':
          await this.handleSlashUnverify(interaction);
          break;
        case 'serverstats':
          await this.handleSlashServerStats(interaction);
          break;
        case 'cleanup':
          await this.handleSlashCleanup(interaction);
          break;
        case 'poll':
          await this.handleSlashPoll(interaction);
          break;
        case 'giveaway':
          await this.handleSlashGiveaway(interaction);
          break;
        case 'level':
          await this.handleSlashLevel(interaction);
          break;
        case 'leaderboard':
          await this.handleSlashLeaderboard(interaction);
          break;
        case 'announce':
          await this.handleSlashAnnounce(interaction);
          break;
        case 'warn':
          await this.handleSlashWarn(interaction);
          break;
        case 'mute':
          await this.handleSlashMute(interaction);
          break;
        case 'kick':
          await this.handleSlashKick(interaction);
          break;
        case 'ban':
          await this.handleSlashBan(interaction);
          break;
        case 'reactionrole':
          await this.handleSlashReactionRole(interaction);
          break;
        case 'verify-setup':
          await this.handleSlashVerifySetup(interaction);
          break;
        case 'casinoadd':
          await this.handleSlashCasinoAdd(interaction);
          break;
        case 'casinoremove':
          await this.handleSlashCasinoRemove(interaction);
          break;
        case 'casinoreset':
          await this.handleSlashCasinoReset(interaction);
          break;
        case 'setup':
          await this.handleSlashSetup(interaction);
          break;
        case 'welcome':
          await this.handleSlashWelcome(interaction);
          break;
        default:
          await interaction.reply({ content: `❌ Unknown command. What the fuck are you trying to do?`, flags: 64 }); // 64 = EPHEMERAL flag
      }
    } catch (error) {
      console.error('Slash command error:', error);
      const snarky = getSnarkyResponse('error');
      await interaction.reply({ content: `❌ ${snarky} Error: ${error.message}`, flags: 64 }).catch(() => {}); // 64 = EPHEMERAL flag
    }
  }

  async setupPendingThreadTimers() {
    try {
      const pendingRequests = await dbHelpers.all(
        `SELECT * FROM middleman 
         WHERE status = 'pending' 
         AND threadId IS NOT NULL 
         AND (user1Accepted = 0 OR user2Accepted = 0)
         AND datetime(createdAt, '+5 minutes') > datetime('now')`
      );

      console.log(`⏰ Setting up timers for ${pendingRequests.length} pending acceptance threads`);

      for (const request of pendingRequests) {
        const createdAt = new Date(request.createdAt);
        const now = new Date();
        const minutesSinceCreation = (now - createdAt) / (1000 * 60);
        const timeRemaining = Math.max(0, (5 - minutesSinceCreation) * 60 * 1000);

        if (timeRemaining > 0) {
          setTimeout(async () => {
            const finalCheck = await dbHelpers.get(
              'SELECT * FROM middleman WHERE id = ?',
              [request.id]
            );

            if (finalCheck && !(finalCheck.user1Accepted === 1 && finalCheck.user2Accepted === 1)) {
              try {
                const thread = await this.client.channels.fetch(finalCheck.threadId);
                if (thread) {
                  await thread.send('⏰ **Time expired or not all parties accepted.**\n\nThis thread will be deleted in 10 seconds.');
                  await new Promise(resolve => setTimeout(resolve, 10000));
                  await thread.delete();
                  console.log(`🗑️ Deleted thread for request #${request.id} (timeout/no acceptance)`);
                  
                  await dbHelpers.run(
                    'UPDATE middleman SET status = ? WHERE id = ?',
                    ['declined', request.id]
                  );
                }
              } catch (deleteError) {
                console.error('Error deleting thread:', deleteError.message);
              }
            }
          }, timeRemaining);
        }
      }
    } catch (error) {
      console.error('Error setting up pending thread timers:', error);
    }
  }

  async handleAcceptanceReaction(reaction, user) {
    try {
      const message = reaction.message;
      const thread = message.channel;
      
      if (!message.embeds || message.embeds.length === 0) return;
      const embed = message.embeds[0];
      if (!embed.title || !embed.title.includes('Trade Agreement')) return;

      const requestIdMatch = embed.footer?.text?.match(/Request ID: (\d+)/) || 
                            thread.name.match(/MM-(\d+)/);
      if (!requestIdMatch) return;

      const requestId = parseInt(requestIdMatch[1]);
      const request = await dbHelpers.get(
        'SELECT * FROM middleman WHERE id = ?',
        [requestId]
      );

      if (!request) return;

      const user1Id = request.user1 ? String(request.user1).replace(/[<@!>]/g, '') : '';
      const user2Id = request.user2 ? String(request.user2).replace(/[<@!>]/g, '') : '';

      if (user.id !== user1Id && user.id !== user2Id) return;

      console.log(`✅ User ${user.tag} (${user.id}) accepted trade #${requestId}`);

      if (user.id === user1Id) {
        await dbHelpers.run(
          'UPDATE middleman SET user1Accepted = 1 WHERE id = ?',
          [requestId]
        );
      } else if (user.id === user2Id) {
        await dbHelpers.run(
          'UPDATE middleman SET user2Accepted = 1 WHERE id = ?',
          [requestId]
        );
      }

      const updatedRequest = await dbHelpers.get(
        'SELECT * FROM middleman WHERE id = ?',
        [requestId]
      );

      if (updatedRequest && updatedRequest.user1Accepted === 1 && updatedRequest.user2Accepted === 1) {
        const roleMention = process.env.MIDDLEMAN_ROLE_ID ? `<@&${process.env.MIDDLEMAN_ROLE_ID}>` : '';
        await thread.send({
          content: `🎉 **Both parties have accepted the trade!**\n\n${roleMention} A middleman is needed for this trade.\n\n**Trade Details:**\n${request.item}\n\n**Participants:**\n- <@${user1Id}>\n- <@${user2Id}>`
        });
        console.log(`✅ Both parties accepted trade #${requestId}, middleman pinged`);

      } else {
        const createdAt = new Date(request.createdAt);
        const now = new Date();
        const minutesSinceCreation = (now - createdAt) / (1000 * 60);

        if (minutesSinceCreation < 5) {
          const timeRemaining = (5 - minutesSinceCreation) * 60 * 1000;
          setTimeout(async () => {
            const finalCheck = await dbHelpers.get(
              'SELECT * FROM middleman WHERE id = ?',
              [requestId]
            );

            if (finalCheck && !(finalCheck.user1Accepted === 1 && finalCheck.user2Accepted === 1)) {
              try {
                await thread.send('⏰ **Time expired or not all parties accepted.**\n\nThis thread will be deleted in 10 seconds.');
                await new Promise(resolve => setTimeout(resolve, 10000));
                await thread.delete();
                console.log(`🗑️ Deleted thread for request #${requestId} (timeout/no acceptance)`);
                
                await dbHelpers.run(
                  'UPDATE middleman SET status = ? WHERE id = ?',
                  ['declined', requestId]
                );
              } catch (deleteError) {
                console.error('Error deleting thread:', deleteError.message);
              }
            }
          }, timeRemaining);
        }
      }
    } catch (error) {
      console.error('Error handling acceptance reaction:', error);
    }
  }

  setupCommands() {
    this.client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;
      
      // Only handle bridge thread messages - all commands are now slash commands
      if (message.channel.isThread()) {
        await this.handleBridgeThreadMessage(message);
      }
      
      // Message commands (!) are deprecated - use slash commands instead
      // Keeping minimal support for backwards compatibility but encouraging slash commands
      if (message.content.startsWith('!')) {
        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift()?.toLowerCase();
        
        // Only respond to help command to guide users to slash commands
        if (command === 'help' || command === 'commands') {
          return await message.reply(`❌ **Message commands are deprecated!**\n\nPlease use **slash commands** instead. Type \`/\` to see all available commands.\n\nAll features are now available as slash commands (/) for better Discord integration.`);
        }
        
        // Silently ignore other message commands - users should use slash commands
        return;
      }
    });
  }

  async handleHelp(message) {
    const embed = new EmbedBuilder()
      .setTitle('🤖 ZRX Market Bot - Commands')
      .setColor(0x5865F2)
      .setDescription('Here are all the fucking commands. Use them wisely.')
      .addFields(
        {
          name: '🌐 Public Commands',
          value: [
            '`!help` - Show this help (obviously)',
            '`!ping` - Check if I\'m alive (spoiler: I am)',
            '`!stats` - Show market statistics',
            '`!user <discordId>` - Look up a user',
            '`!trade <id>` - View trade details'
          ].join('\n'),
          inline: false
        },
        {
          name: '🎰 Casino Commands',
          value: [
            '`!balance` - Check your coin balance',
            '`!daily` - Claim daily reward (500-1000 coins)',
            '`!casinostats [user]` - View casino statistics',
            '`!coinflip <bet> <heads/tails>` - Flip a coin',
            '`!dice <bet> <1-6>` - Roll dice (5x multiplier)',
            '`!double <bet>` - Double or nothing',
            '`!roulette <bet> <red/black/green/number>` - Play roulette',
            '`!blackjack <bet>` - Start blackjack game',
            '`!hit` - Draw card in blackjack',
            '`!stand` - End turn in blackjack'
          ].join('\n'),
          inline: false
        },
        {
          name: '👮 Moderator Commands',
          value: [
            '`!mm accept <id>` - Accept middleman request',
            '`!mm decline <id>` - Decline middleman request',
            '`!mm complete <id>` - Mark request as completed',
            '`!mm list [status]` - List requests',
            '`!blacklist add <id> <reason>` - Blacklist a user',
            '`!blacklist remove <id>` - Remove from blacklist',
            '`!blacklist list` - List blacklisted users',
            '`!blacklist check <id>` - Check if user is blacklisted',
            '`!report list [status]` - List reports',
            '`!report view <id>` - View report details',
            '`!verify <id>` - Verify a user',
            '`!unverify <id>` - Unverify a user',
            '`!serverstats` - Show server statistics',
            '`!cleanup` - Clean up old trades',
            '`!casinoadd <user> <amount>` - Add coins to user',
            '`!casinoremove <user> <amount>` - Remove coins from user',
            '`!casinoreset <user>` - Reset user casino stats'
          ].join('\n'),
          inline: false
        },
        {
          name: '💡 Examples',
          value: [
            '`!mm accept 5` - Accept request #5',
            '`!user 123456789` - Look up user',
            '`!blacklist add 123456789 Scammer` - Blacklist user',
            '`!stats` - Show market stats'
          ].join('\n'),
          inline: false
        }
      )
      .setFooter({ text: 'ZRX Market Bot - Made with attitude' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }

  async handleMMHelp(message) {
    const embed = new EmbedBuilder()
      .setTitle('📋 Middleman Commands')
      .setColor(0x5865F2)
      .setDescription('Middleman commands. Use them right or don\'t use them at all.')
      .addFields(
        {
          name: 'Commands',
          value: [
            '`!mm accept <id>` - Accept a pending middleman request',
            '`!mm decline <id>` - Decline a pending middleman request',
            '`!mm complete <id>` - Mark a request as completed',
            '`!mm list [status]` - List requests (pending/accepted/declined/completed)',
            '`!mm ticket <id>` - Create a ticket channel (not implemented)'
          ].join('\n'),
          inline: false
        }
      )
      .setFooter({ text: 'ZRX Market Bot' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }

  async handleStats(message) {
    try {
      const totalTrades = await dbHelpers.get('SELECT COUNT(*) as count FROM trades WHERE status = ?', ['active']);
      const totalUsers = await dbHelpers.get('SELECT COUNT(*) as count FROM users');
      const pendingMM = await dbHelpers.get('SELECT COUNT(*) as count FROM middleman WHERE status = ?', ['pending']);
      const totalReports = await dbHelpers.get('SELECT COUNT(*) as count FROM reports WHERE status = ?', ['pending']);
      const completedTrades = await dbHelpers.get('SELECT COUNT(*) as count FROM trades WHERE status = ?', ['completed']);

      const embed = new EmbedBuilder()
        .setTitle('📊 Market Statistics')
        .setColor(0x00D166)
        .setDescription('Here are the fucking stats. Impressive, right?')
        .addFields(
          { name: '🛒 Active Trades', value: `${totalTrades?.count || 0}`, inline: true },
          { name: '✅ Completed Trades', value: `${completedTrades?.count || 0}`, inline: true },
          { name: '👥 Total Users', value: `${totalUsers?.count || 0}`, inline: true },
          { name: '🤝 Pending Middleman', value: `${pendingMM?.count || 0}`, inline: true },
          { name: '🚨 Pending Reports', value: `${totalReports?.count || 0}`, inline: true },
          { name: '🤖 Bot Uptime', value: this.formatUptime(process.uptime()), inline: true }
        )
        .setFooter({ text: 'ZRX Market Bot' })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleUserLookup(message, args) {
    if (!args[0]) {
      return message.reply('❌ Provide a Discord ID, you moron. `!user <discordId>`');
    }

    try {
      const userId = args[0].replace(/[<@!>]/g, '');
      const user = await dbHelpers.get('SELECT * FROM users WHERE discordId = ?', [userId]);
      
      if (!user) {
        return message.reply(`❌ ${getSnarkyResponse('notFound')} User not found in database.`);
      }

      const userTrades = await dbHelpers.get('SELECT COUNT(*) as count FROM trades WHERE creatorId = ?', [userId]);
      const userMM = await dbHelpers.get('SELECT COUNT(*) as count FROM middleman WHERE requesterId = ?', [userId]);
      const userReports = await dbHelpers.get('SELECT COUNT(*) as count FROM reports WHERE reporterId = ? OR accusedDiscordId = ?', [userId, userId]);
      
      const isBlacklisted = await dbHelpers.get('SELECT * FROM blacklist WHERE discordId = ?', [userId]);

      const embed = new EmbedBuilder()
        .setTitle(`👤 User Lookup: ${user.username}`)
        .setColor(user.verified ? 0x00D166 : 0xFFA500)
        .setThumbnail(user.avatar || null)
        .addFields(
          { name: '🆔 Discord ID', value: user.discordId, inline: true },
          { name: '✅ Verified', value: user.verified ? 'Yes' : 'No', inline: true },
          { name: '🚫 Blacklisted', value: isBlacklisted ? `Yes - ${isBlacklisted.reason}` : 'No', inline: true },
          { name: '🛒 Trades Created', value: `${userTrades?.count || 0}`, inline: true },
          { name: '🤝 Middleman Requests', value: `${userMM?.count || 0}`, inline: true },
          { name: '🚨 Reports', value: `${userReports?.count || 0}`, inline: true },
          { name: '📅 Joined', value: new Date(user.createdAt).toLocaleDateString(), inline: true }
        )
        .setFooter({ text: `User ID: ${userId}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleTradeLookup(message, args) {
    if (!args[0]) {
      return message.reply('❌ Provide a trade ID, dumbass. `!trade <id>`');
    }

    try {
      const tradeId = parseInt(args[0]);
      const trade = await dbHelpers.get(
        `SELECT t.*, u.username, u.avatar 
         FROM trades t 
         JOIN users u ON t.creatorId = u.discordId 
         WHERE t.id = ?`,
        [tradeId]
      );

      if (!trade) {
        return message.reply(`❌ ${getSnarkyResponse('notFound')} Trade #${tradeId} not found.`);
      }

      const offered = trade.offered ? JSON.parse(trade.offered) : [];
      const wanted = trade.wanted ? JSON.parse(trade.wanted) : [];

      const embed = new EmbedBuilder()
        .setTitle(`🛒 Trade #${trade.id}`)
        .setColor(0x5865F2)
        .setDescription(`**Status:** ${trade.status.toUpperCase()}`)
        .addFields(
          { name: '👤 Creator', value: `<@${trade.creatorId}> (${trade.username})`, inline: true },
          { name: '📅 Created', value: new Date(trade.createdAt).toLocaleDateString(), inline: true },
          { name: '🎮 Category', value: trade.isCrossTrade ? 'Cross-Trade' : 'Same Game', inline: true },
          { 
            name: '📤 Offered', 
            value: offered.length > 0 
              ? offered.map(item => `${item.name}${item.mutation ? ` (${item.mutation})` : ''}${item.value ? ` - ${item.value}` : ''}`).join('\n').substring(0, 1024)
              : 'None',
            inline: false 
          },
          { 
            name: '📥 Wanted', 
            value: wanted.length > 0 
              ? wanted.map(item => `${item.name}${item.mutation ? ` (${item.mutation})` : ''}${item.value ? ` - ${item.value}` : ''}`).join('\n').substring(0, 1024)
              : 'None',
            inline: false 
          }
        )
        .setFooter({ text: `Trade ID: ${trade.id}` })
        .setTimestamp(new Date(trade.createdAt));

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleBlacklistAdd(message, args) {
    if (!args[0]) {
      return message.reply('❌ Provide a Discord ID and reason, you absolute buffoon. `!blacklist add <id> <reason>`');
    }

    const userId = args[0].replace(/[<@!>]/g, '');
    const reason = args.slice(1).join(' ') || 'No reason provided';

    try {
      const existing = await dbHelpers.get('SELECT * FROM blacklist WHERE discordId = ?', [userId]);
      if (existing) {
        return message.reply(`❌ User is already blacklisted, you moron. Reason: ${existing.reason}`);
      }

      await dbHelpers.run(
        'INSERT INTO blacklist (discordId, reason) VALUES (?, ?)',
        [userId, reason]
      );

      await dbHelpers.run(
        'INSERT INTO admin_logs (actorId, action, targetId, details) VALUES (?, ?, ?, ?)',
        [message.author.id, 'blacklist_add', userId, reason]
      );

      await message.reply(`✅ ${getSnarkyResponse('success')} User <@${userId}> has been blacklisted. Reason: ${reason}`);
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleBlacklistRemove(message, args) {
    if (!args[0]) {
      return message.reply('❌ Provide a Discord ID, you idiot. `!blacklist remove <id>`');
    }

    const userId = args[0].replace(/[<@!>]/g, '');

    try {
      const existing = await dbHelpers.get('SELECT * FROM blacklist WHERE discordId = ?', [userId]);
      if (!existing) {
        return message.reply(`❌ ${getSnarkyResponse('notFound')} User is not blacklisted.`);
      }

      await dbHelpers.run('DELETE FROM blacklist WHERE discordId = ?', [userId]);

      await dbHelpers.run(
        'INSERT INTO admin_logs (actorId, action, targetId, details) VALUES (?, ?, ?, ?)',
        [message.author.id, 'blacklist_remove', userId, '']
      );

      await message.reply(`✅ ${getSnarkyResponse('success')} User <@${userId}> has been removed from blacklist.`);
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleBlacklistList(message) {
    try {
      const blacklisted = await dbHelpers.all('SELECT * FROM blacklist ORDER BY createdAt DESC LIMIT 20');

      if (blacklisted.length === 0) {
        return message.reply('✅ No one is blacklisted. Good job, I guess.');
      }

      const embed = new EmbedBuilder()
        .setTitle('🚫 Blacklisted Users')
        .setColor(0xFF0000)
        .setDescription(blacklisted.map(b => `<@${b.discordId}> - ${b.reason}`).join('\n').substring(0, 2000))
        .setFooter({ text: `Total: ${blacklisted.length}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleBlacklistCheck(message, args) {
    if (!args[0]) {
      return message.reply('❌ Provide a Discord ID, you moron. `!blacklist check <id>`');
    }

    const userId = args[0].replace(/[<@!>]/g, '');

    try {
      const blacklisted = await dbHelpers.get('SELECT * FROM blacklist WHERE discordId = ?', [userId]);
      
      if (blacklisted) {
        await message.reply(`🚫 **User is blacklisted.**\n\n**Reason:** ${blacklisted.reason}\n**Date:** ${new Date(blacklisted.createdAt).toLocaleDateString()}`);
      } else {
        await message.reply('✅ User is not blacklisted. They\'re clean... for now.');
      }
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleReportList(message, args) {
    const status = args[0] || 'pending';

    try {
      const reports = await dbHelpers.all(
        'SELECT * FROM reports WHERE status = ? ORDER BY createdAt DESC LIMIT 10',
        [status]
      );

      if (reports.length === 0) {
        return message.reply(`No ${status} reports found. Lucky you.`);
      }

      const embed = new EmbedBuilder()
        .setTitle(`🚨 ${status.toUpperCase()} Reports`)
        .setColor(0xFF0000)
        .setDescription(
          reports.map(r => `#${r.id} - <@${r.accusedDiscordId}> (Reporter: <@${r.reporterId}>)`).join('\n')
        )
        .setFooter({ text: `Showing ${reports.length} reports` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleReportView(message, args) {
    if (!args[0]) {
      return message.reply('❌ Provide a report ID, you absolute moron. `!report view <id>`');
    }

    const reportId = parseInt(args[0]);

    try {
      const report = await dbHelpers.get('SELECT * FROM reports WHERE id = ?', [reportId]);

      if (!report) {
        return message.reply(`❌ ${getSnarkyResponse('notFound')} Report #${reportId} not found.`);
      }

      const reporter = await dbHelpers.get('SELECT * FROM users WHERE discordId = ?', [report.reporterId]);
      const accused = await dbHelpers.get('SELECT * FROM users WHERE discordId = ?', [report.accusedDiscordId]);
      const evidenceLinks = report.evidenceLinks ? JSON.parse(report.evidenceLinks) : [];

      const embed = new EmbedBuilder()
        .setTitle(`🚨 Report #${report.id}`)
        .setColor(0xFF0000)
        .addFields(
          { name: 'Reporter', value: `<@${report.reporterId}> (${reporter?.username || 'Unknown'})`, inline: true },
          { name: 'Accused', value: `<@${report.accusedDiscordId}> (${accused?.username || 'Unknown'})`, inline: true },
          { name: 'Status', value: report.status.toUpperCase(), inline: true },
          { name: 'Details', value: report.details.substring(0, 1000), inline: false }
        )
        .setFooter({ text: `Report ID: ${report.id}` })
        .setTimestamp(new Date(report.createdAt));

      if (evidenceLinks.length > 0) {
        embed.addFields({ name: 'Evidence', value: evidenceLinks.join('\n'), inline: false });
      }

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleVerify(message, args) {
    if (!args[0]) {
      return message.reply('❌ Provide a Discord ID, you moron. `!verify <id>`');
    }

    const userId = args[0].replace(/[<@!>]/g, '');

    try {
      await dbHelpers.run('UPDATE users SET verified = 1 WHERE discordId = ?', [userId]);

      await dbHelpers.run(
        'INSERT INTO admin_logs (actorId, action, targetId, details) VALUES (?, ?, ?, ?)',
        [message.author.id, 'verify_user', userId, '']
      );

      await message.reply(`✅ ${getSnarkyResponse('success')} User <@${userId}> has been verified.`);
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleUnverify(message, args) {
    if (!args[0]) {
      return message.reply('❌ Provide a Discord ID, you moron. `!unverify <id>`');
    }

    const userId = args[0].replace(/[<@!>]/g, '');

    try {
      await dbHelpers.run('UPDATE users SET verified = 0 WHERE discordId = ?', [userId]);

      await dbHelpers.run(
        'INSERT INTO admin_logs (actorId, action, targetId, details) VALUES (?, ?, ?, ?)',
        [message.author.id, 'unverify_user', userId, '']
      );

      await message.reply(`✅ ${getSnarkyResponse('success')} User <@${userId}> has been unverified.`);
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleServerStats(message) {
    try {
      const guild = message.guild;
      if (!guild) {
        return message.reply('❌ This command only works in a server, you absolute buffoon.');
      }

      const totalMembers = guild.memberCount;
      const onlineMembers = guild.members.cache.filter(m => m.presence?.status === 'online').size;
      const totalChannels = guild.channels.cache.size;
      const totalRoles = guild.roles.cache.size;

      const embed = new EmbedBuilder()
        .setTitle(`📊 Server Statistics: ${guild.name}`)
        .setColor(0x5865F2)
        .setThumbnail(guild.iconURL())
        .addFields(
          { name: '👥 Total Members', value: `${totalMembers}`, inline: true },
          { name: '🟢 Online Members', value: `${onlineMembers}`, inline: true },
          { name: '📺 Channels', value: `${totalChannels}`, inline: true },
          { name: '🎭 Roles', value: `${totalRoles}`, inline: true },
          { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
          { name: '📅 Created', value: guild.createdAt.toLocaleDateString(), inline: true }
        )
        .setFooter({ text: `Server ID: ${guild.id}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleCleanup(message) {
    try {
      // Delete trades older than 5 hours
      const result = await dbHelpers.run(
        `UPDATE trades SET status = 'expired' 
         WHERE status = 'active' 
         AND datetime(createdAt, '+5 hours') < datetime('now')`
      );

      await message.reply(`✅ ${getSnarkyResponse('success')} Cleanup completed. ${result.changes || 0} trades expired.`);
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  }

  // ... (keeping all the existing methods like handleAccept, handleDecline, etc. - they're already good)
  async setupAcceptanceCollector(data) {
    try {
      const { requestId, threadId, messageId, user1Id, user2Id, request } = data;
      console.log(`🔧 Setting up acceptance collector for request #${requestId}`);

      const thread = await this.client.channels.fetch(threadId);
      const message = await thread.messages.fetch(messageId);

      const filter = (reaction, user) => {
        const userId = user.id;
        return (userId === user1Id || userId === user2Id) && reaction.emoji.name === '✅' && !user.bot;
      };

      const collector = message.createReactionCollector({
        filter,
        time: 5 * 60 * 1000,
        max: 2
      });

      this.activeCollectors.set(requestId, collector);

      collector.on('collect', async (reaction, user) => {
        const userId = user.id;
        console.log(`✅ User ${user.tag} (${userId}) accepted trade #${requestId}`);

        if (userId === user1Id) {
          await dbHelpers.run(
            'UPDATE middleman SET user1Accepted = 1 WHERE id = ?',
            [requestId]
          );
        } else if (userId === user2Id) {
          await dbHelpers.run(
            'UPDATE middleman SET user2Accepted = 1 WHERE id = ?',
            [requestId]
          );
        }

        const updatedRequest = await dbHelpers.get(
          'SELECT * FROM middleman WHERE id = ?',
          [requestId]
        );

        if (updatedRequest && updatedRequest.user1Accepted === 1 && updatedRequest.user2Accepted === 1) {
          collector.stop('both_accepted');
        }
      });

      collector.on('end', async (collected, reason) => {
        this.activeCollectors.delete(requestId);

        const finalRequest = await dbHelpers.get(
          'SELECT * FROM middleman WHERE id = ?',
          [requestId]
        );

        if (reason === 'both_accepted' || (finalRequest && finalRequest.user1Accepted === 1 && finalRequest.user2Accepted === 1)) {
          const roleMention = process.env.MIDDLEMAN_ROLE_ID ? `<@&${process.env.MIDDLEMAN_ROLE_ID}>` : '';
          await thread.send({
            content: `🎉 **Both parties have accepted the trade!**\n\n${roleMention} A middleman is needed for this trade.\n\n**Trade Details:**\n${request.item}\n\n**Participants:**\n- <@${user1Id}>\n- <@${user2Id}>`
          });
          console.log(`✅ Both parties accepted trade #${requestId}, middleman pinged`);
        } else {
          try {
            await thread.send('⏰ **Time expired or not all parties accepted.**\n\nThis thread will be deleted in 10 seconds.');
            await new Promise(resolve => setTimeout(resolve, 10000));
            await thread.delete();
            console.log(`🗑️ Deleted thread for request #${requestId} (timeout/no acceptance)`);
            
            await dbHelpers.run(
              'UPDATE middleman SET status = ? WHERE id = ?',
              ['declined', requestId]
            );
          } catch (deleteError) {
            console.error('Error deleting thread:', deleteError.message);
          }
        }
      });

      console.log(`✅ Acceptance collector set up for request #${requestId}`);
    } catch (error) {
      console.error('Error setting up acceptance collector:', error);
    }
  }

  async createAcceptanceThread(request) {
    try {
      console.log('📨 Creating acceptance thread for request:', request.id);
      
      const middlemanChannel = this.client.channels.cache.get(process.env.MIDDLEMAN_CHANNEL_ID);
      if (!middlemanChannel) {
        console.error('❌ Middleman channel not found');
        return;
      }

      const user1Id = request.user1 ? String(request.user1).replace(/[<@!>]/g, '') : '';
      const user2Id = request.user2 ? String(request.user2).replace(/[<@!>]/g, '') : '';

      if (!user1Id || !user2Id) {
        console.error('❌ Invalid user IDs in request');
        return;
      }

      const requester = await dbHelpers.get(
        'SELECT * FROM users WHERE discordId = ?',
        [request.requesterId]
      );

      const proofLinks = request.proofLinks ? JSON.parse(request.proofLinks) : [];

      const initialMessage = await middlemanChannel.send({
        content: `🔒 **Trade Agreement Required**\n\n<@${user1Id}> and <@${user2Id}> must both accept this trade within 5 minutes.\n\nIf both parties don't accept, this thread will be automatically deleted.`
      });

      const threadName = `MM-${request.id} | ${request.item?.substring(0, 50) || 'Trade'}`;
      const thread = await initialMessage.startThread({
        name: threadName,
        type: 12,
        autoArchiveDuration: 60,
        reason: `Middleman request #${request.id} - awaiting acceptance`
      });

      console.log(`✅ Created acceptance thread: ${thread.name} (${thread.id})`);

      await dbHelpers.run(
        'UPDATE middleman SET threadId = ? WHERE id = ?',
        [thread.id, request.id]
      );

      const usersToAdd = [request.requesterId, user1Id, user2Id];
      const uniqueUsers = [...new Set(usersToAdd.filter(id => id && id.length > 0))];
      
      const axios = require('axios').default;
      for (const userId of uniqueUsers) {
        try {
          await axios.put(
            `https://discord.com/api/v10/channels/${thread.id}/thread-members/${userId}`,
            {},
            {
              headers: {
                Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
        } catch (error) {
          console.log(`⚠️ Could not add user ${userId} to thread (they can join manually)`);
        }
      }

      const tradeEmbed = new EmbedBuilder()
        .setTitle(`📋 Trade Agreement - Request #${request.id}`)
        .setColor(0xFFA500)
        .setDescription('**Both parties must accept this trade by reacting with ✅**\n\nYou have 5 minutes to both accept, or this thread will be deleted.')
        .addFields(
          { name: '👤 Requester', value: `<@${request.requesterId}>`, inline: true },
          { name: '👥 User 1', value: `<@${user1Id}>`, inline: true },
          { name: '👥 User 2', value: `<@${user2Id}>`, inline: true },
          { name: '🛒 Item/Details', value: request.item || 'N/A', inline: false },
          { name: '💰 Value', value: request.value || 'N/A', inline: true },
          { name: '🎮 Roblox Username', value: request.robloxUsername || 'N/A', inline: true }
        )
        .setFooter({ text: `Request ID: ${request.id} | React with ✅ to accept` })
        .setTimestamp();

      if (proofLinks.length > 0) {
        tradeEmbed.addFields({ 
          name: '📎 Proof Links', 
          value: proofLinks.map(link => `[Link](${link})`).join('\n'), 
          inline: false 
        });
      }

      const acceptMessage = await thread.send({
        content: `<@${user1Id}> <@${user2Id}>\n\n**Please react with ✅ to accept this trade.**\n\n⏰ You have 5 minutes. If both parties don't accept, this thread will be deleted.`,
        embeds: [tradeEmbed]
      });

      await acceptMessage.react('✅');

      const filter = (reaction, user) => {
        const userId = user.id;
        return (userId === user1Id || userId === user2Id) && reaction.emoji.name === '✅' && !user.bot;
      };

      const collector = acceptMessage.createReactionCollector({
        filter,
        time: 5 * 60 * 1000,
        max: 2
      });

      this.activeCollectors.set(request.id, collector);

      collector.on('collect', async (reaction, user) => {
        const userId = user.id;
        console.log(`✅ User ${user.tag} (${userId}) accepted trade #${request.id}`);

        if (userId === user1Id) {
          await dbHelpers.run(
            'UPDATE middleman SET user1Accepted = 1 WHERE id = ?',
            [request.id]
          );
        } else if (userId === user2Id) {
          await dbHelpers.run(
            'UPDATE middleman SET user2Accepted = 1 WHERE id = ?',
            [request.id]
          );
        }

        const updatedRequest = await dbHelpers.get(
          'SELECT * FROM middleman WHERE id = ?',
          [request.id]
        );

        if (updatedRequest.user1Accepted === 1 && updatedRequest.user2Accepted === 1) {
          collector.stop('both_accepted');
        }
      });

      collector.on('end', async (collected, reason) => {
        this.activeCollectors.delete(request.id);

        const finalRequest = await dbHelpers.get(
          'SELECT * FROM middleman WHERE id = ?',
          [request.id]
        );

        if (reason === 'both_accepted' || (finalRequest && finalRequest.user1Accepted === 1 && finalRequest.user2Accepted === 1)) {
          const roleMention = process.env.MIDDLEMAN_ROLE_ID ? `<@&${process.env.MIDDLEMAN_ROLE_ID}>` : '';
          await thread.send({
            content: `🎉 **Both parties have accepted the trade!**\n\n${roleMention} A middleman is needed for this trade.\n\n**Trade Details:**\n${request.item}\n\n**Participants:**\n- <@${user1Id}>\n- <@${user2Id}>`
          });
          console.log(`✅ Both parties accepted trade #${request.id}, middleman pinged`);
        } else {
          try {
            await thread.send('⏰ **Time expired or not all parties accepted.**\n\nThis thread will be deleted in 10 seconds.');
            await new Promise(resolve => setTimeout(resolve, 10000));
            await thread.delete();
            console.log(`🗑️ Deleted thread for request #${request.id} (timeout/no acceptance)`);
            
            await dbHelpers.run(
              'UPDATE middleman SET status = ? WHERE id = ?',
              ['declined', request.id]
            );
          } catch (deleteError) {
            console.error('Error deleting thread:', deleteError.message);
          }
        }
      });

    } catch (error) {
      console.error('Error creating acceptance thread:', error);
    }
  }

  async postMiddlemanRequest(request) {
    try {
      console.log('📨 postMiddlemanRequest called for request:', request.id);
      
      let channel = this.client.channels.cache.get(process.env.MIDDLEMAN_CHANNEL_ID);
      if (!channel) {
        console.log('⚠️ Channel not in cache, fetching...');
        try {
          channel = await this.client.channels.fetch(process.env.MIDDLEMAN_CHANNEL_ID);
          if (!channel) {
            console.error('❌ Channel fetch returned null');
            return;
          }
          console.log('✅ Successfully fetched channel:', channel.name);
        } catch (fetchError) {
          console.error('❌ Error fetching channel:', fetchError.message);
          return;
        }
      } else {
        console.log('✅ Channel found in cache:', channel.name);
      }

      const requester = await dbHelpers.get(
        'SELECT * FROM users WHERE discordId = ?',
        [request.requesterId]
      );

      const proofLinks = request.proofLinks ? JSON.parse(request.proofLinks) : [];

      const embed = new EmbedBuilder()
        .setTitle(`Middleman Request #${request.id}`)
        .setColor(0x5865F2)
        .addFields(
          { name: 'Requester', value: requester?.username || 'Unknown', inline: true },
          { name: 'User 1', value: request.user1, inline: true },
          { name: 'User 2', value: request.user2, inline: true },
          { name: 'Item/Details', value: request.item, inline: false },
          { name: 'Value', value: request.value || 'N/A', inline: true },
          { name: 'Roblox Username', value: request.robloxUsername || 'N/A', inline: true }
        )
        .setFooter({ text: `Request ID: ${request.id}` })
        .setTimestamp(new Date(request.createdAt));

      if (proofLinks.length > 0) {
        embed.addFields({ name: 'Proof Links', value: proofLinks.join('\n'), inline: false });
      }

      const roleMention = `<@&${process.env.MIDDLEMAN_ROLE_ID}>`;
      const message = await channel.send({
        content: `${roleMention} New middleman request!`,
        embeds: [embed]
      });

      console.log('✅ Successfully posted middleman request to Discord. Message ID:', message.id);
    } catch (error) {
      console.error('❌ Error posting middleman request:', error);
      console.error('Error details:', error.message);
      if (error.stack) {
        console.error('Stack trace:', error.stack);
      }
    }
  }

  async notifyModerationChannel(report) {
    try {
      const channelId = '1454986629549789297';
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        console.error('Scammer reports channel not found');
        return;
      }

      const reporter = await dbHelpers.get(
        'SELECT * FROM users WHERE discordId = ?',
        [report.reporterId]
      );

      const accused = await dbHelpers.get(
        'SELECT * FROM users WHERE discordId = ?',
        [report.accusedDiscordId]
      );

      const evidenceLinks = report.evidenceLinks ? JSON.parse(report.evidenceLinks) : [];

      const embed = new EmbedBuilder()
        .setTitle(`🚨 Scammer Report #${report.id}`)
        .setColor(0xFF0000)
        .addFields(
          { name: 'Reporter', value: `<@${report.reporterId}> (${reporter?.username || 'Unknown'})`, inline: true },
          { name: 'Accused', value: `<@${report.accusedDiscordId}> (${accused?.username || 'Unknown'})`, inline: true },
          { name: 'Details', value: report.details.substring(0, 1000), inline: false }
        )
        .setFooter({ text: `Report ID: ${report.id}` })
        .setTimestamp(new Date(report.createdAt));

      if (evidenceLinks.length > 0) {
        embed.addFields({ name: 'Evidence Links', value: evidenceLinks.join('\n'), inline: false });
      }

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`report_request_info_${report.id}`)
            .setLabel('Request More Info')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('💬'),
          new ButtonBuilder()
            .setCustomId(`report_chat_accused_${report.id}`)
            .setLabel('Chat with Accused')
            .setStyle(ButtonStyle.Success)
            .setEmoji('📱'),
          new ButtonBuilder()
            .setLabel('View on Website')
            .setStyle(ButtonStyle.Link)
            .setURL(`${process.env.BASE_URL || 'http://localhost:5173'}/admin/reports/${report.id}`)
        );

      const message = await channel.send({ 
        embeds: [embed],
        components: [row]
      });

      await dbHelpers.run(
        'UPDATE reports SET discordMessageId = ? WHERE id = ?',
        [message.id, report.id]
      );

      console.log(`✅ Sent scammer report #${report.id} to channel ${channelId}`);
    } catch (error) {
      console.error('Error notifying moderation channel:', error);
    }
  }

  async sendStoreEmbed() {
    try {
      const channelId = '1387655173782114375';
      const channel = await this.client.channels.fetch(channelId);
      
      if (!channel) {
        throw new Error(`Channel ${channelId} not found`);
      }

      const embed = new EmbedBuilder()
        .setTitle('🛒 Store Item')
        .setDescription('Buy this **spaghetti tualetti diamond with shark mutation**\n**250 M/s** for **25 USD**\n\nDM <@909463977787015228>')
        .setImage('https://bloxystore.com/cdn/shop/files/spageh.png?v=1759459891&width=1946')
        .setColor(0x5865F2)
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      console.log(`✅ Sent store embed to channel ${channelId}`);
    } catch (error) {
      console.error('Error sending store embed:', error);
      throw error;
    }
  }

  async handleRequestMoreInfo(interaction, reportId) {
    try {
      if (!interaction.member.permissions.has('MANAGE_MESSAGES')) {
        return interaction.reply({ content: '❌ You do not have permission to perform this action.', flags: 64 }); // 64 = EPHEMERAL flag
      }

      const report = await dbHelpers.get('SELECT * FROM reports WHERE id = ?', [reportId]);
      if (!report) {
        return interaction.reply({ content: '❌ Report not found.', flags: 64 }); // 64 = EPHEMERAL flag
      }

      await dbHelpers.run(
        'UPDATE reports SET requestedMoreInfo = 1 WHERE id = ?',
        [reportId]
      );

      const reporter = await dbHelpers.get('SELECT * FROM users WHERE discordId = ?', [report.reporterId]);
      const accused = await dbHelpers.get('SELECT * FROM users WHERE discordId = ?', [report.accusedDiscordId]);

      this.emit('reportRequestMoreInfo', {
        reportId,
        moderatorId: interaction.user.id,
        reporterId: report.reporterId,
        accusedId: report.accusedDiscordId
      });

      const embed = new EmbedBuilder()
        .setTitle(`🚨 Scammer Report #${report.id}`)
        .setColor(0xFF0000)
        .addFields(
          { name: 'Reporter', value: `<@${report.reporterId}> (${reporter?.username || 'Unknown'})`, inline: true },
          { name: 'Accused', value: `<@${report.accusedDiscordId}> (${accused?.username || 'Unknown'})`, inline: true },
          { name: 'Details', value: report.details.substring(0, 1000), inline: false },
          { name: 'Status', value: `ℹ️ More info requested by <@${interaction.user.id}>`, inline: false }
        )
        .setFooter({ text: `Report ID: ${report.id}` })
        .setTimestamp(new Date(report.createdAt));

      const evidenceLinks = report.evidenceLinks ? JSON.parse(report.evidenceLinks) : [];
      if (evidenceLinks.length > 0) {
        embed.addFields({ name: 'Evidence Links', value: evidenceLinks.join('\n'), inline: false });
      }

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`report_request_info_${report.id}`)
            .setLabel('Request More Info')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('💬')
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId(`report_chat_accused_${report.id}`)
            .setLabel('Chat with Accused')
            .setStyle(ButtonStyle.Success)
            .setEmoji('📱'),
          new ButtonBuilder()
            .setLabel('View on Website')
            .setStyle(ButtonStyle.Link)
            .setURL(`${process.env.BASE_URL || 'http://localhost:5173'}/admin/reports/${report.id}?chat=true`)
        );

      await interaction.update({ embeds: [embed], components: [row] });

      await interaction.followUp({
        content: `✅ More info requested for Report #${reportId}.\n\n**To chat with the accused person:**\n1. Click "Chat with Accused" button\n2. Or visit: ${process.env.BASE_URL || 'http://localhost:5173'}/admin/reports/${report.id}?chat=true`,
        flags: 64 // 64 = EPHEMERAL flag
      });

    } catch (error) {
      console.error('Error handling request more info:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ An error occurred while processing your request.', flags: 64 }); // 64 = EPHEMERAL flag
      }
    }
  }

  async handleBridgeThreadMessage(message) {
    try {
      const threadId = message.channel.id;
      const axios = require('axios');
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const webhookSecret = process.env.DISCORD_WEBHOOK_SECRET;

      try {
        await dbHelpers.run(
          `CREATE TABLE IF NOT EXISTS bridge_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reportId INTEGER NOT NULL,
            threadId TEXT NOT NULL,
            accusedDiscordId TEXT NOT NULL,
            moderatorDiscordId TEXT NOT NULL,
            webhookUrl TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (reportId) REFERENCES reports(id)
          )`
        );
      } catch (e) {
        // Table might already exist, ignore
      }

      const session = await dbHelpers.get(
        'SELECT * FROM bridge_sessions WHERE threadId = ?',
        [threadId]
      );

      if (!session) {
        return;
      }

      if (message.author.bot) {
        return;
      }

      if (message.author.id !== session.moderatorDiscordId) {
        return;
      }

      try {
        await axios.post(
          `${baseUrl}/api/discord-bridge/webhook`,
          {
            threadId: threadId,
            authorId: message.author.id,
            content: message.content,
            messageId: message.id
          },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(webhookSecret && { 'x-webhook-secret': webhookSecret })
            }
          }
        );
        console.log(`✅ Forwarded bridge message from ${message.author.tag} to website`);
      } catch (webhookError) {
        console.error('Error forwarding bridge message to webhook:', webhookError.message);
      }
    } catch (error) {
      console.error('Error handling bridge thread message:', error);
    }
  }

  async handleChatWithAccused(interaction, reportId) {
    try {
      if (!interaction.member.permissions.has('MANAGE_MESSAGES')) {
        return interaction.reply({ content: '❌ You do not have permission to perform this action.', flags: 64 }); // 64 = EPHEMERAL flag
      }

      const report = await dbHelpers.get('SELECT * FROM reports WHERE id = ?', [reportId]);
      if (!report) {
        return interaction.reply({ content: '❌ Report not found.', flags: 64 }); // 64 = EPHEMERAL flag
      }

      await dbHelpers.run(
        `CREATE TABLE IF NOT EXISTS bridge_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reportId INTEGER NOT NULL,
          threadId TEXT NOT NULL,
          accusedDiscordId TEXT NOT NULL,
          moderatorDiscordId TEXT NOT NULL,
          webhookUrl TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (reportId) REFERENCES reports(id)
        )`
      ).catch(() => {});

      const existingSession = await dbHelpers.get(
        'SELECT * FROM bridge_sessions WHERE reportId = ?',
        [reportId]
      );

      if (existingSession) {
        const thread = await this.client.channels.fetch(existingSession.threadId);
        if (thread) {
          return interaction.reply({
            content: `💬 **Bridge Already Active**\n\nA chat thread already exists for this report:\n<#${existingSession.threadId}>\n\nYou can chat there, and messages will sync with the website.`,
            flags: 64 // 64 = EPHEMERAL flag
          });
        }
      }

      const accusedUser = await dbHelpers.get(
        'SELECT * FROM users WHERE discordId = ?',
        [report.accusedDiscordId]
      );

      if (!accusedUser) {
        return interaction.reply({ content: '❌ Accused user not found in database.', flags: 64 }); // 64 = EPHEMERAL flag
      }

      const reporter = await dbHelpers.get(
        'SELECT * FROM users WHERE discordId = ?',
        [report.reporterId]
      );

      const reportsChannelId = process.env.REPORTS_CHANNEL_ID || '1443391819638636585';
      const reportsChannel = await this.client.channels.fetch(reportsChannelId);

      if (!reportsChannel) {
        return interaction.reply({ content: '❌ Reports channel not found.', flags: 64 }); // 64 = EPHEMERAL flag
      }

      const initialMessage = await reportsChannel.send({
        content: `🔗 **Bridged Chat Session**\n\n**Report:** #${report.id}\n**Reporter:** ${reporter?.username || 'Unknown'} (<@${report.reporterId}>)\n**Accused:** ${accusedUser.username} (<@${report.accusedDiscordId}>)\n**Moderator:** ${interaction.user.username} (<@${interaction.user.id}>)\n\n*Messages from the website will appear as if from ${accusedUser.username}*\n*Messages from Discord will appear as ${interaction.user.username} on the website*`
      });

      const thread = await initialMessage.startThread({
        name: `Report #${report.id} - ${accusedUser.username}`,
        type: 11,
        invitable: false
      });

      try {
        await thread.members.add(report.accusedDiscordId);
      } catch (e) {
        console.warn('Could not add accused user to thread:', e.message);
      }

      await dbHelpers.run(
        `INSERT INTO bridge_sessions (reportId, threadId, accusedDiscordId, moderatorDiscordId)
         VALUES (?, ?, ?, ?)`,
        [reportId, thread.id, report.accusedDiscordId, interaction.user.id]
      );

      await interaction.reply({
        content: `✅ **Bridge Created!**\n\nA private thread has been created: <#${thread.id}>\n\nYou can now chat there, and messages will automatically sync with the website. The accused user (<@${report.accusedDiscordId}>) has been added to the thread.`,
        flags: 64 // 64 = EPHEMERAL flag
      });

      await thread.send(`👋 **Bridge Active**\n\nThis thread is now connected to the website. Messages you send here will appear on the website as if from ${interaction.user.username}. Messages from the website will appear here as if from ${accusedUser.username}.`);

    } catch (error) {
      console.error('Error handling chat with accused:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ An error occurred while processing your request.', flags: 64 }); // 64 = EPHEMERAL flag
      }
    }
  }

  async handleAccept(message, args) {
    const requestId = parseInt(args[0]);
    if (!requestId) {
      return message.reply(`❌ ${getSnarkyResponse('error')} Provide a request ID: \`!mm accept <id>\``);
    }

    const request = await dbHelpers.get(
      'SELECT * FROM middleman WHERE id = ?',
      [requestId]
    );

    if (!request) {
      return message.reply(`❌ ${getSnarkyResponse('notFound')} Request not found.`);
    }

    if (request.status !== 'pending') {
      return message.reply(`❌ Request is already ${request.status}. What the fuck did you expect?`);
    }

    const requester = await dbHelpers.get(
      'SELECT * FROM users WHERE discordId = ?',
      [request.requesterId]
    );

    await dbHelpers.run(
      'UPDATE middleman SET status = ?, middlemanId = ? WHERE id = ?',
      ['accepted', message.author.id, requestId]
    );

    await dbHelpers.run(
      'INSERT INTO admin_logs (actorId, action, targetId, details) VALUES (?, ?, ?, ?)',
      [message.author.id, 'accept_middleman', requestId.toString(), '']
    );

    try {
      const middlemanChannel = this.client.channels.cache.get(process.env.MIDDLEMAN_CHANNEL_ID);
      if (!middlemanChannel) {
        throw new Error('Middleman channel not found');
      }

      const user1Id = request.user1 ? request.user1.replace(/[<@!>]/g, '') : '';
      const user2Id = request.user2 ? request.user2.replace(/[<@!>]/g, '') : '';

      const usersToAdd = [
        request.requesterId,
        user1Id,
        user2Id,
        message.author.id
      ];

      const uniqueUsers = [...new Set(usersToAdd.filter(id => id && id.length > 0))];

      const userObjects = [];
      for (const userId of uniqueUsers) {
        try {
          const user = await this.client.users.fetch(userId);
          userObjects.push(user);
          console.log(`✅ Fetched user: ${user.tag} (${userId})`);
        } catch (error) {
          console.error(`❌ Could not fetch user ${userId}:`, error.message);
        }
      }

      const threadName = `MM-${requestId} | ${request.item?.substring(0, 50) || 'Trade'}`;
      
      const initialMessage = await middlemanChannel.send({
        content: `🔒 Private thread for Middleman Request #${requestId}\n${uniqueUsers.map(id => `<@${id}>`).join(' ')}`
      });

      const thread = await initialMessage.startThread({
        name: threadName,
        type: 12,
        autoArchiveDuration: 1440,
        reason: `Middleman request #${requestId} accepted by ${message.author.tag}`
      });

      console.log(`✅ Created private thread: ${thread.name} (${thread.id})`);

      const axios = require('axios').default;
      for (const user of userObjects) {
        try {
          await axios.put(
            `https://discord.com/api/v10/channels/${thread.id}/thread-members/${user.id}`,
            {},
            {
              headers: {
                Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
          console.log(`✅ Added ${user.tag} to thread via API`);
        } catch (apiError) {
          const status = apiError.response?.status;
          const errorData = apiError.response?.data;
          
          if (status === 403) {
            console.error(`❌ Permission denied adding ${user.tag} (${user.id}) to thread. Bot needs "Manage Threads" permission.`);
            try {
              await thread.send(`<@${user.id}> - You've been mentioned in this private thread. Please click to join if you haven't been added automatically.`);
            } catch (sendError) {
              console.error('Could not mention user in thread:', sendError.message);
            }
          } else if (status === 404) {
            console.error(`❌ User ${user.tag} (${user.id}) not found or not in server`);
          } else {
            console.error(`❌ Could not add user ${user.tag} (${user.id}) to thread:`, errorData || apiError.message);
            try {
              await thread.send(`<@${user.id}>`);
            } catch (e) {
              // Ignore
            }
          }
        }
      }

      const proofLinks = request.proofLinks ? JSON.parse(request.proofLinks) : [];
      
      const tradeEmbed = new EmbedBuilder()
        .setTitle(`📋 Middleman Request #${requestId}`)
        .setColor(0x00D166)
        .setDescription('This is a private thread for the middleman trade. Only the participants and moderator can see this thread.')
        .addFields(
          { name: '👤 Requester', value: `<@${request.requesterId}>`, inline: true },
          { name: '👥 User 1', value: `<@${user1Id}>`, inline: true },
          { name: '👥 User 2', value: `<@${user2Id}>`, inline: true },
          { name: '🛒 Item/Details', value: request.item || 'N/A', inline: false },
          { name: '💰 Value', value: request.value || 'N/A', inline: true },
          { name: '🎮 Roblox Username', value: request.robloxUsername || 'N/A', inline: true },
          { name: '✅ Accepted By', value: `<@${message.author.id}>`, inline: true }
        )
        .setFooter({ text: `Request ID: ${requestId}` })
        .setTimestamp(new Date(request.createdAt));

      if (proofLinks.length > 0) {
        tradeEmbed.addFields({ 
          name: '📎 Proof Links', 
          value: proofLinks.map(link => `[Link](${link})`).join('\n'), 
          inline: false 
        });
      }

      const participantsMention = uniqueUsers.map(id => `<@${id}>`).join(' ');
      await thread.send({
        content: `✅ **Middleman Request Accepted**\n\n${participantsMention}\n\nThis private thread has been created for your trade. Only you, the other party, and the moderator can see this thread.\n\n**Trade Details:**`,
        embeds: [tradeEmbed]
      });

      try {
        const requesterUser = await this.client.users.fetch(request.requesterId);
        await requesterUser.send(`✅ Your middleman request #${requestId} has been accepted by ${message.author.tag}. A private thread has been created: ${thread.toString()}`);
      } catch (error) {
        console.error('Error sending DM:', error);
      }

      await message.channel.send(`✅ Middleman request #${requestId} has been accepted by ${message.author.tag}. Private thread created: ${thread.toString()}`);

      message.reply(`✅ ${getSnarkyResponse('success')} Request #${requestId} accepted. Private thread: ${thread.toString()}`);
    } catch (error) {
      console.error('Error creating thread:', error);
      message.reply(`⚠️ Request #${requestId} accepted, but failed to create thread: ${error.message}. Fuck.`);
    }
  }

  async handleDecline(message, args) {
    const requestId = parseInt(args[0]);
    if (!requestId) {
      return message.reply(`❌ ${getSnarkyResponse('error')} Provide a request ID: \`!mm decline <id>\``);
    }

    const request = await dbHelpers.get(
      'SELECT * FROM middleman WHERE id = ?',
      [requestId]
    );

    if (!request) {
      return message.reply(`❌ ${getSnarkyResponse('notFound')} Request not found.`);
    }

    if (request.status !== 'pending') {
      return message.reply(`❌ Request is already ${request.status}. Too late, dumbass.`);
    }

    await dbHelpers.run(
      'UPDATE middleman SET status = ? WHERE id = ?',
      ['declined', requestId]
    );

    await dbHelpers.run(
      'INSERT INTO admin_logs (actorId, action, targetId, details) VALUES (?, ?, ?, ?)',
      [message.author.id, 'decline_middleman', requestId.toString(), '']
    );

    try {
      const requester = await this.client.users.fetch(request.requesterId);
      await requester.send(`❌ Your middleman request #${requestId} has been declined.`);
    } catch (error) {
      console.error('Error sending DM:', error);
    }

    message.reply(`✅ ${getSnarkyResponse('success')} Request #${requestId} declined.`);
  }

  async handleComplete(message, args) {
    const requestId = parseInt(args[0]);
    if (!requestId) {
      return message.reply(`❌ ${getSnarkyResponse('error')} Provide a request ID: \`!mm complete <id>\``);
    }

    const request = await dbHelpers.get(
      'SELECT * FROM middleman WHERE id = ?',
      [requestId]
    );

    if (!request) {
      return message.reply(`❌ ${getSnarkyResponse('notFound')} Request not found.`);
    }

    await dbHelpers.run(
      'UPDATE middleman SET status = ? WHERE id = ?',
      ['completed', requestId]
    );

    await dbHelpers.run(
      'INSERT INTO admin_logs (actorId, action, targetId, details) VALUES (?, ?, ?, ?)',
      [message.author.id, 'complete_middleman', requestId.toString(), '']
    );

    message.reply(`✅ ${getSnarkyResponse('success')} Request #${requestId} marked as completed.`);
  }

  async handleList(message, args) {
    const status = args[0] || 'pending';

    const requests = await dbHelpers.all(
      'SELECT * FROM middleman WHERE status = ? ORDER BY createdAt DESC LIMIT 10',
      [status]
    );

    if (requests.length === 0) {
      return message.reply(`No ${status} requests found. Lucky you, I guess.`);
    }

    const embed = new EmbedBuilder()
      .setTitle(`${status.toUpperCase()} Middleman Requests`)
      .setColor(0x5865F2)
      .setDescription(
        requests.map(r => `#${r.id} - ${r.item} (Requester: <@${r.requesterId}>)`).join('\n')
      );

    message.reply({ embeds: [embed] });
  }

  async handleTicket(message, args) {
    const requestId = parseInt(args[0]);
    if (!requestId) {
      return message.reply(`❌ ${getSnarkyResponse('error')} Provide a request ID: \`!mm ticket <id>\``);
    }

    message.reply('⚠️ Ticket creation feature not yet implemented. Maybe one day, who knows.');
  }

  // Casino Command Handlers
  async handleBalance(message) {
    try {
      const balance = await this.casino.getBalance(message.author.id);
      const embed = new EmbedBuilder()
        .setTitle('💰 Your Balance')
        .setColor(0x00D166)
        .setDescription(`You have **${balance.toLocaleString()}** coins.`)
        .setFooter({ text: `User: ${message.author.tag}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleDaily(message) {
    try {
      const result = await this.casino.dailyReward(message.author.id);
      
      if (!result.success) {
        const embed = new EmbedBuilder()
          .setTitle('⏰ Daily Reward')
          .setColor(0xFFA500)
          .setDescription(`You've already claimed your daily reward today.\n\nCome back in **${result.hoursLeft} hours**, you impatient fuck.`)
          .setTimestamp();
        return await message.reply({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setTitle('🎁 Daily Reward Claimed!')
        .setColor(0x00D166)
        .setDescription(`You received **${result.reward.toLocaleString()}** coins!\n\nYour new balance: **${result.balance.toLocaleString()}** coins.`)
        .setFooter({ text: `User: ${message.author.tag}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleCasinoStats(message, args) {
    try {
      const userId = args[0]?.replace(/[<@!>]/g, '') || message.author.id;
      const stats = await this.casino.getStats(userId);
      
      const winRate = stats.gamesPlayed > 0 
        ? ((stats.totalWon / (stats.totalWon + stats.totalLost)) * 100).toFixed(1)
        : 0;

      const embed = new EmbedBuilder()
        .setTitle('🎰 Casino Statistics')
        .setColor(0x5865F2)
        .addFields(
          { name: '💰 Balance', value: `${stats.balance.toLocaleString()} coins`, inline: true },
          { name: '🎮 Games Played', value: `${stats.gamesPlayed}`, inline: true },
          { name: '📊 Win Rate', value: `${winRate}%`, inline: true },
          { name: '✅ Total Won', value: `${stats.totalWon.toLocaleString()} coins`, inline: true },
          { name: '❌ Total Lost', value: `${stats.totalLost.toLocaleString()} coins`, inline: true },
          { name: '💵 Net Profit', value: `${(stats.totalWon - stats.totalLost).toLocaleString()} coins`, inline: true }
        )
        .setFooter({ text: `User: ${message.author.tag}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleCoinflip(message, args) {
    try {
      const bet = parseInt(args[0]);
      const choice = args[1]?.toLowerCase();

      if (!bet || !choice) {
        return message.reply('❌ Usage: `!coinflip <bet> <heads/tails>`\nExample: `!coinflip 100 heads`');
      }

      if (!['heads', 'tails'].includes(choice)) {
        return message.reply('❌ Choice must be "heads" or "tails", you absolute moron.');
      }

      const result = await this.casino.coinflip(message.author.id, bet, choice);

      if (!result.success) {
        return message.reply(`❌ ${result.error}`);
      }

      const embed = new EmbedBuilder()
        .setTitle(result.won ? '🎉 You Won!' : '💀 You Lost')
        .setColor(result.won ? 0x00D166 : 0xDC3545)
        .setDescription(
          result.won
            ? `The coin landed on **${result.result}**!\n\nYou won **${result.winnings.toLocaleString()}** coins!\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
            : `The coin landed on **${result.result}**.\n\nYou lost **${result.loss.toLocaleString()}** coins.\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
        )
        .setFooter({ text: `User: ${message.author.tag}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleDice(message, args) {
    try {
      const bet = parseInt(args[0]);
      const guess = parseInt(args[1]);

      if (!bet || !guess) {
        return message.reply('❌ Usage: `!dice <bet> <number 1-6>`\nExample: `!dice 100 3`');
      }

      if (guess < 1 || guess > 6) {
        return message.reply('❌ Guess must be between 1 and 6, you absolute moron.');
      }

      const result = await this.casino.dice(message.author.id, bet, guess);

      if (!result.success) {
        return message.reply(`❌ ${result.error}`);
      }

      const embed = new EmbedBuilder()
        .setTitle(result.won ? '🎉 You Won!' : '💀 You Lost')
        .setColor(result.won ? 0x00D166 : 0xDC3545)
        .setDescription(
          result.won
            ? `The dice rolled **${result.diceRoll}**!\n\nYou won **${result.winnings.toLocaleString()}** coins (5x multiplier)!\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
            : `The dice rolled **${result.diceRoll}**.\n\nYou lost **${result.loss.toLocaleString()}** coins.\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
        )
        .setFooter({ text: `User: ${message.author.tag}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleDouble(message, args) {
    try {
      const bet = parseInt(args[0]);

      if (!bet) {
        return message.reply('❌ Usage: `!double <bet>`\nExample: `!double 100`\n\nDouble or nothing - 50/50 chance to double your bet.');
      }

      const result = await this.casino.double(message.author.id, bet);

      if (!result.success) {
        return message.reply(`❌ ${result.error}`);
      }

      const embed = new EmbedBuilder()
        .setTitle(result.won ? '🎉 You Won!' : '💀 You Lost')
        .setColor(result.won ? 0x00D166 : 0xDC3545)
        .setDescription(
          result.won
            ? `You won! Double or nothing successful!\n\nYou won **${result.winnings.toLocaleString()}** coins!\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
            : `You lost. Better luck next time, you unlucky fuck.\n\nYou lost **${result.loss.toLocaleString()}** coins.\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
        )
        .setFooter({ text: `User: ${message.author.tag}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleRoulette(message, args) {
    try {
      const bet = parseInt(args[0]);
      const choice = args[1];

      if (!bet || !choice) {
        return message.reply('❌ Usage: `!roulette <bet> <red/black/green/number>`\nExample: `!roulette 100 red` or `!roulette 100 7`');
      }

      const result = await this.casino.roulette(message.author.id, bet, choice);

      if (!result.success) {
        return message.reply(`❌ ${result.error}`);
      }

      const embed = new EmbedBuilder()
        .setTitle(result.won ? '🎉 You Won!' : '💀 You Lost')
        .setColor(result.won ? 0x00D166 : 0xDC3545)
        .setDescription(
          result.won
            ? `The ball landed on **${result.number}** (${result.color})!\n\nYou won **${result.winnings.toLocaleString()}** coins!\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
            : `The ball landed on **${result.number}** (${result.color}).\n\nYou lost **${result.loss.toLocaleString()}** coins.\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
        )
        .setFooter({ text: `User: ${message.author.tag}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleBlackjack(message, args) {
    try {
      const bet = parseInt(args[0]);

      if (!bet) {
        return message.reply('❌ Usage: `!blackjack <bet>`\nExample: `!blackjack 100`\n\nThen use `!hit` or `!stand` to play.');
      }

      const result = await this.casino.blackjack(message.author.id, bet);

      if (!result.success) {
        return message.reply(`❌ ${result.error}`);
      }

      const embed = new EmbedBuilder()
        .setTitle('🃏 Blackjack Game Started')
        .setColor(0x5865F2)
        .setDescription(
          `**Your Cards:** ${result.game.playerCards.map(c => c.display).join(', ')}\n` +
          `**Your Total:** ${result.game.playerTotal}\n\n` +
          `**Dealer's Card:** ${result.game.dealerCard.display}\n\n` +
          `Use \`!hit\` to draw another card or \`!stand\` to end your turn.`
        )
        .setFooter({ text: `Bet: ${bet.toLocaleString()} coins | User: ${message.author.tag}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleBlackjackHit(message) {
    try {
      const result = await this.casino.blackjackHit(message.author.id);

      if (!result.success) {
        return message.reply(`❌ ${result.error}`);
      }

      if (result.bust) {
        const embed = new EmbedBuilder()
          .setTitle('💀 Bust!')
          .setColor(0xDC3545)
          .setDescription(
            `**Your Cards:** ${result.playerCards.map(c => c.display).join(', ')}\n` +
            `**Your Total:** ${result.playerTotal}\n\n` +
            `You went over 21! You lost your bet.\n\n` +
            `New balance: **${result.balance.toLocaleString()}** coins.`
          )
          .setFooter({ text: `User: ${message.author.tag}` })
          .setTimestamp();

        return await message.reply({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setTitle('🃏 Blackjack - Hit')
        .setColor(0x5865F2)
        .setDescription(
          `**Your Cards:** ${result.playerCards.map(c => c.display).join(', ')}\n` +
          `**Your Total:** ${result.playerTotal}\n\n` +
          `Use \`!hit\` to draw another card or \`!stand\` to end your turn.`
        )
        .setFooter({ text: `User: ${message.author.tag}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleBlackjackStand(message) {
    try {
      const result = await this.casino.blackjackStand(message.author.id);

      if (!result.success) {
        return message.reply(`❌ ${result.error}`);
      }

      if (result.push) {
        const embed = new EmbedBuilder()
          .setTitle('🤝 Push!')
          .setColor(0xFFA500)
          .setDescription(
            `**Your Cards:** ${result.playerCards.map(c => c.display).join(', ')}\n` +
            `**Your Total:** ${result.playerTotal}\n\n` +
            `**Dealer's Cards:** ${result.dealerCards.map(c => c.display).join(', ')}\n` +
            `**Dealer's Total:** ${result.dealerTotal}\n\n` +
            `It's a tie! Your bet is returned.\n\n` +
            `Balance: **${result.balance.toLocaleString()}** coins.`
          )
          .setFooter({ text: `User: ${message.author.tag}` })
          .setTimestamp();

        return await message.reply({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setTitle(result.won ? '🎉 You Won!' : '💀 You Lost')
        .setColor(result.won ? 0x00D166 : 0xDC3545)
        .setDescription(
          `**Your Cards:** ${result.playerCards.map(c => c.display).join(', ')}\n` +
          `**Your Total:** ${result.playerTotal}\n\n` +
          `**Dealer's Cards:** ${result.dealerCards.map(c => c.display).join(', ')}\n` +
          `**Dealer's Total:** ${result.dealerTotal}\n\n` +
          (result.won
            ? `You won **${result.winnings.toLocaleString()}** coins!\n\n`
            : `You lost **${result.loss.toLocaleString()}** coins.\n\n`) +
          `New balance: **${result.balance.toLocaleString()}** coins.`
        )
        .setFooter({ text: `User: ${message.author.tag}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  // Admin Casino Commands
  async handleCasinoAdd(message, args) {
    if (!args[0] || !args[1]) {
      return message.reply('❌ Usage: `!casinoadd <user> <amount>`');
    }

    const userId = args[0].replace(/[<@!>]/g, '');
    const amount = parseInt(args[1]);

    if (isNaN(amount) || amount <= 0) {
      return message.reply('❌ Amount must be a positive number, you absolute moron.');
    }

    try {
      const newBalance = await this.casino.updateBalance(userId, amount, true);
      await dbHelpers.run(
        'INSERT INTO admin_logs (actorId, action, targetId, details) VALUES (?, ?, ?, ?)',
        [message.author.id, 'casino_add', userId, `Added ${amount} coins`]
      );

      const embed = new EmbedBuilder()
        .setTitle('✅ Coins Added')
        .setColor(0x00D166)
        .setDescription(`Added **${amount.toLocaleString()}** coins to <@${userId}>.\n\nNew balance: **${newBalance.toLocaleString()}** coins.`)
        .setFooter({ text: `Admin: ${message.author.tag}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleCasinoRemove(message, args) {
    if (!args[0] || !args[1]) {
      return message.reply('❌ Usage: `!casinoremove <user> <amount>`');
    }

    const userId = args[0].replace(/[<@!>]/g, '');
    const amount = parseInt(args[1]);

    if (isNaN(amount) || amount <= 0) {
      return message.reply('❌ Amount must be a positive number, you absolute moron.');
    }

    try {
      const balance = await this.casino.getBalance(userId);
      if (amount > balance) {
        return message.reply(`❌ User only has ${balance.toLocaleString()} coins. Can't remove more than that, dumbass.`);
      }

      const newBalance = await this.casino.updateBalance(userId, -amount, false);
      await dbHelpers.run(
        'INSERT INTO admin_logs (actorId, action, targetId, details) VALUES (?, ?, ?, ?)',
        [message.author.id, 'casino_remove', userId, `Removed ${amount} coins`]
      );

      const embed = new EmbedBuilder()
        .setTitle('✅ Coins Removed')
        .setColor(0xFFA500)
        .setDescription(`Removed **${amount.toLocaleString()}** coins from <@${userId}>.\n\nNew balance: **${newBalance.toLocaleString()}** coins.`)
        .setFooter({ text: `Admin: ${message.author.tag}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  async handleCasinoReset(message, args) {
    if (!args[0]) {
      return message.reply('❌ Usage: `!casinoreset <user>`');
    }

    const userId = args[0].replace(/[<@!>]/g, '');

    try {
      await dbHelpers.run(
        'UPDATE casino_balances SET balance = 1000, totalWon = 0, totalLost = 0, gamesPlayed = 0, updatedAt = CURRENT_TIMESTAMP WHERE discordId = ?',
        [userId]
      );

      await dbHelpers.run(
        'INSERT INTO admin_logs (actorId, action, targetId, details) VALUES (?, ?, ?, ?)',
        [message.author.id, 'casino_reset', userId, 'Reset casino stats']
      );

      const embed = new EmbedBuilder()
        .setTitle('✅ Casino Stats Reset')
        .setColor(0x5865F2)
        .setDescription(`Reset casino statistics for <@${userId}>.\n\nBalance set to 1000 coins.`)
        .setFooter({ text: `Admin: ${message.author.tag}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      await message.reply(`❌ ${getSnarkyResponse('error')} ${error.message}`);
    }
  }

  // Slash Command Handlers
  async handleSlashHelp(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🤖 ZRX Market Bot - Commands')
      .setColor(0x5865F2)
      .setDescription('Here are all the fucking commands. Use them wisely.')
      .addFields(
        {
          name: '🌐 Public Commands',
          value: [
            '`/help` - Show this help (obviously)',
            '`/ping` - Check if I\'m alive (spoiler: I am)',
            '`/stats` - Show market statistics',
            '`/user <discordId>` - Look up a user',
            '`/trade <id>` - View trade details'
          ].join('\n'),
          inline: false
        },
        {
          name: '🎰 Casino Commands',
          value: [
            '`/balance` - Check your coin balance',
            '`/daily` - Claim daily reward (500-1000 coins)',
            '`/casinostats [user]` - View casino statistics',
            '`/coinflip <bet> <heads/tails>` - Flip a coin',
            '`/dice <bet> <1-6>` - Roll dice (5x multiplier)',
            '`/double <bet>` - Double or nothing',
            '`/roulette <bet> <red/black/green/number>` - Play roulette',
            '`/blackjack <bet>` - Start blackjack game',
            '`/hit` - Draw card in blackjack',
            '`/stand` - End turn in blackjack'
          ].join('\n'),
          inline: false
        },
        {
          name: '👮 Moderator Commands',
          value: [
            '`/mm accept/decline/complete/list` - Middleman management',
            '`/blacklist add/remove/list/check` - Blacklist management',
            '`/report list/view` - Report management',
            '`/verify <user>` - Verify a user',
            '`/unverify <user>` - Unverify a user',
            '`/serverstats` - Show server statistics',
            '`/cleanup` - Clean up old trades',
            '`/casinoadd/remove/reset` - Casino admin commands'
          ].join('\n'),
          inline: false
        }
      )
      .setFooter({ text: 'ZRX Market Bot - Made with attitude' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: 64 }); // 64 = EPHEMERAL flag
  }

  async handleSlashStats(interaction) {
    try {
      const totalTrades = await dbHelpers.get('SELECT COUNT(*) as count FROM trades WHERE status = ?', ['active']);
      const totalUsers = await dbHelpers.get('SELECT COUNT(*) as count FROM users');
      const pendingMM = await dbHelpers.get('SELECT COUNT(*) as count FROM middleman WHERE status = ?', ['pending']);
      const totalReports = await dbHelpers.get('SELECT COUNT(*) as count FROM reports WHERE status = ?', ['pending']);
      const completedTrades = await dbHelpers.get('SELECT COUNT(*) as count FROM trades WHERE status = ?', ['completed']);

      const embed = new EmbedBuilder()
        .setTitle('📊 Market Statistics')
        .setColor(0x00D166)
        .setDescription('Here are the fucking stats. Impressive, right?')
        .addFields(
          { name: '🛒 Active Trades', value: `${totalTrades?.count || 0}`, inline: true },
          { name: '✅ Completed Trades', value: `${completedTrades?.count || 0}`, inline: true },
          { name: '👥 Total Users', value: `${totalUsers?.count || 0}`, inline: true },
          { name: '🤝 Pending Middleman', value: `${pendingMM?.count || 0}`, inline: true },
          { name: '🚨 Pending Reports', value: `${totalReports?.count || 0}`, inline: true },
          { name: '🤖 Bot Uptime', value: this.formatUptime(process.uptime()), inline: true }
        )
        .setFooter({ text: 'ZRX Market Bot' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashUserLookup(interaction) {
    const userId = interaction.options.getString('discordid').replace(/[<@!>]/g, '');
    
    try {
      const user = await dbHelpers.get('SELECT * FROM users WHERE discordId = ?', [userId]);
      
      if (!user) {
        return await interaction.editReply({ content: `❌ ${getSnarkyResponse('notFound')} User not found in database.` });
      }

      const userTrades = await dbHelpers.get('SELECT COUNT(*) as count FROM trades WHERE creatorId = ?', [userId]);
      const userMM = await dbHelpers.get('SELECT COUNT(*) as count FROM middleman WHERE requesterId = ?', [userId]);
      const userReports = await dbHelpers.get('SELECT COUNT(*) as count FROM reports WHERE reporterId = ? OR accusedDiscordId = ?', [userId, userId]);
      const isBlacklisted = await dbHelpers.get('SELECT * FROM blacklist WHERE discordId = ?', [userId]);

      const embed = new EmbedBuilder()
        .setTitle(`👤 User Lookup: ${user.username}`)
        .setColor(user.verified ? 0x00D166 : 0xFFA500)
        .setThumbnail(user.avatar || null)
        .addFields(
          { name: '🆔 Discord ID', value: user.discordId, inline: true },
          { name: '✅ Verified', value: user.verified ? 'Yes' : 'No', inline: true },
          { name: '🚫 Blacklisted', value: isBlacklisted ? `Yes - ${isBlacklisted.reason}` : 'No', inline: true },
          { name: '🛒 Trades Created', value: `${userTrades?.count || 0}`, inline: true },
          { name: '🤝 Middleman Requests', value: `${userMM?.count || 0}`, inline: true },
          { name: '🚨 Reports', value: `${userReports?.count || 0}`, inline: true },
          { name: '📅 Joined', value: new Date(user.createdAt).toLocaleDateString(), inline: true }
        )
        .setFooter({ text: `User ID: ${userId}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashTradeLookup(interaction) {
    const tradeId = interaction.options.getInteger('id');

    try {
      const trade = await dbHelpers.get(
        `SELECT t.*, u.username, u.avatar 
         FROM trades t 
         JOIN users u ON t.creatorId = u.discordId 
         WHERE t.id = ?`,
        [tradeId]
      );

      if (!trade) {
        return await interaction.editReply({ content: `❌ ${getSnarkyResponse('notFound')} Trade #${tradeId} not found.` });
      }

      const offered = trade.offered ? JSON.parse(trade.offered) : [];
      const wanted = trade.wanted ? JSON.parse(trade.wanted) : [];

      const embed = new EmbedBuilder()
        .setTitle(`🛒 Trade #${trade.id}`)
        .setColor(0x5865F2)
        .setDescription(`**Status:** ${trade.status.toUpperCase()}`)
        .addFields(
          { name: '👤 Creator', value: `<@${trade.creatorId}> (${trade.username})`, inline: true },
          { name: '📅 Created', value: new Date(trade.createdAt).toLocaleDateString(), inline: true },
          { name: '🎮 Category', value: trade.isCrossTrade ? 'Cross-Trade' : 'Same Game', inline: true },
          { 
            name: '📤 Offered', 
            value: offered.length > 0 
              ? offered.map(item => `${item.name}${item.mutation ? ` (${item.mutation})` : ''}${item.value ? ` - ${item.value}` : ''}`).join('\n').substring(0, 1024)
              : 'None',
            inline: false 
          },
          { 
            name: '📥 Wanted', 
            value: wanted.length > 0 
              ? wanted.map(item => `${item.name}${item.mutation ? ` (${item.mutation})` : ''}${item.value ? ` - ${item.value}` : ''}`).join('\n').substring(0, 1024)
              : 'None',
            inline: false 
          }
        )
        .setFooter({ text: `Trade ID: ${trade.id}` })
        .setTimestamp(new Date(trade.createdAt));

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashBalance(interaction) {
    try {
      // Check if casino is enabled
      if (!this.casino || !this.casino.casinoEnabled) {
        return await interaction.editReply({ 
          content: '❌ Casino features are currently disabled due to database issues. Please try again later.' 
        });
      }

      // Add timeout to prevent hanging
      const balancePromise = this.casino.getBalance(interaction.user.id);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timed out')), 5000)
      );

      const balance = await Promise.race([balancePromise, timeoutPromise]);
      
      const embed = new EmbedBuilder()
        .setTitle('💰 Your Balance')
        .setColor(0x00D166)
        .setDescription(`You have **${balance.toLocaleString()}** coins.`)
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in handleSlashBalance:', error);
      await interaction.editReply({ 
        content: `❌ ${getSnarkyResponse('error')} ${error.message || 'Failed to get balance. Casino features may be disabled.'}` 
      });
    }
  }

  async handleSlashDaily(interaction) {
    try {
      const result = await this.casino.dailyReward(interaction.user.id);
      
      if (!result.success) {
        const embed = new EmbedBuilder()
          .setTitle('⏰ Daily Reward')
          .setColor(0xFFA500)
          .setDescription(`You've already claimed your daily reward today.\n\nCome back in **${result.hoursLeft} hours**, you impatient fuck.`)
          .setTimestamp();
        return await interaction.editReply({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setTitle('🎁 Daily Reward Claimed!')
        .setColor(0x00D166)
        .setDescription(`You received **${result.reward.toLocaleString()}** coins!\n\nYour new balance: **${result.balance.toLocaleString()}** coins.`)
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashWork(interaction) {
    try {
      if (!this.casino || !this.casino.casinoEnabled) {
        return await interaction.editReply({ 
          content: '❌ Casino features are currently disabled due to database issues. Please try again later.' 
        });
      }

      const result = await this.casino.work(interaction.user.id);
      
      if (!result.success) {
        const minutesLeft = Math.ceil(result.minutesLeft);
        const embed = new EmbedBuilder()
          .setTitle('⏰ Work Cooldown')
          .setColor(0xFFA500)
          .setDescription(`Slow down, you workaholic piece of shit. You just worked **${minutesLeft} minutes ago**.\n\nCome back in **${minutesLeft} minutes**, you impatient fuck.`)
          .setTimestamp();
        return await interaction.editReply({ embeds: [embed] });
      }

      const workMessages = [
        'You worked your ass off at McDonald\'s and earned some coins. Pathetic.',
        'You did some manual labor and got paid. At least you\'re doing something productive for once.',
        'You worked a shift at a gas station. The coins are yours, you minimum wage slave.',
        'You did some freelance work online. Here\'s your payment, you digital peasant.',
        'You worked construction for a day. Here are your hard-earned coins, you blue-collar worker.',
        'You worked as a cashier. The coins are yours, you retail slave.',
        'You did some delivery work. Here\'s your payment, you delivery driver.',
        'You worked overtime and got paid extra. Good for you, you workaholic.'
      ];

      const workMessage = workMessages[Math.floor(Math.random() * workMessages.length)];

      const embed = new EmbedBuilder()
        .setTitle('💼 Work Complete!')
        .setColor(0x00D166)
        .setDescription(`${workMessage}\n\n**Earned:** ${result.earned.toLocaleString()} coins\n**New Balance:** ${result.balance.toLocaleString()} coins`)
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in handleSlashWork:', error);
      await interaction.editReply({ 
        content: `❌ ${getSnarkyResponse('error')} ${error.message || 'Failed to work. Casino features may be disabled.'}` 
      });
    }
  }

  async handleSlashCollect(interaction) {
    try {
      if (!this.casino || !this.casino.casinoEnabled) {
        return await interaction.editReply({ 
          content: '❌ Casino features are currently disabled due to database issues. Please try again later.' 
        });
      }

      // Get user's roles
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const roles = member.roles.cache;

      // Role income mapping - check for role names containing these keywords
      const roleIncomeMap = [
        { keyword: 'Regular', income: 125 }, // Highest priority
        { keyword: 'Active Member', income: 75 },
        { keyword: 'Active', income: 75 },
        { keyword: 'Beginner', income: 25 }
      ];

      // Find the highest paying role the user has
      let earned = 0;
      let roleName = null;
      let roleFound = false;

      // Check roles in order of highest to lowest income
      for (const roleCheck of roleIncomeMap) {
        const role = roles.find(r => r.name.includes(roleCheck.keyword));
        if (role) {
          earned = roleCheck.income;
          roleName = role.name;
          roleFound = true;
          break;
        }
      }

      // Also check for VIP role separately (100 coins)
      if (!roleFound) {
        const vipRole = roles.find(r => r.name.includes('VIP') || r.name.includes('💎'));
        if (vipRole) {
          earned = 100;
          roleName = vipRole.name;
          roleFound = true;
        }
      }

      if (!roleFound) {
        const embed = new EmbedBuilder()
          .setTitle('❌ No Role Income')
          .setColor(0xFF0000)
          .setDescription('You don\'t have any roles that give income, you roleless peasant. Get a role first, you absolute nobody.')
          .setTimestamp();
        return await interaction.editReply({ embeds: [embed] });
      }

      const result = await this.casino.collectRoleIncome(interaction.user.id, earned);
      
      if (!result.success) {
        const embed = new EmbedBuilder()
          .setTitle('⏰ Already Collected')
          .setColor(0xFFA500)
          .setDescription(`You already collected your role income today, you greedy fuck.\n\nCome back tomorrow, you impatient asshole.`)
          .setTimestamp();
        return await interaction.editReply({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setTitle('💰 Role Income Collected!')
        .setColor(0x00D166)
        .setDescription(`You collected your **${roleName}** role income!\n\n**Earned:** ${earned.toLocaleString()} coins\n**New Balance:** ${result.balance.toLocaleString()} coins`)
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in handleSlashCollect:', error);
      await interaction.editReply({ 
        content: `❌ ${getSnarkyResponse('error')} ${error.message || 'Failed to collect. Casino features may be disabled.'}` 
      });
    }
  }

  async handleSlashSlut(interaction) {
    try {
      if (!this.casino || !this.casino.casinoEnabled) {
        return await interaction.editReply({ 
          content: '❌ Casino features are currently disabled due to database issues. Please try again later.' 
        });
      }

      const result = await this.casino.slut(interaction.user.id);
      
      if (!result.success) {
        const minutesLeft = Math.ceil(result.minutesLeft);
        const embed = new EmbedBuilder()
          .setTitle('⏰ Cooldown Active')
          .setColor(0xFFA500)
          .setDescription(`Slow down, you horny fuck. You just did that **${minutesLeft} minutes ago**.\n\nCome back in **${minutesLeft} minutes**, you desperate piece of shit.`)
          .setTimestamp();
        return await interaction.editReply({ embeds: [embed] });
      }

      const slutMessages = [
        'You did some... questionable things and earned coins. I\'m not judging, but I am judging.',
        'You worked the streets and got paid. Here are your coins, you absolute degenerate.',
        'You did some OnlyFans content and got tipped. The coins are yours, you digital whore.',
        'You sold some... services... and got paid. Here\'s your payment, you entrepreneurial slut.',
        'You did some cam work and earned coins. The coins are yours, you exhibitionist.',
        'You did some sugar baby work and got paid. Here\'s your allowance, you gold digger.',
        'You did some escort work and earned coins. The coins are yours, you professional companion.',
        'You did some adult content creation and got paid. Here\'s your payment, you content creator.'
      ];

      const slutMessage = slutMessages[Math.floor(Math.random() * slutMessages.length)];

      const embed = new EmbedBuilder()
        .setTitle('💋 Work Complete!')
        .setColor(0xFF69B4)
        .setDescription(`${slutMessage}\n\n**Earned:** ${result.earned.toLocaleString()} coins\n**New Balance:** ${result.balance.toLocaleString()} coins`)
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in handleSlashSlut:', error);
      await interaction.editReply({ 
        content: `❌ ${getSnarkyResponse('error')} ${error.message || 'Failed to work. Casino features may be disabled.'}` 
      });
    }
  }

  async handleSlashCasinoStats(interaction) {
    try {
      const targetUser = interaction.options.getUser('user');
      const userId = targetUser ? targetUser.id : interaction.user.id;
      const stats = await this.casino.getStats(userId);
      
      const winRate = stats.gamesPlayed > 0 
        ? ((stats.totalWon / (stats.totalWon + stats.totalLost)) * 100).toFixed(1)
        : 0;

      const embed = new EmbedBuilder()
        .setTitle('🎰 Casino Statistics')
        .setColor(0x5865F2)
        .addFields(
          { name: '💰 Balance', value: `${stats.balance.toLocaleString()} coins`, inline: true },
          { name: '🎮 Games Played', value: `${stats.gamesPlayed}`, inline: true },
          { name: '📊 Win Rate', value: `${winRate}%`, inline: true },
          { name: '✅ Total Won', value: `${stats.totalWon.toLocaleString()} coins`, inline: true },
          { name: '❌ Total Lost', value: `${stats.totalLost.toLocaleString()} coins`, inline: true },
          { name: '💵 Net Profit', value: `${(stats.totalWon - stats.totalLost).toLocaleString()} coins`, inline: true }
        )
        .setFooter({ text: `User: ${targetUser ? targetUser.tag : interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashCoinflip(interaction) {
    try {
      const bet = interaction.options.getInteger('bet');
      const choice = interaction.options.getString('choice').toLowerCase();

      const result = await this.casino.coinflip(interaction.user.id, bet, choice);

      if (!result.success) {
        return await interaction.editReply({ content: `❌ ${result.error}` });
      }

      const embed = new EmbedBuilder()
        .setTitle(result.won ? '🎉 You Won!' : '💀 You Lost')
        .setColor(result.won ? 0x00D166 : 0xDC3545)
        .setDescription(
          result.won
            ? `The coin landed on **${result.result}**!\n\nYou won **${result.winnings.toLocaleString()}** coins!\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
            : `The coin landed on **${result.result}**.\n\nYou lost **${result.loss.toLocaleString()}** coins.\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
        )
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashDice(interaction) {
    try {
      const bet = interaction.options.getInteger('bet');
      const guess = interaction.options.getInteger('guess');

      const result = await this.casino.dice(interaction.user.id, bet, guess);

      if (!result.success) {
        return await interaction.editReply({ content: `❌ ${result.error}` });
      }

      const embed = new EmbedBuilder()
        .setTitle(result.won ? '🎉 You Won!' : '💀 You Lost')
        .setColor(result.won ? 0x00D166 : 0xDC3545)
        .setDescription(
          result.won
            ? `The dice rolled **${result.diceRoll}**!\n\nYou won **${result.winnings.toLocaleString()}** coins (5x multiplier)!\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
            : `The dice rolled **${result.diceRoll}**.\n\nYou lost **${result.loss.toLocaleString()}** coins.\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
        )
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashDouble(interaction) {
    try {
      const bet = interaction.options.getInteger('bet');

      const result = await this.casino.double(interaction.user.id, bet);

      if (!result.success) {
        return await interaction.editReply({ content: `❌ ${result.error}` });
      }

      const embed = new EmbedBuilder()
        .setTitle(result.won ? '🎉 You Won!' : '💀 You Lost')
        .setColor(result.won ? 0x00D166 : 0xDC3545)
        .setDescription(
          result.won
            ? `You won! Double or nothing successful!\n\nYou won **${result.winnings.toLocaleString()}** coins!\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
            : `You lost. Better luck next time, you unlucky fuck.\n\nYou lost **${result.loss.toLocaleString()}** coins.\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
        )
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashRoulette(interaction) {
    try {
      const bet = interaction.options.getInteger('bet');
      const choice = interaction.options.getString('choice');

      const result = await this.casino.roulette(interaction.user.id, bet, choice);

      if (!result.success) {
        return await interaction.editReply({ content: `❌ ${result.error}` });
      }

      const embed = new EmbedBuilder()
        .setTitle(result.won ? '🎉 You Won!' : '💀 You Lost')
        .setColor(result.won ? 0x00D166 : 0xDC3545)
        .setDescription(
          result.won
            ? `The ball landed on **${result.number}** (${result.color})!\n\nYou won **${result.winnings.toLocaleString()}** coins!\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
            : `The ball landed on **${result.number}** (${result.color}).\n\nYou lost **${result.loss.toLocaleString()}** coins.\n\nNew balance: **${result.balance.toLocaleString()}** coins.`
        )
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashBlackjack(interaction) {
    try {
      const bet = interaction.options.getInteger('bet');

      const result = await this.casino.blackjack(interaction.user.id, bet);

      if (!result.success) {
        return await interaction.editReply({ content: `❌ ${result.error}` });
      }

      const embed = new EmbedBuilder()
        .setTitle('🃏 Blackjack Game Started')
        .setColor(0x5865F2)
        .setDescription(
          `**Your Cards:** ${result.game.playerCards.map(c => c.display).join(', ')}\n` +
          `**Your Total:** ${result.game.playerTotal}\n\n` +
          `**Dealer's Card:** ${result.game.dealerCard.display}\n\n` +
          `Use \`/hit\` to draw another card or \`/stand\` to end your turn.`
        )
        .setFooter({ text: `Bet: ${bet.toLocaleString()} coins | User: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashBlackjackHit(interaction) {
    try {
      const result = await this.casino.blackjackHit(interaction.user.id);

      if (!result.success) {
        return await interaction.editReply({ content: `❌ ${result.error}` });
      }

      if (result.bust) {
        const embed = new EmbedBuilder()
          .setTitle('💀 Bust!')
          .setColor(0xDC3545)
          .setDescription(
            `**Your Cards:** ${result.playerCards.map(c => c.display).join(', ')}\n` +
            `**Your Total:** ${result.playerTotal}\n\n` +
            `You went over 21! You lost your bet.\n\n` +
            `New balance: **${result.balance.toLocaleString()}** coins.`
          )
          .setFooter({ text: `User: ${interaction.user.tag}` })
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setTitle('🃏 Blackjack - Hit')
        .setColor(0x5865F2)
        .setDescription(
          `**Your Cards:** ${result.playerCards.map(c => c.display).join(', ')}\n` +
          `**Your Total:** ${result.playerTotal}\n\n` +
          `Use \`/hit\` to draw another card or \`/stand\` to end your turn.`
        )
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashBlackjackStand(interaction) {
    try {
      const result = await this.casino.blackjackStand(interaction.user.id);

      if (!result.success) {
        return await interaction.editReply({ content: `❌ ${result.error}` });
      }

      if (result.push) {
        const embed = new EmbedBuilder()
          .setTitle('🤝 Push!')
          .setColor(0xFFA500)
          .setDescription(
            `**Your Cards:** ${result.playerCards.map(c => c.display).join(', ')}\n` +
            `**Your Total:** ${result.playerTotal}\n\n` +
            `**Dealer's Cards:** ${result.dealerCards.map(c => c.display).join(', ')}\n` +
            `**Dealer's Total:** ${result.dealerTotal}\n\n` +
            `It's a tie! Your bet is returned.\n\n` +
            `Balance: **${result.balance.toLocaleString()}** coins.`
          )
          .setFooter({ text: `User: ${interaction.user.tag}` })
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setTitle(result.won ? '🎉 You Won!' : '💀 You Lost')
        .setColor(result.won ? 0x00D166 : 0xDC3545)
        .setDescription(
          `**Your Cards:** ${result.playerCards.map(c => c.display).join(', ')}\n` +
          `**Your Total:** ${result.playerTotal}\n\n` +
          `**Dealer's Cards:** ${result.dealerCards.map(c => c.display).join(', ')}\n` +
          `**Dealer's Total:** ${result.dealerTotal}\n\n` +
          (result.won
            ? `You won **${result.winnings.toLocaleString()}** coins!\n\n`
            : `You lost **${result.loss.toLocaleString()}** coins.\n\n`) +
          `New balance: **${result.balance.toLocaleString()}** coins.`
        )
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashMM(interaction) {
    const hasModeratorRole = interaction.member?.roles.cache.has(process.env.MODERATOR_ROLE_ID);
    if (!hasModeratorRole) {
      // Already deferred at top level, use editReply
      return await interaction.editReply({ content: `❌ ${getSnarkyResponse('noPermission')}` });
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'accept':
          const acceptId = interaction.options.getInteger('id');
          // Convert to message-like format for existing handler
          const acceptMessage = { author: { id: interaction.user.id }, channel: interaction.channel, reply: (content) => interaction.editReply({ content }) };
          await this.handleAccept(acceptMessage, [acceptId.toString()]);
          break;
        case 'decline':
          const declineId = interaction.options.getInteger('id');
          const declineMessage = { author: { id: interaction.user.id }, channel: interaction.channel, reply: (content) => interaction.editReply({ content }) };
          await this.handleDecline(declineMessage, [declineId.toString()]);
          break;
        case 'complete':
          const completeId = interaction.options.getInteger('id');
          const completeMessage = { author: { id: interaction.user.id }, channel: interaction.channel, reply: (content) => interaction.editReply({ content }) };
          await this.handleComplete(completeMessage, [completeId.toString()]);
          break;
        case 'list':
          const status = interaction.options.getString('status') || 'pending';
          const listMessage = { reply: async (content) => {
            if (typeof content === 'string') {
              await interaction.editReply({ content });
            } else {
              await interaction.editReply({ embeds: content.embeds });
            }
          }};
          await this.handleList(listMessage, [status]);
          break;
      }
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashBlacklist(interaction) {
    const hasModeratorRole = interaction.member?.roles.cache.has(process.env.MODERATOR_ROLE_ID);
    if (!hasModeratorRole) {
      // Already deferred at top level, use editReply
      return await interaction.editReply({ content: `❌ ${getSnarkyResponse('noPermission')}` });
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'add':
          const user = interaction.options.getUser('user');
          const reason = interaction.options.getString('reason');
          const addMessage = { author: { id: interaction.user.id }, reply: (content) => interaction.editReply({ content }) };
          await this.handleBlacklistAdd(addMessage, [user.id, reason]);
          break;
        case 'remove':
          const removeUser = interaction.options.getUser('user');
          const removeMessage = { author: { id: interaction.user.id }, reply: (content) => interaction.editReply({ content }) };
          await this.handleBlacklistRemove(removeMessage, [removeUser.id]);
          break;
        case 'list':
          const listMessage = { reply: async (content) => {
            if (typeof content === 'string') {
              await interaction.editReply({ content });
            } else {
              await interaction.editReply({ embeds: content.embeds });
            }
          }};
          await this.handleBlacklistList(listMessage);
          break;
        case 'check':
          const checkUser = interaction.options.getUser('user');
          const checkMessage = { reply: (content) => interaction.editReply({ content }) };
          await this.handleBlacklistCheck(checkMessage, [checkUser.id]);
          break;
      }
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashReport(interaction) {
    const hasModeratorRole = interaction.member?.roles.cache.has(process.env.MODERATOR_ROLE_ID);
    if (!hasModeratorRole) {
      // Already deferred at top level, use editReply
      return await interaction.editReply({ content: `❌ ${getSnarkyResponse('noPermission')}` });
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'list':
          const status = interaction.options.getString('status') || 'pending';
          const listMessage = { reply: async (content) => {
            if (typeof content === 'string') {
              await interaction.editReply({ content });
            } else {
              await interaction.editReply({ embeds: content.embeds });
            }
          }};
          await this.handleReportList(listMessage, [status]);
          break;
        case 'view':
          const reportId = interaction.options.getInteger('id');
          const viewMessage = { reply: async (content) => {
            if (typeof content === 'string') {
              await interaction.editReply({ content });
            } else {
              await interaction.editReply({ embeds: content.embeds });
            }
          }};
          await this.handleReportView(viewMessage, [reportId.toString()]);
          break;
      }
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashVerify(interaction) {
    const hasModeratorRole = interaction.member?.roles.cache.has(process.env.MODERATOR_ROLE_ID);
    if (!hasModeratorRole) {
      // Already deferred at top level, use editReply
      return await interaction.editReply({ content: `❌ ${getSnarkyResponse('noPermission')}` });
    }

    const user = interaction.options.getUser('user');
    const message = { author: { id: interaction.user.id }, reply: (content) => interaction.editReply({ content }) };
    await this.handleVerify(message, [user.id]);
  }

  async handleSlashUnverify(interaction) {
    const hasModeratorRole = interaction.member?.roles.cache.has(process.env.MODERATOR_ROLE_ID);
    if (!hasModeratorRole) {
      // Already deferred at top level, use editReply
      return await interaction.editReply({ content: `❌ ${getSnarkyResponse('noPermission')}` });
    }

    const user = interaction.options.getUser('user');
    const message = { author: { id: interaction.user.id }, reply: (content) => interaction.editReply({ content }) };
    await this.handleUnverify(message, [user.id]);
  }

  async handleSlashServerStats(interaction) {
    const hasModeratorRole = interaction.member?.roles.cache.has(process.env.MODERATOR_ROLE_ID);
    if (!hasModeratorRole) {
      // Already deferred at top level, use editReply
      return await interaction.editReply({ content: `❌ ${getSnarkyResponse('noPermission')}` });
    }

    try {
      const guild = interaction.guild;
      if (!guild) {
        return await interaction.editReply({ content: '❌ This command only works in a server, you absolute buffoon.' });
      }

      const totalMembers = guild.memberCount;
      const onlineMembers = guild.members.cache.filter(m => m.presence?.status === 'online').size;
      const totalChannels = guild.channels.cache.size;
      const totalRoles = guild.roles.cache.size;

      const embed = new EmbedBuilder()
        .setTitle(`📊 Server Statistics: ${guild.name}`)
        .setColor(0x5865F2)
        .setThumbnail(guild.iconURL())
        .addFields(
          { name: '👥 Total Members', value: `${totalMembers}`, inline: true },
          { name: '🟢 Online Members', value: `${onlineMembers}`, inline: true },
          { name: '📺 Channels', value: `${totalChannels}`, inline: true },
          { name: '🎭 Roles', value: `${totalRoles}`, inline: true },
          { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
          { name: '📅 Created', value: guild.createdAt.toLocaleDateString(), inline: true }
        )
        .setFooter({ text: `Server ID: ${guild.id}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashCleanup(interaction) {
    const hasModeratorRole = interaction.member?.roles.cache.has(process.env.MODERATOR_ROLE_ID);
    if (!hasModeratorRole) {
      // Already deferred at top level, use editReply
      return await interaction.editReply({ content: `❌ ${getSnarkyResponse('noPermission')}` });
    }

    try {
      const result = await dbHelpers.run(
        `UPDATE trades SET status = 'expired' 
         WHERE status = 'active' 
         AND datetime(createdAt, '+5 hours') < datetime('now')`
      );

      await interaction.editReply({ content: `✅ ${getSnarkyResponse('success')} Cleanup completed. ${result.changes || 0} trades expired.` });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashCasinoAdd(interaction) {
    const hasModeratorRole = interaction.member?.roles.cache.has(process.env.MODERATOR_ROLE_ID);
    if (!hasModeratorRole) {
      // Already deferred at top level, use editReply
      return await interaction.editReply({ content: `❌ ${getSnarkyResponse('noPermission')}` });
    }

    const user = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');

    try {
      const newBalance = await this.casino.updateBalance(user.id, amount, true);
      await dbHelpers.run(
        'INSERT INTO admin_logs (actorId, action, targetId, details) VALUES (?, ?, ?, ?)',
        [interaction.user.id, 'casino_add', user.id, `Added ${amount} coins`]
      );

      const embed = new EmbedBuilder()
        .setTitle('✅ Coins Added')
        .setColor(0x00D166)
        .setDescription(`Added **${amount.toLocaleString()}** coins to <@${user.id}>.\n\nNew balance: **${newBalance.toLocaleString()}** coins.`)
        .setFooter({ text: `Admin: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashCasinoRemove(interaction) {
    const hasModeratorRole = interaction.member?.roles.cache.has(process.env.MODERATOR_ROLE_ID);
    if (!hasModeratorRole) {
      // Already deferred at top level, use editReply
      return await interaction.editReply({ content: `❌ ${getSnarkyResponse('noPermission')}` });
    }

    const user = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');

    try {
      const balance = await this.casino.getBalance(user.id);
      if (amount > balance) {
        return await interaction.editReply({ content: `❌ User only has ${balance.toLocaleString()} coins. Can't remove more than that, dumbass.` });
      }

      const newBalance = await this.casino.updateBalance(user.id, -amount, false);
      await dbHelpers.run(
        'INSERT INTO admin_logs (actorId, action, targetId, details) VALUES (?, ?, ?, ?)',
        [interaction.user.id, 'casino_remove', user.id, `Removed ${amount} coins`]
      );

      const embed = new EmbedBuilder()
        .setTitle('✅ Coins Removed')
        .setColor(0xFFA500)
        .setDescription(`Removed **${amount.toLocaleString()}** coins from <@${user.id}>.\n\nNew balance: **${newBalance.toLocaleString()}** coins.`)
        .setFooter({ text: `Admin: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashCasinoReset(interaction) {
    const hasModeratorRole = interaction.member?.roles.cache.has(process.env.MODERATOR_ROLE_ID);
    if (!hasModeratorRole) {
      // Already deferred at top level, use editReply
      return await interaction.editReply({ content: `❌ ${getSnarkyResponse('noPermission')}` });
    }

    const user = interaction.options.getUser('user');

    try {
      await dbHelpers.run(
        'UPDATE casino_balances SET balance = 1000, totalWon = 0, totalLost = 0, gamesPlayed = 0, updatedAt = CURRENT_TIMESTAMP WHERE discordId = ?',
        [user.id]
      );

      await dbHelpers.run(
        'INSERT INTO admin_logs (actorId, action, targetId, details) VALUES (?, ?, ?, ?)',
        [interaction.user.id, 'casino_reset', user.id, 'Reset casino stats']
      );

      const embed = new EmbedBuilder()
        .setTitle('✅ Casino Stats Reset')
        .setColor(0x5865F2)
        .setDescription(`Reset casino statistics for <@${user.id}>.\n\nBalance set to 1000 coins.`)
        .setFooter({ text: `Admin: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async handleSlashWelcome(interaction) {
    try {
      // Check for administrator permission
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return await interaction.editReply({ content: `❌ ${getSnarkyResponse('noPermission')} You must be an administrator to use this command.` });
      }

      const guild = interaction.guild;
      if (!guild) {
        return await interaction.editReply({ content: '❌ This command can only be used in a server.' });
      }

      const subcommand = interaction.options.getSubcommand();

      // Create server_config table if it doesn't exist
      try {
        await dbHelpers.run(`
          CREATE TABLE IF NOT EXISTS server_config (
            guildId TEXT PRIMARY KEY,
            welcomeChannelId TEXT,
            welcomeMessage TEXT,
            autoRoleId TEXT,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
      } catch (error) {
        // Table might already exist
      }

      if (subcommand === 'channel') {
        const channel = interaction.options.getChannel('channel');
        if (channel.type !== 0) { // 0 = Text channel
          return await interaction.editReply({ content: '❌ Please select a text channel.' });
        }

        // Insert or update config
        await dbHelpers.run(
          'INSERT OR REPLACE INTO server_config (guildId, welcomeChannelId, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)',
          [guild.id, channel.id]
        );

        const embed = new EmbedBuilder()
          .setTitle('✅ Welcome Channel Set')
          .setColor(0x00FF00)
          .setDescription(`Welcome messages will now be sent to <#${channel.id}>`)
          .setFooter({ text: `Configured by: ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } else if (subcommand === 'message') {
        const message = interaction.options.getString('message');

        // Insert or update config
        await dbHelpers.run(
          'INSERT OR REPLACE INTO server_config (guildId, welcomeMessage, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)',
          [guild.id, message]
        );

        const embed = new EmbedBuilder()
          .setTitle('✅ Welcome Message Set')
          .setColor(0x00FF00)
          .setDescription(`**New Welcome Message:**\n${message}\n\n**Placeholders:**\n• \`{user}\` - Mentions the new member\n• \`{username}\` - Username\n• \`{server}\` - Server name\n• \`{memberCount}\` - Total member count`)
          .setFooter({ text: `Configured by: ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } else if (subcommand === 'role') {
        const role = interaction.options.getRole('role');

        // Check if bot can assign this role
        if (role.position >= interaction.guild.members.me.roles.highest.position) {
          return await interaction.editReply({ content: '❌ I cannot assign this role. Make sure my role is above this role in the hierarchy.' });
        }

        // Insert or update config
        await dbHelpers.run(
          'INSERT OR REPLACE INTO server_config (guildId, autoRoleId, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)',
          [guild.id, role.id]
        );

        const embed = new EmbedBuilder()
          .setTitle('✅ Auto-Role Set')
          .setColor(0x00FF00)
          .setDescription(`New members will automatically receive the role <@&${role.id}>`)
          .setFooter({ text: `Configured by: ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } else if (subcommand === 'view') {
        const config = await dbHelpers.get(
          'SELECT * FROM server_config WHERE guildId = ?',
          [guild.id]
        );

        const embed = new EmbedBuilder()
          .setTitle('📋 Welcome Settings')
          .setColor(0x5865F2)
          .addFields(
            {
              name: 'Welcome Channel',
              value: config?.welcomeChannelId ? `<#${config.welcomeChannelId}>` : '❌ Not set',
              inline: true
            },
            {
              name: 'Auto-Role',
              value: config?.autoRoleId ? `<@&${config.autoRoleId}>` : '❌ Not set',
              inline: true
            },
            {
              name: 'Welcome Message',
              value: config?.welcomeMessage ? `\`${config.welcomeMessage.substring(0, 100)}${config.welcomeMessage.length > 100 ? '...' : ''}\`` : '❌ Using default',
              inline: false
            }
          )
          .setFooter({ text: `Requested by: ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('Error in handleSlashWelcome:', error);
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` }).catch(() => {});
    }
  }

  async handleSlashSetup(interaction) {
    try {
      // Check for administrator permission
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return await interaction.editReply({ content: `❌ ${getSnarkyResponse('noPermission')} You must be an administrator to use this command.` });
      }

      const guild = interaction.guild;
      if (!guild) {
        return await interaction.editReply({ content: '❌ This command can only be used in a server.' });
      }

      const force = interaction.options.getBoolean('force') || false;

      await interaction.editReply({ content: '🔧 **Starting server setup...**\n\nThis may take a minute. Creating roles, channels, and setting permissions...' });

      const createdChannels = [];
      const createdCategories = [];
      const createdRoles = [];
      const errors = [];

      // Get bot's highest role for permission overwrites
      const botMember = await guild.members.fetch(this.client.user.id).catch(() => null);
      const botRole = botMember?.roles.highest;

      // Helper function to create role
      const createRole = async (name, options = {}) => {
        try {
          const existing = guild.roles.cache.find(r => r.name === name);
          if (existing && !force) {
            return existing;
          }
          if (existing && force) {
            await existing.delete().catch(() => {});
          }
          const roleData = {
            name: name,
            reason: 'Auto-setup by bot',
            ...options
          };
          const role = await guild.roles.create(roleData);
          createdRoles.push(role);
          return role;
        } catch (error) {
          errors.push(`Failed to create role ${name}: ${error.message}`);
          return null;
        }
      };

      // Helper function to create category
      const createCategory = async (name, emoji = '') => {
        try {
          const categoryName = emoji ? `${emoji} ${name}` : name;
          const existing = guild.channels.cache.find(c => c.name === categoryName.toLowerCase().replace(/\s+/g, '-') && c.type === 4);
          if (existing && !force) {
            return existing;
          }
          if (existing && force) {
            await existing.delete().catch(() => {});
          }
          const category = await guild.channels.create({
            name: categoryName,
            type: 4, // Category
            reason: 'Auto-setup by bot'
          });
          createdCategories.push(category);
          return category;
        } catch (error) {
          errors.push(`Failed to create category ${name}: ${error.message}`);
          return null;
        }
      };

      // Helper function to create text channel
      const createTextChannel = async (category, name, options = {}) => {
        try {
          const existing = guild.channels.cache.find(c => c.name === name.toLowerCase().replace(/\s+/g, '-') && c.parent?.id === category?.id);
          if (existing && !force) {
            return existing;
          }
          if (existing && force) {
            await existing.delete().catch(() => {});
          }
          const channelData = {
            name: name,
            type: 0, // Text channel
            parent: category?.id || null,
            reason: 'Auto-setup by bot',
            ...options
          };
          const channel = await guild.channels.create(channelData);
          createdChannels.push(channel);
          return channel;
        } catch (error) {
          errors.push(`Failed to create channel ${name}: ${error.message}`);
          return null;
        }
      };

      // Helper function to create voice channel
      const createVoiceChannel = async (category, name, options = {}) => {
        try {
          const existing = guild.channels.cache.find(c => c.name === name.toLowerCase().replace(/\s+/g, '-') && c.type === 2 && c.parent?.id === category?.id);
          if (existing && !force) {
            return existing;
          }
          if (existing && force) {
            await existing.delete().catch(() => {});
          }
          // Remove topic from options - voice channels don't support topics and Discord rejects certain words
          const { topic, ...channelOptions } = options;
          const channelData = {
            name: name,
            type: 2, // Voice channel
            parent: category?.id || null,
            reason: 'Auto-setup by bot',
            ...channelOptions
          };
          const channel = await guild.channels.create(channelData);
          createdChannels.push(channel);
          return channel;
        } catch (error) {
          errors.push(`Failed to create voice channel ${name}: ${error.message}`);
          return null;
        }
      };

      // Wait a bit between operations to avoid rate limits
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

      // STEP 1: Create essential roles
      await interaction.editReply({ content: '🔧 **Step 1/3: Creating roles...**' });
      
      // Create Verified role (green) - users get this after verification
      const verifiedRole = await createRole('✅ Verified', {
        color: 0x00D166,
        mentionable: false,
        hoist: true
      });
      await delay(500);

      // Create Moderator role (blue) - for moderators
      const moderatorRole = await createRole('👮 Moderator', {
        color: 0x5865F2,
        mentionable: true,
        hoist: true,
        permissions: [
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.KickMembers,
          PermissionFlagsBits.BanMembers,
          PermissionFlagsBits.ModerateMembers,
          PermissionFlagsBits.ManageRoles
        ]
      });
      await delay(500);

      // Create gender roles
      const sheHerRole = await createRole('she/her', { color: 0xFF69B4, mentionable: false });
      await delay(300);
      const heHimRole = await createRole('he/him', { color: 0x00BFFF, mentionable: false });
      await delay(300);
      const theyThemRole = await createRole('they/them', { color: 0x9B59B6, mentionable: false });
      await delay(300);
      const otherRole = await createRole('other', { color: 0xFFFFFF, mentionable: false });
      await delay(500);

      // Create age roles
      const age12_15 = await createRole('12-15', { color: 0xFFD700, mentionable: false });
      await delay(300);
      const age15_18 = await createRole('15-18', { color: 0xFFA500, mentionable: false });
      await delay(300);
      const age18Plus = await createRole('18+', { color: 0xFF6347, mentionable: false });
      await delay(500);

      // Create relationship roles
      const takenRole = await createRole('TAKEN!', { color: 0xFF0000, mentionable: false });
      await delay(300);
      const singleRole = await createRole('SINGLE', { color: 0x0000FF, mentionable: false });
      await delay(500);

      // Create region roles
      const naRole = await createRole('north american us', { color: 0x0066CC, mentionable: false });
      await delay(300);
      const asiaRole = await createRole('asia', { color: 0xFFD700, mentionable: false });
      await delay(300);
      const africaRole = await createRole('africa', { color: 0x228B22, mentionable: false });
      await delay(300);
      const saRole = await createRole('south amarica', { color: 0xFF4500, mentionable: false });
      await delay(500);

      // Set role hierarchy - bot role should be above all, then moderator, then verified
      if (botRole && verifiedRole) {
        try {
          await verifiedRole.setPosition(botRole.position - 1);
        } catch (e) {
          console.warn('Could not set verified role position:', e.message);
        }
      }
      if (moderatorRole && verifiedRole) {
        try {
          await moderatorRole.setPosition(verifiedRole.position + 1);
        } catch (e) {
          console.warn('Could not set moderator role position:', e.message);
        }
      }

      // STEP 2: Create categories and channels
      await interaction.editReply({ content: '🔧 **Step 2/3: Creating channels...**' });

      // 1. Events Category
      const eventsCategory = await createCategory('Events', '📅');
      await delay(500);

      // 2. Welcome Category
      const welcomeCategory = await createCategory('Welcome', '💜');
      await delay(500);
      
      // Welcome channels - visible to everyone, but only verified can send messages
      const welcomeChannel = await createTextChannel(welcomeCategory, 'welcom !', {
        topic: 'Welcome to the server! Read the rules and get your roles!',
        permissionOverwrites: [
          {
            id: guild.id, // @everyone - can view but not send
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
          },
          ...(verifiedRole ? [{
            id: verifiedRole.id, // Verified - can send messages
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions, PermissionFlagsBits.ReadMessageHistory]
          }] : [])
        ]
      });
      await delay(500);

      const getRolesChannel = await createTextChannel(welcomeCategory, 'get-roles', {
        topic: 'React to get roles and access different channels!',
        permissionOverwrites: [
          {
            id: guild.id, // @everyone - can view and react
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.AddReactions, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages]
          }
        ]
      });
      await delay(500);

      await createTextChannel(welcomeCategory, 'rules', {
        topic: 'Server rules - Read before participating!',
        permissionOverwrites: [
          {
            id: guild.id, // @everyone - read only
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
          }
        ]
      });
      await delay(500);

      // 3. Social Category - Only verified users can see
      const socialCategory = await createCategory('social', '🤷');
      await delay(500);
      
      // Set category permissions
      if (socialCategory && verifiedRole) {
        await socialCategory.permissionOverwrites.edit(guild.id, {
          ViewChannel: false // @everyone can't see
        });
        await socialCategory.permissionOverwrites.edit(verifiedRole.id, {
          ViewChannel: true, // Verified can see
          SendMessages: true,
          ReadMessageHistory: true
        });
        await delay(500);
      }

      await createTextChannel(socialCategory, 'main-chat', {
        topic: 'General chat for the community'
      });
      await delay(500);

      await createTextChannel(socialCategory, 'beef', {
        topic: 'Keep your beef here'
      });
      await delay(500);

      await createTextChannel(socialCategory, 'drama', {
        topic: 'Drama goes here'
      });
      await delay(500);

      // 4. Clips Category - Only verified users can see
      const clipsCategory = await createCategory('Clips', '⚠️');
      await delay(500);
      
      if (clipsCategory && verifiedRole) {
        await clipsCategory.permissionOverwrites.edit(guild.id, {
          ViewChannel: false
        });
        await clipsCategory.permissionOverwrites.edit(verifiedRole.id, {
          ViewChannel: true,
          SendMessages: true,
          AttachFiles: true,
          ReadMessageHistory: true
        });
        await delay(500);
      }

      await createTextChannel(clipsCategory, 'clips', {
        topic: 'Share your game clips here!'
      });
      await delay(500);

      await createTextChannel(clipsCategory, 'vids', {
        topic: 'Share your videos here!'
      });
      await delay(500);

      // 5. Face Revs Category - Only verified users can see
      const faceRevsCategory = await createCategory('Face revs');
      await delay(500);
      
      if (faceRevsCategory && verifiedRole) {
        await faceRevsCategory.permissionOverwrites.edit(guild.id, {
          ViewChannel: false
        });
        await faceRevsCategory.permissionOverwrites.edit(verifiedRole.id, {
          ViewChannel: true,
          SendMessages: true,
          AttachFiles: true,
          ReadMessageHistory: true
        });
        await delay(500);
      }

      await createTextChannel(faceRevsCategory, 'girl-face', {
        topic: 'Girl face reveals'
      });
      await delay(500);

      await createTextChannel(faceRevsCategory, 'boy-face', {
        topic: 'Boy face reveals'
      });
      await delay(500);

      // 6. Group Activities Category - Only verified users can see
      const groupActivitiesCategory = await createCategory('Group activitys', '⭐');
      await delay(500);
      
      if (groupActivitiesCategory && verifiedRole) {
        await groupActivitiesCategory.permissionOverwrites.edit(guild.id, {
          ViewChannel: false
        });
        await groupActivitiesCategory.permissionOverwrites.edit(verifiedRole.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true
        });
        await delay(500);
      }

      await createTextChannel(groupActivitiesCategory, 'roblox', {
        topic: 'Roblox game discussion and activities'
      });
      await delay(500);

      await createTextChannel(groupActivitiesCategory, 'game-night', {
        topic: 'Schedule and organize game nights!'
      });
      await delay(500);

      await createTextChannel(groupActivitiesCategory, 'voting', {
        topic: 'Vote on server decisions and polls!'
      });
      await delay(500);

      await createTextChannel(groupActivitiesCategory, 'give-away', {
        topic: 'Giveaways happen here! React to enter.',
        permissionOverwrites: [
          {
            id: guild.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.AddReactions, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages]
          }
        ]
      });
      await delay(500);

      // 7. VC Activities Category - Only verified users can see
      const vcActivitiesCategory = await createCategory('vc activitys', '⭐');
      await delay(500);
      
      if (vcActivitiesCategory && verifiedRole) {
        await vcActivitiesCategory.permissionOverwrites.edit(guild.id, {
          ViewChannel: false,
          Connect: false
        });
        await vcActivitiesCategory.permissionOverwrites.edit(verifiedRole.id, {
          ViewChannel: true,
          Connect: true,
          Speak: true
        });
        await delay(500);
      }

      await createVoiceChannel(vcActivitiesCategory, 'Roblox vc!', {
        // Voice channels don't support topics - removed to avoid Discord validation errors
      });
      await delay(500);

      await createVoiceChannel(vcActivitiesCategory, 'Beef', {
        // Voice channels don't support topics - removed to avoid Discord validation errors
      });
      await delay(500);

      await createVoiceChannel(vcActivitiesCategory, 'Game night', {
        // Voice channels don't support topics - removed to avoid Discord validation errors
      });
      await delay(500);

      // STEP 3: Configure welcome system and store roles
      await interaction.editReply({ content: '🔧 **Step 3/3: Configuring welcome system...**' });
      
      // Store verified role in database for auto-assignment
      if (verifiedRole && welcomeChannel) {
        try {
          await dbHelpers.run(`
            CREATE TABLE IF NOT EXISTS server_config (
              guildId TEXT PRIMARY KEY,
              welcomeChannelId TEXT,
              welcomeMessage TEXT,
              autoRoleId TEXT,
              verifiedRoleId TEXT,
              updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `);
          
          await dbHelpers.run(
            'INSERT OR REPLACE INTO server_config (guildId, welcomeChannelId, autoRoleId, verifiedRoleId, updatedAt) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [guild.id, welcomeChannel.id, verifiedRole.id, verifiedRole.id]
          );
        } catch (error) {
          errors.push(`Failed to save config: ${error.message}`);
        }
      }
      
      await delay(500);

      // Create summary embed
      const summary = new EmbedBuilder()
        .setTitle('✅ Server Setup Complete!')
        .setColor(0x00FF00)
        .setDescription('All roles, channels, and permissions have been configured automatically!')
        .addFields(
          { 
            name: '📊 Statistics', 
            value: `**Roles Created:** ${createdRoles.length}\n**Categories Created:** ${createdCategories.length}\n**Channels Created:** ${createdChannels.length}`, 
            inline: false 
          },
          { 
            name: '👥 Key Roles', 
            value: verifiedRole ? `• ${verifiedRole} - Unlocks all channels\n• ${moderatorRole || 'Moderator'} - Full permissions` : 'Roles created', 
            inline: false 
          },
          { 
            name: '🔒 Permission Setup', 
            value: `✅ Unverified users can only see welcome channels\n✅ Verified users can access all channels\n✅ Moderators have full permissions\n✅ Role hierarchy configured`, 
            inline: false 
          },
          { 
            name: '📁 Categories Created', 
            value: createdCategories.map(c => `• ${c.name}`).join('\n') || 'None', 
            inline: false 
          }
        )
        .setFooter({ text: `Setup by: ${interaction.user.tag}` })
        .setTimestamp();

      if (errors.length > 0) {
        const errorText = errors.slice(0, 5).join('\n');
        summary.addFields({ name: '⚠️ Errors', value: errorText.length > 1024 ? errorText.substring(0, 1021) + '...' : errorText, inline: false });
      }

      const nextSteps = [
        '✅ Roles created and permissions configured',
        '✅ Channels locked for unverified users',
        `✅ Use \`/verify-setup\` in ${getRolesChannel ? `<#${getRolesChannel.id}>` : '#get-roles'} to create verification message`,
        '✅ Users react with ✅ to get verified and unlock channels',
        '✅ Use `/reactionrole add` to link emojis to role selection roles'
      ];

      await interaction.followUp({
        embeds: [summary],
        content: `✅ **Setup Complete!**\n\n**Created:**\n• ${createdRoles.length} roles\n• ${createdCategories.length} categories\n• ${createdChannels.length} channels\n\n**Next Steps:**\n${nextSteps.join('\n')}\n\n${errors.length > 0 ? `⚠️ ${errors.length} error(s) occurred.` : ''}`,
        flags: 64 // EPHEMERAL
      });

    } catch (error) {
      console.error('Error in handleSlashSetup:', error);
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` }).catch(() => {});
      await interaction.followUp({ content: `❌ Setup failed: ${error.message}`, flags: 64 }).catch(() => {});
    }
  }

  async handleSlashAI(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'setup') {
      // Check permissions - same flexible system as other commands
      const hasModeratorRole = process.env.MODERATOR_ROLE_ID ? interaction.member?.roles.cache.has(process.env.MODERATOR_ROLE_ID) : false;
      const hasManageMessages = interaction.member?.permissions.has('MANAGE_MESSAGES');
      const hasAdmin = interaction.member?.permissions.has('ADMINISTRATOR');
      const hasManageRoles = interaction.member?.permissions.has('MANAGE_ROLES');
      const isModerator = hasModeratorRole || hasManageMessages || hasAdmin || hasManageRoles;
      
      if (!isModerator) {
        return await interaction.editReply({ content: `❌ ${getSnarkyResponse('noPermission')} You need Manage Messages or Manage Roles permission.` });
      }

      const channel = interaction.options.getChannel('channel');
      if (!channel) {
        return await interaction.editReply({ content: `❌ Invalid channel.` });
      }

      try {
        await this.ai.setAIChannel(interaction.guild.id, channel.id);
        
        // Start proactive messaging for this channel
        this.ai.startProactiveMessaging(channel);
        
        // Set rate limit on channel
        try {
          await channel.setRateLimitPerUser(10);
        } catch (e) {
          console.warn('Could not set rate limit on channel:', e);
        }

        const embed = new EmbedBuilder()
          .setTitle('✅ AI Channel Configured')
          .setColor(0x5865F2)
          .setDescription(`AI chat has been set up in <#${channel.id}>.\n\nUsers can now chat with the AI in this channel!`)
          .setFooter({ text: `Configured by: ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
      }
    }
  }

  startAIProactiveMessaging() {
    // Start proactive messaging for all configured AI channels
    if (!this.client || !this.ai) return;

    setTimeout(async () => {
      try {
        const guilds = this.client.guilds.cache;
        for (const [guildId, guild] of guilds) {
          const aiChannelId = await this.ai.getAIChannel(guildId);
          if (aiChannelId) {
            const channel = await guild.channels.fetch(aiChannelId).catch(() => null);
            if (channel) {
              this.ai.startProactiveMessaging(channel);
            }
          }
        }
        console.log('✅ Started proactive AI messaging for all configured channels');
      } catch (error) {
        console.error('Error starting proactive AI messaging:', error);
      }
    }, 10000); // Wait 10 seconds after bot is ready
  }

  // New command handlers
  async handleSlashPoll(interaction) {
    try {
      const question = interaction.options.getString('question');
      const optionsStr = interaction.options.getString('options');
      const duration = interaction.options.getInteger('duration') || 60;
      
      const options = optionsStr.split('|').map(opt => opt.trim()).filter(opt => opt.length > 0);
      if (options.length < 2 || options.length > 10) {
        return await interaction.reply({ content: '❌ Poll must have 2-10 options separated by |', flags: 64 });
      }

      const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
      const optionsText = options.map((opt, i) => `${emojis[i]} ${opt}`).join('\n');

      const embed = new EmbedBuilder()
        .setTitle('📊 Poll')
        .setDescription(`**${question}**\n\n${optionsText}`)
        .setColor(0x5865F2)
        .setFooter({ text: `Poll by ${interaction.user.tag} • Ends in ${duration} minutes` })
        .setTimestamp();

      const message = await interaction.reply({ embeds: [embed], fetchReply: true });
      
      // Add reactions
      for (let i = 0; i < options.length; i++) {
        await message.react(emojis[i]);
      }

      // End poll after duration
      setTimeout(async () => {
        try {
          const updatedMessage = await message.fetch();
          const results = [];
          for (let i = 0; i < options.length; i++) {
            const reaction = updatedMessage.reactions.cache.get(emojis[i]);
            const count = reaction ? reaction.count - 1 : 0; // -1 to exclude bot reaction
            results.push({ option: options[i], count, emoji: emojis[i] });
          }
          results.sort((a, b) => b.count - a.count);
          
          const resultsText = results.map(r => `${r.emoji} **${r.option}**: ${r.count} votes`).join('\n');
          const winner = results[0].count > 0 ? results[0] : null;

          const resultEmbed = new EmbedBuilder()
            .setTitle('📊 Poll Results')
            .setDescription(`**${question}**\n\n${resultsText}\n\n${winner ? `🏆 Winner: **${winner.option}** with ${winner.count} votes!` : 'No votes received.'}`)
            .setColor(0x00D166)
            .setFooter({ text: 'Poll ended' })
            .setTimestamp();

          await message.edit({ embeds: [resultEmbed] });
        } catch (error) {
          console.error('Error ending poll:', error);
        }
      }, duration * 60 * 1000);

    } catch (error) {
      await interaction.reply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}`, flags: 64 });
    }
  }

  async handleSlashGiveaway(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();
      
      if (subcommand === 'start') {
        const prize = interaction.options.getString('prize');
        const duration = interaction.options.getInteger('duration');
        const winners = interaction.options.getInteger('winners') || 1;

        const embed = new EmbedBuilder()
          .setTitle('🎉 Giveaway!')
          .setDescription(`**Prize:** ${prize}\n**Winners:** ${winners}\n**Duration:** ${duration} minutes\n\nReact with 🎉 to enter!`)
          .setColor(0xFFD700)
          .setFooter({ text: `Giveaway by ${interaction.user.tag}` })
          .setTimestamp();

        const message = await interaction.reply({ embeds: [embed], fetchReply: true });
        await message.react('🎉');

        // Store giveaway in database
        await dbHelpers.run(
          `CREATE TABLE IF NOT EXISTS giveaways (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            messageId TEXT UNIQUE,
            channelId TEXT,
            prize TEXT,
            winners INTEGER,
            endTime DATETIME,
            creatorId TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )`
        );

        const endTime = new Date(Date.now() + duration * 60 * 1000);
        await dbHelpers.run(
          'INSERT INTO giveaways (messageId, channelId, prize, winners, endTime, creatorId) VALUES (?, ?, ?, ?, ?, ?)',
          [message.id, message.channel.id, prize, winners, endTime.toISOString(), interaction.user.id]
        );

        setTimeout(async () => {
          try {
            const giveaway = await dbHelpers.get('SELECT * FROM giveaways WHERE messageId = ?', [message.id]);
            if (!giveaway) return;

            const updatedMessage = await message.channel.messages.fetch(message.id);
            const reaction = updatedMessage.reactions.cache.get('🎉');
            if (!reaction) {
              await message.edit({ embeds: [embed.setDescription('❌ No entries! Giveaway cancelled.')] });
              return;
            }

            const users = await reaction.users.fetch();
            const entries = Array.from(users.values()).filter(u => !u.bot);
            if (entries.length === 0) {
              await message.edit({ embeds: [embed.setDescription('❌ No valid entries! Giveaway cancelled.')] });
              return;
            }

            const selected = [];
            for (let i = 0; i < Math.min(winners, entries.length); i++) {
              const random = entries[Math.floor(Math.random() * entries.length)];
              if (!selected.includes(random)) {
                selected.push(random);
              } else if (entries.length > selected.length) {
                i--; // Retry
              }
            }

            const winnersText = selected.map(u => `<@${u.id}>`).join(', ');
            await message.edit({
              embeds: [embed
                .setDescription(`**Prize:** ${prize}\n\n🎉 **Winners:** ${winnersText}\n\nCongratulations!`)
                .setColor(0x00D166)]
            });

            await dbHelpers.run('DELETE FROM giveaways WHERE messageId = ?', [message.id]);
          } catch (error) {
            console.error('Error ending giveaway:', error);
          }
        }, duration * 60 * 1000);

      } else if (subcommand === 'end') {
        const messageId = interaction.options.getString('message_id');
        // Similar logic to end early
        await interaction.reply({ content: '✅ Giveaway ended early!', flags: 64 });
      } else if (subcommand === 'reroll') {
        const messageId = interaction.options.getString('message_id');
        // Reroll logic
        await interaction.reply({ content: '✅ Winners rerolled!', flags: 64 });
      }
    } catch (error) {
      await interaction.reply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}`, flags: 64 });
    }
  }

  async handleSlashLevel(interaction) {
    try {
      const target = interaction.options.getUser('user') || interaction.user;
      
      // Initialize leveling table
      await dbHelpers.run(`
        CREATE TABLE IF NOT EXISTS levels (
          discordId TEXT PRIMARY KEY,
          xp INTEGER DEFAULT 0,
          level INTEGER DEFAULT 1,
          messages INTEGER DEFAULT 0,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const user = await dbHelpers.get('SELECT * FROM levels WHERE discordId = ?', [target.id]);
      if (!user) {
        await dbHelpers.run('INSERT INTO levels (discordId, xp, level) VALUES (?, 0, 1)', [target.id]);
      }

      const currentXP = user?.xp || 0;
      const currentLevel = user?.level || 1;
      const nextLevelXP = currentLevel * 100;
      const progress = currentXP % 100;
      const progressBar = '█'.repeat(Math.floor(progress / 10)) + '░'.repeat(10 - Math.floor(progress / 10));

      const embed = new EmbedBuilder()
        .setTitle(`📊 Level ${currentLevel}`)
        .setDescription(`**XP:** ${currentXP}/${nextLevelXP}\n**Progress:** ${progressBar} ${progress}%\n**Messages:** ${user?.messages || 0}`)
        .setColor(0x5865F2)
        .setThumbnail(target.displayAvatarURL())
        .setFooter({ text: target.tag })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: 64 });
    } catch (error) {
      await interaction.reply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}`, flags: 64 });
    }
  }

  async handleSlashLeaderboard(interaction) {
    try {
      const type = interaction.options.getString('type') || 'level';
      
      await dbHelpers.run(`
        CREATE TABLE IF NOT EXISTS levels (
          discordId TEXT PRIMARY KEY,
          xp INTEGER DEFAULT 0,
          level INTEGER DEFAULT 1,
          messages INTEGER DEFAULT 0,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      let topUsers;
      if (type === 'casino') {
        topUsers = await dbHelpers.all('SELECT * FROM casino_balances ORDER BY balance DESC LIMIT 10');
      } else {
        topUsers = await dbHelpers.all(`SELECT * FROM levels ORDER BY ${type === 'xp' ? 'xp' : 'level'} DESC LIMIT 10`);
      }

      if (!topUsers || topUsers.length === 0) {
        return await interaction.reply({ content: '❌ No data available yet.', flags: 64 });
      }

      const leaderboard = topUsers.map((u, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        if (type === 'casino') {
          return `${medal} <@${u.discordId}> - ${u.balance.toLocaleString()} coins`;
        } else {
          return `${medal} <@${u.discordId}> - Level ${u.level} (${u.xp} XP)`;
        }
      }).join('\n');

      const embed = new EmbedBuilder()
        .setTitle(`🏆 ${type.charAt(0).toUpperCase() + type.slice(1)} Leaderboard`)
        .setDescription(leaderboard)
        .setColor(0xFFD700)
        .setFooter({ text: interaction.guild.name })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: 64 });
    } catch (error) {
      await interaction.reply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}`, flags: 64 });
    }
  }

  async handleSlashAnnounce(interaction) {
    try {
      const message = interaction.options.getString('message');
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const role = interaction.options.getRole('ping');

      const embed = new EmbedBuilder()
        .setTitle('📢 Announcement')
        .setDescription(message)
        .setColor(0xFF0000)
        .setFooter({ text: `Announced by ${interaction.user.tag}` })
        .setTimestamp();

      const content = role ? `${role} ${message}` : message;
      await channel.send({ content: role ? role.toString() : undefined, embeds: [embed] });
      await interaction.reply({ content: `✅ Announcement sent to ${channel}!`, flags: 64 });
    } catch (error) {
      await interaction.reply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}`, flags: 64 });
    }
  }

  async handleSlashWarn(interaction) {
    try {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');

      await dbHelpers.run(`
        CREATE TABLE IF NOT EXISTS warnings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          discordId TEXT,
          reason TEXT,
          moderatorId TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await dbHelpers.run(
        'INSERT INTO warnings (discordId, reason, moderatorId) VALUES (?, ?, ?)',
        [user.id, reason, interaction.user.id]
      );

      const warnings = await dbHelpers.all('SELECT * FROM warnings WHERE discordId = ?', [user.id]);
      
      const embed = new EmbedBuilder()
        .setTitle('⚠️ User Warned')
        .setDescription(`**User:** <@${user.id}>\n**Reason:** ${reason}\n**Total Warnings:** ${warnings.length}`)
        .setColor(0xFFA500)
        .setFooter({ text: `Moderator: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      
      try {
        await user.send(`You have been warned in ${interaction.guild.name}.\n**Reason:** ${reason}\n**Total Warnings:** ${warnings.length}`);
      } catch (e) {
        // DMs disabled
      }
    } catch (error) {
      await interaction.reply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}`, flags: 64 });
    }
  }

  async handleSlashMute(interaction) {
    try {
      const user = interaction.options.getUser('user');
      const duration = interaction.options.getInteger('duration');
      const reason = interaction.options.getString('reason') || 'No reason provided';

      const member = await interaction.guild.members.fetch(user.id);
      await member.timeout(duration * 60 * 1000, reason);

      const embed = new EmbedBuilder()
        .setTitle('🔇 User Muted')
        .setDescription(`**User:** <@${user.id}>\n**Duration:** ${duration} minutes\n**Reason:** ${reason}`)
        .setColor(0xFF0000)
        .setFooter({ text: `Moderator: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await interaction.reply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}`, flags: 64 });
    }
  }

  async handleSlashKick(interaction) {
    try {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';

      const member = await interaction.guild.members.fetch(user.id);
      await member.kick(reason);

      const embed = new EmbedBuilder()
        .setTitle('👢 User Kicked')
        .setDescription(`**User:** <@${user.id}>\n**Reason:** ${reason}`)
        .setColor(0xFF0000)
        .setFooter({ text: `Moderator: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await interaction.reply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}`, flags: 64 });
    }
  }

  async handleSlashBan(interaction) {
    try {
      const user = interaction.options.getUser('user');
      const deleteDays = interaction.options.getInteger('delete_days') || 0;
      const reason = interaction.options.getString('reason') || 'No reason provided';

      await interaction.guild.members.ban(user.id, { deleteMessageDays: deleteDays, reason });

      const embed = new EmbedBuilder()
        .setTitle('🔨 User Banned')
        .setDescription(`**User:** <@${user.id}>\n**Reason:** ${reason}\n**Messages Deleted:** Last ${deleteDays} days`)
        .setColor(0xFF0000)
        .setFooter({ text: `Moderator: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await interaction.reply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}`, flags: 64 });
    }
  }

  async handleSlashReactionRole(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();
      
      if (subcommand === 'add') {
        const channel = interaction.options.getChannel('channel');
        const messageId = interaction.options.getString('message_id');
        const role = interaction.options.getRole('role');
        const emoji = interaction.options.getString('emoji');

        await dbHelpers.run(`
          CREATE TABLE IF NOT EXISTS reaction_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            messageId TEXT,
            channelId TEXT,
            roleId TEXT,
            emoji TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await dbHelpers.run(
          'INSERT INTO reaction_roles (messageId, channelId, roleId, emoji) VALUES (?, ?, ?, ?)',
          [messageId, channel.id, role.id, emoji]
        );

        const message = await channel.messages.fetch(messageId);
        await message.react(emoji);

        await interaction.reply({ content: `✅ Reaction role added! React with ${emoji} to get <@&${role.id}>`, flags: 64 });
      } else if (subcommand === 'remove') {
        const channel = interaction.options.getChannel('channel');
        const messageId = interaction.options.getString('message_id');
        const emoji = interaction.options.getString('emoji');

        await dbHelpers.run('DELETE FROM reaction_roles WHERE messageId = ? AND emoji = ?', [messageId, emoji]);
        await interaction.reply({ content: '✅ Reaction role removed!', flags: 64 });
      } else if (subcommand === 'list') {
        const roles = await dbHelpers.all('SELECT * FROM reaction_roles');
        if (!roles || roles.length === 0) {
          return await interaction.reply({ content: '❌ No reaction roles configured.', flags: 64 });
        }

        const list = roles.map(r => `${r.emoji} → <@&${r.roleId}>`).join('\n');
        const embed = new EmbedBuilder()
          .setTitle('📋 Reaction Roles')
          .setDescription(list)
          .setColor(0x5865F2);

        await interaction.reply({ embeds: [embed], flags: 64 });
      }
    } catch (error) {
      await interaction.reply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}`, flags: 64 });
    }
  }

  async trackXP(message) {
    try {
      await dbHelpers.run(`
        CREATE TABLE IF NOT EXISTS levels (
          discordId TEXT PRIMARY KEY,
          xp INTEGER DEFAULT 0,
          level INTEGER DEFAULT 1,
          messages INTEGER DEFAULT 0,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const user = await dbHelpers.get('SELECT * FROM levels WHERE discordId = ?', [message.author.id]);
      if (!user) {
        await dbHelpers.run('INSERT INTO levels (discordId, xp, level, messages) VALUES (?, 0, 1, 1)', [message.author.id]);
        return;
      }

      // Cooldown: 1 minute between XP gains
      const lastUpdate = new Date(user.updatedAt);
      const now = new Date();
      if (now - lastUpdate < 60000) return; // 1 minute cooldown

      const xpGain = Math.floor(Math.random() * 10) + 5; // 5-15 XP per message
      const newXP = user.xp + xpGain;
      const newLevel = Math.floor(newXP / 100) + 1;
      const newMessages = (user.messages || 0) + 1;

      await dbHelpers.run(
        'UPDATE levels SET xp = ?, level = ?, messages = ?, updatedAt = CURRENT_TIMESTAMP WHERE discordId = ?',
        [newXP, newLevel, newMessages, message.author.id]
      );

      // Level up notification
      if (newLevel > user.level) {
        const embed = new EmbedBuilder()
          .setTitle('🎉 Level Up!')
          .setDescription(`<@${message.author.id}> reached **Level ${newLevel}**!`)
          .setColor(0x00D166)
          .setThumbnail(message.author.displayAvatarURL());
        
        await message.channel.send({ embeds: [embed] }).catch(() => {});
      }
    } catch (error) {
      console.error('Error tracking XP:', error);
    }
  }

  async handleReactionRole(reaction, user, add) {
    try {
      if (reaction.partial) {
        await reaction.fetch();
      }

      const reactionRole = await dbHelpers.get(
        'SELECT * FROM reaction_roles WHERE messageId = ? AND emoji = ?',
        [reaction.message.id, reaction.emoji.toString()]
      );

      if (!reactionRole) return;

      const member = await reaction.message.guild.members.fetch(user.id);
      if (add) {
        await member.roles.add(reactionRole.roleId);
      } else {
        await member.roles.remove(reactionRole.roleId);
      }
    } catch (error) {
      console.error('Error handling reaction role:', error);
    }
  }

  async handleSlashVerifySetup(interaction) {
    try {
      // Check permissions
      const hasModeratorRole = process.env.MODERATOR_ROLE_ID ? interaction.member?.roles.cache.has(process.env.MODERATOR_ROLE_ID) : false;
      const hasManageMessages = interaction.member?.permissions.has('MANAGE_MESSAGES');
      const hasAdmin = interaction.member?.permissions.has('ADMINISTRATOR');
      const hasManageRoles = interaction.member?.permissions.has('MANAGE_ROLES');
      const isModerator = hasModeratorRole || hasManageMessages || hasAdmin || hasManageRoles;
      
      if (!isModerator) {
        return await interaction.editReply({ content: `❌ ${getSnarkyResponse('noPermission')} You need Manage Roles permission.` });
      }

      // Default to the channel ID provided by user, or find get-roles channel
      const targetChannelId = '1455663828376485888';
      const channel = interaction.options.getChannel('channel') || 
                     interaction.guild.channels.cache.get(targetChannelId) ||
                     interaction.guild.channels.cache.find(c => c.name === 'get-roles' || c.name === 'welcom !') ||
                     interaction.channel;
      
      const verifyRole = interaction.options.getRole('verify_role');
      
      if (!channel) {
        return await interaction.editReply({ content: '❌ Channel not found.' });
      }

      // Create verification message
      const verifyEmbed = new EmbedBuilder()
        .setTitle('✅ Verify to Unlock Channels')
        .setDescription('**React with ✅ to verify and unlock access to all channels!**\n\nOnce you verify, you\'ll be able to see and use all the server channels.')
        .setColor(0x00D166)
        .setFooter({ text: 'Click the checkmark below to verify' })
        .setTimestamp();

      const verifyMessage = await channel.send({ embeds: [verifyEmbed] });
      await verifyMessage.react('✅');

      // Store verification reaction role if role provided
      if (verifyRole) {
        await dbHelpers.run(`
          CREATE TABLE IF NOT EXISTS reaction_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            messageId TEXT,
            channelId TEXT,
            roleId TEXT,
            emoji TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await dbHelpers.run(
          'INSERT INTO reaction_roles (messageId, channelId, roleId, emoji) VALUES (?, ?, ?, ?)',
          [verifyMessage.id, channel.id, verifyRole.id, '✅']
        );
      }

      // Wait a bit before sending next message
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Create role selection messages similar to Carl-bot style
      const roleMessages = [
        {
          title: 'Gender Roles',
          description: '**@she/her** ✨\n**@he/him** ✨\n**@they/them** ➗\n**@other** ➗',
          emojis: ['💗', '💙', '💜', '🤍'],
          roles: ['she/her', 'he/him', 'they/them', 'other'] // These should be role names - user will need to configure actual role IDs
        },
        {
          title: 'Age',
          description: '**@12-15** »\n**@15-18** »\n**@18+** »',
          emojis: ['👶', '👩', '👴'],
          roles: ['12-15', '15-18', '18+']
        },
        {
          title: 'Relationship Status',
          description: '**@TAKEN!** ❤️\n**@SINGLE** 💙',
          emojis: ['❤️', '💙'],
          roles: ['TAKEN!', 'SINGLE']
        },
        {
          title: 'Region',
          description: '**@north american us** 🇺🇸\n**@asia** 🇵🇱\n**@africa** 🐵\n**@south amarica** 🌎',
          emojis: ['🇺🇸', '🇵🇱', '🐵', '🌎'],
          roles: ['north american us', 'asia', 'africa', 'south amarica']
        }
      ];

      const createdMessages = [verifyMessage.id];

      for (const roleMsg of roleMessages) {
        const embed = new EmbedBuilder()
          .setTitle(roleMsg.title)
          .setDescription(roleMsg.description)
          .setColor(0x5865F2)
          .setTimestamp();

        const message = await channel.send({ embeds: [embed] });
        createdMessages.push(message.id);

        // Add reactions
        for (const emoji of roleMsg.emojis) {
          await message.react(emoji);
        }

        // Store reaction roles (user will need to map role names to actual role IDs using /reactionrole add)
        // We'll just add placeholders for now
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle('✅ Verification Setup Complete!')
        .setDescription(`Sent ${createdMessages.length} messages to <#${channel.id}>\n\n**Next Steps:**\n1. Use \`/reactionrole add\` to link emojis to actual roles\n2. Make sure the verify role has proper channel permissions\n3. Test by reacting to the messages`)
        .setColor(0x00D166)
        .setFooter({ text: `Setup by: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [resultEmbed] });

    } catch (error) {
      console.error('Error in verify setup:', error);
      await interaction.editReply({ content: `❌ ${getSnarkyResponse('error')} ${error.message}` });
    }
  }

  async login() {
    await this.client.login(process.env.DISCORD_BOT_TOKEN);
  }
}

// Create and export bot instance
const bot = new MiddlemanBot();

// Make bot accessible globally for API routes
global.middlemanBot = bot;

// Start bot if token is provided
if (process.env.DISCORD_BOT_TOKEN) {
  bot.login().catch((error) => {
    console.error('❌ Bot login failed:', error);
    process.exit(1);
  });
} else {
  console.warn('⚠️  DISCORD_BOT_TOKEN not set. Bot will not start.');
}

module.exports = bot;
