const express = require('express');
const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

const app = express();
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel] // Needed for DM support
});

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Store credentials in memory (you could use a database if needed)
let credentials = new Map();

// Hash password with salt
function hashPassword(password, salt) {
    return crypto.createHash('sha256').update(password + salt).digest('hex');
}

// Generate random string
function generateRandom(length, chars) {
    return Array.from(crypto.randomFillSync(new Uint8Array(length)))
        .map((x) => chars[x % chars.length])
        .join('');
}

// Clean up expired credentials but keep manually registered ones
function cleanupCredentials() {
    const now = Date.now() / 1000;
    for (const [username, data] of credentials.entries()) {
        // Only delete auto-generated credentials that are expired
        if (data.expiry < now && !data.isManuallyRegistered) {
            credentials.delete(username);
            console.log(`Auto-generated credentials for ${username} deleted`);
        }
    }
}

// Store the authorized role ID
const AUTHORIZED_ROLE_ID = process.env.AUTHORIZED_ROLE_ID; // Add this to your .env file

// Discord bot setup
client.once('ready', async () => {
    console.log('Bot is ready!');
    
    try {
        // Register slash commands globally
        await client.application?.commands.create({
            name: 'generate',
            description: 'Generate login credentials'
        });
        
        await client.application?.commands.create({
            name: 'register',
            description: 'Register custom credentials (Authorized role only)',
            options: [
                {
                    name: 'username',
                    description: 'The username to register',
                    type: 3, // STRING type
                    required: true
                },
                {
                    name: 'password',
                    description: 'The password to register',
                    type: 3, // STRING type
                    required: true
                }
            ]
        });
        
        console.log('Slash commands registered');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    
    // Clean up old credentials
    cleanupCredentials();
    
    if (interaction.commandName === 'generate') {
        try {
            // Generate credentials
            const username = generateRandom(8, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
            const password = generateRandom(12, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*');
            const expiry = Math.floor(Date.now() / 1000) + (12 * 60 * 60); // 12 hours

            // Store credentials
            credentials.set(username, {
                password: hashPassword(password, process.env.CREDENTIAL_SALT),
                expiry: expiry,
                isManuallyRegistered: false // Mark as auto-generated
            });

            // Create embed using EmbedBuilder (updated from MessageEmbed)
            const embed = new EmbedBuilder()
                .setTitle('Your Login Credentials')
                .setDescription('These credentials will expire in 12 hours.')
                .setColor('#00ff00')
                .addFields(
                    { name: 'Username', value: `\`\`\`${username}\`\`\``, inline: false },
                    { name: 'Password', value: `\`\`\`${password}\`\`\``, inline: false },
                    { name: 'Expiry', value: `<t:${expiry}:R>`, inline: false }
                )
                .setFooter({ text: 'Keep these credentials private!' }); // Updated footer format

            // Send DM
            await interaction.user.send({ embeds: [embed] });
            await interaction.reply({ content: '✅ Credentials have been sent to your DMs!', ephemeral: true });

        } catch (error) {
            console.error('Error:', error);
            if (error.code === 50007) {
                await interaction.reply({ 
                    content: '❌ Could not send credentials. Please enable DMs from server members!',
                    ephemeral: true 
                });
            } else {
                await interaction.reply({ 
                    content: '❌ An error occurred while generating credentials.',
                    ephemeral: true 
                });
            }
        }
    } else if (interaction.commandName === 'register') {
        // Check if user has the authorized role
        const member = interaction.member;
        if (!member.roles.cache.has(AUTHORIZED_ROLE_ID)) {
            return interaction.reply({ 
                content: '❌ You do not have permission to use this command.',
                ephemeral: true 
            });
        }
        
        try {
            const username = interaction.options.getString('username');
            const password = interaction.options.getString('password');
            const expiry = Math.floor(Date.now() / 1000) + (12 * 60 * 60); // 12 hours
            
            // Store credentials (permanent since manually registered)
            credentials.set(username, {
                password: hashPassword(password, process.env.CREDENTIAL_SALT),
                expiry: expiry,
                isManuallyRegistered: true // Mark as manually registered
            });
            
            // Create embed
            const embed = new EmbedBuilder()
                .setTitle('Custom Credentials Registered')
                .setDescription('These credentials will expire in 12 hours.')
                .setColor('#0099ff')
                .addFields(
                    { name: 'Username', value: `\`\`\`${username}\`\`\``, inline: false },
                    { name: 'Expiry', value: `<t:${expiry}:R>`, inline: false }
                )
                .setFooter({ text: 'Credentials registered successfully' });
                
            await interaction.reply({ embeds: [embed], ephemeral: true });
            
        } catch (error) {
            console.error('Error registering credentials:', error);
            await interaction.reply({ 
                content: '❌ An error occurred while registering credentials.',
                ephemeral: true 
            });
        }
    }
});

// API Endpoints
app.post('/api/validate', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ valid: false, message: 'Missing credentials' });
    }

    const userData = credentials.get(username);
    if (!userData) {
        return res.status(401).json({ valid: false, message: 'Invalid credentials' });
    }

    const hashedPassword = hashPassword(password, process.env.CREDENTIAL_SALT);
    const now = Date.now() / 1000;

    if (userData.password === hashedPassword && (userData.isManuallyRegistered || userData.expiry > now)) {
        return res.json({
            valid: true,
            expiry: userData.expiry,
            isManuallyRegistered: userData.isManuallyRegistered
        });
    }

    return res.status(401).json({ valid: false, message: 'Invalid credentials' });
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'ok' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // Start Discord bot
    client.login(process.env.DISCORD_TOKEN);
});
